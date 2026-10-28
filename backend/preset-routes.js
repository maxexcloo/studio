import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { civitaiFetch, civitaiJson, limitedBody } from "./civitai-access.js";
import { importCivitaiImage, matchResources, versionResource } from "./civitai-import.js";
import {
  dataDir,
  deleteGalleryFiles,
  filterVisibleGallery,
  gallery,
  importedImageFile,
  setGallery,
} from "./gallery-store.js";
import { downloadPresetImage, presetFromGallery, refreshImportedItem } from "./civitai-library.js";
import { stripMetadata } from "./metadata-strip.js";
import { presetsEnabled } from "./features.js";
import { readJsonFile, writeBytesFileAsync, writeJsonFile } from "./json-store.js";
import {
  libraryDownload,
  libraryDownloadAccess,
  libraryDownloads,
  resolveModelLink,
  startLibraryDownload,
} from "./library-downloads.js";
import { getFileVideoPoster, getFileVideoPreview, sendVideoPreview } from "./video-previews.js";
import { requireLocal } from "./route-access.js";
import { refreshWorkerModels } from "./worker-models.js";
import { presetGrade } from "./library-grade.js";

const presetsPath = path.join(dataDir, "presets.json");
const previewsDir = path.join(dataDir, "preset-previews");
let presets;
try {
  presets = readJsonFile(presetsPath);
} catch {
  presets = [];
}
if (!Array.isArray(presets)) presets = [];
const imported = new Map();

function summary(preset) {
  const { previewUrl, ...rest } = preset;
  // A saved image always has its own picture; an older recipe has its preview file or link.
  const picture = Boolean(
    preset.galleryItemId ||
    previewUrl ||
    fs.existsSync(path.join(previewsDir, `${preset.id}.webp`)),
  );
  return {
    ...rest,
    thumbnailUrl: picture ? `/api/presets/${preset.id}/thumbnail` : "",
    ...(Array.isArray(preset.resources) ? { grade: presetGrade(preset) } : {}),
  };
}

const thumbnailsDir = path.join(previewsDir, "thumbnails");
/** A saved image's 768 px WebP, made once per version of its file and kept beside the previews. */
async function cachedThumbnail(id, source) {
  const stat = fs.statSync(source);
  const file = path.join(thumbnailsDir, `${id}-${Math.round(stat.mtimeMs)}.webp`);
  if (fs.existsSync(file)) return file;
  const buffer = await sharp(source)
    .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  fs.mkdirSync(thumbnailsDir, { recursive: true });
  for (const old of fs.readdirSync(thumbnailsDir))
    if (old.startsWith(`${id}-`)) fs.rmSync(path.join(thumbnailsDir, old), { force: true });
  await writeBytesFileAsync(file, buffer, { durable: false });
  return file;
}

export function registerPresetRoutes(
  app,
  { models, json = civitaiJson, imageRequest = civitaiFetch, download = startLibraryDownload },
) {
  const route =
    (handler, write = false) =>
    async (req, res) => {
      if (!presetsEnabled()) {
        res.status(404).json({ ok: false, error: "Imports are off for this deployment." });
        return;
      }
      if (write && !requireLocal(req, res)) return;
      res.setHeader("Cache-Control", "no-store");
      try {
        await handler(req, res);
      } catch (error) {
        res.status(400).json({ ok: false, error: error.message });
      }
    };
  // The list matches by name and size only (never reading a model); opening one image verifies its checksums and updates its gallery copy.
  const matched = async (preset, catalogue, { verify = true } = {}) => {
    const resolved = await matchResources(preset, catalogue || (await models()), { verify });
    resolved.downloadWarnings = (resolved.downloadWarnings || []).filter((warning) =>
      resolved.resources.some(
        (resource) => resource.status === "missing" && warning.startsWith(`${resource.name}:`),
      ),
    );
    if (verify) refreshImportedItem(resolved);
    return summary(resolved);
  };
  const forgetLegacy = (id) => {
    if (!presets.some((item) => item.id === id)) return;
    presets = presets.filter((item) => item.id !== id);
    writeJsonFile(presetsPath, presets);
    if (/^[1-9]\d*$/.test(id)) fs.rmSync(path.join(previewsDir, `${id}.webp`), { force: true });
  };
  const images = () =>
    filterVisibleGallery(gallery)
      .filter((item) => item.civitai && importedImageFile(item))
      .map(presetFromGallery);
  let migration;
  const migrate = () => {
    if (migration) return;
    migration = (async () => {
      for (const preset of [...presets].filter((item) => !item.galleryItemId && item.previewUrl)) {
        try {
          await downloadPresetImage(preset, { models, imageRequest, download });
          forgetLegacy(preset.id);
        } catch {
          /* Keep an unavailable saved recipe so its image can be retried. */
        }
      }
    })();
  };
  const lookup = (id) =>
    /^[1-9]\d*$/.test(id)
      ? images().find((item) => item.id === id) || presets.find((item) => item.id === id)
      : null;

  app.get(
    "/api/presets",
    route(async (_req, res) => {
      migrate();
      const catalogue = await models();
      const saved = images();
      const ids = new Set(saved.map((image) => image.id));
      const list = [...saved, ...presets.filter((item) => !ids.has(item.id))];
      res.json({
        ok: true,
        presets: await Promise.all(list.map((item) => matched(item, catalogue, { verify: false }))),
        downloads: libraryDownloadAccess(),
      });
    }),
  );
  app.post(
    "/api/presets/import",
    route(async (req, res) => {
      const source = await importCivitaiImage(req.body?.url, { json });
      const preset = await downloadPresetImage(
        { ...source, savedAt: new Date().toISOString() },
        { models, imageRequest, download },
      );
      forgetLegacy(preset.id);
      if (imported.size > 50) imported.delete(imported.keys().next().value);
      res.json({ ok: true, preset: await matched(preset) });
    }, true),
  );
  app.post(
    "/api/presets/resolve",
    route(async (req, res) => {
      const preset = lookup(String(req.body?.id || ""));
      if (!preset) throw new Error("Import or select an image first.");
      res.json({ ok: true, preset: await matched(preset) });
    }),
  );
  app.post(
    "/api/presets",
    route(async (req, res) => {
      const id = String(req.body?.id || "");
      const preset = lookup(id);
      if (!preset) throw new Error("Import a preset before saving it.");
      const name = String(req.body?.name || preset.name)
        .trim()
        .slice(0, 120);
      if (!name) throw new Error("Give the preset a name.");
      const saved = await downloadPresetImage(
        { ...preset, name, savedAt: preset.savedAt || new Date().toISOString() },
        { models, imageRequest, download },
      );
      forgetLegacy(id);
      res.json({ ok: true, preset: await matched(saved) });
    }, true),
  );
  app.delete(
    "/api/presets/:id",
    route(async (req, res) => {
      const item = gallery.find((item) => item.id === `civitai:${req.params.id}`);
      if (item) {
        deleteGalleryFiles([item]);
        setGallery(gallery.filter((entry) => entry !== item));
      }
      forgetLegacy(req.params.id);
      res.json({ ok: true });
    }, true),
  );
  app.get(
    "/api/presets/:id/media",
    route(async (req, res) => {
      const item = gallery.find((item) => item.id === `civitai:${req.params.id}`);
      const file = importedImageFile(item);
      if (!file || !fs.existsSync(file)) {
        res.sendStatus(404);
        return;
      }
      if (item.type === "video") {
        res.type("mp4").sendFile(file);
        return;
      }
      res.type("png");
      const buffer = fs.readFileSync(file);
      res.send(req.query.clean === "1" ? stripMetadata(buffer).buffer : buffer);
    }),
  );
  app.get(
    "/api/presets/:id/video-preview",
    route(async (req, res) => {
      const item = gallery.find((item) => item.id === `civitai:${req.params.id}`);
      const file = importedImageFile(item);
      if (item?.type !== "video" || !file || !fs.existsSync(file)) {
        res.sendStatus(404);
        return;
      }
      if (req.query.poster === "1") {
        res.type("jpeg").sendFile(await getFileVideoPoster(file), { dotfiles: "allow" });
        return;
      }
      sendVideoPreview(req, res, await getFileVideoPreview(file));
    }),
  );
  app.get(
    "/api/presets/:id/thumbnail",
    route(async (req, res) => {
      if (!/^[1-9]\d*$/.test(req.params.id)) throw new Error("Unknown preview.");
      const file = path.join(previewsDir, `${req.params.id}.webp`);
      const item = gallery.find((item) => item.id === `civitai:${req.params.id}`);
      const local = importedImageFile(item);
      if (local && fs.existsSync(local)) {
        // Made once per file version; the browser keeps it and only checks that it is unchanged.
        res.setHeader("Cache-Control", "private, no-cache");
        if (item.type === "video") {
          res.type("jpeg").sendFile(await getFileVideoPoster(local), { dotfiles: "allow" });
          return;
        }
        res
          .type("webp")
          .sendFile(await cachedThumbnail(req.params.id, local), { dotfiles: "allow" });
        return;
      }
      if (presets.some((entry) => entry.id === req.params.id) && fs.existsSync(file) && !item) {
        res.type("webp").send(fs.readFileSync(file));
        return;
      }
      const preset = lookup(req.params.id);
      if (!preset?.previewUrl) {
        res.sendStatus(404);
        return;
      }
      const response = await imageRequest(
        preset.previewUrl,
        { signal: AbortSignal.timeout(30000) },
        { media: true },
      );
      if (!response.ok) {
        await response.body?.cancel();
        res.sendStatus(404);
        return;
      }
      const buffer = await sharp(await limitedBody(response, 15 * 1024 * 1024), {
        limitInputPixels: 40000000,
      })
        .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      res.type("webp").send(buffer);
    }),
  );
  app.get(
    "/api/library/downloads",
    route(async (_req, res) => {
      await refreshWorkerModels();
      res.json({ ok: true, downloads: libraryDownloads(), access: libraryDownloadAccess() });
    }),
  );
  app.post(
    "/api/library/downloads/preview",
    route(async (req, res) => {
      const spec = await resolveModelLink(req.body?.url, req.body?.folder, { json });
      const { url, sha256, ...file } = spec;
      imported.set(`download:${spec.id}`, spec);
      if (imported.size > 50) imported.delete(imported.keys().next().value);
      res.json({ ok: true, file });
    }, true),
  );
  app.post(
    "/api/library/downloads",
    route(async (req, res) => {
      let spec;
      if (req.body?.versionId) {
        const versionId = Number(req.body.versionId);
        if (!Number.isSafeInteger(versionId) || versionId < 1)
          throw new Error("Choose a valid model version.");
        spec = versionResource(await json(`model-versions/${versionId}`)).spec;
      } else {
        const id = String(req.body?.id || "");
        spec = imported.get(`download:${id}`) || libraryDownload(id);
      }
      if (!spec) throw new Error("Preview a supported model before downloading it.");
      res.json({ ok: true, download: await startLibraryDownload(spec) });
    }, true),
  );
  // The Library's Import page (library-routes.js): a saved image without its files queued, which
  // Download Missing does in one tap, and a saved image matched again.
  const importImage = async (url) => {
    const source = await importCivitaiImage(url, { json });
    const preset = await downloadPresetImage(
      { ...source, savedAt: new Date().toISOString() },
      { models, imageRequest, download: async () => null },
    );
    forgetLegacy(preset.id);
    return matched(preset);
  };
  const resolvePreset = async (id, { verify = false } = {}) => {
    const preset = lookup(String(id || ""));
    if (!preset) throw new Error("That saved image is gone.");
    return matched(preset, undefined, { verify });
  };
  return { importImage, resolvePreset };
}
