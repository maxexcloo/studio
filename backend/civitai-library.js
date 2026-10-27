import fs from "node:fs";
import sharp from "sharp";
import { civitaiFetch, limitedBody } from "./civitai-access.js";
import { parametersText } from "./civitai.js";
import { matchResources } from "./civitai-import.js";
import { addGalleryItems, gallery, importedImageFile } from "./gallery-store.js";
import { startLibraryDownload } from "./library-downloads.js";
import { withPngText } from "./png-text.js";
import { probeVideo } from "./video-previews.js";
import { writeBytesFileAsync } from "./json-store.js";

function importedGalleryItem(preset, previous = {}) {
  const checkpoint = preset.resources.find((item) =>
    ["checkpoints", "diffusion_models"].includes(item.folder),
  );
  const vae = preset.resources.find((item) => item.folder === "vae");
  const encoders = preset.resources
    .filter((item) => item.folder === "text_encoders")
    .map((item) => item.localName || item.file)
    .filter(Boolean);
  return {
    ...previous,
    id: `civitai:${preset.id}`,
    url: `/api/presets/${preset.id}/media`,
    thumbnailUrl: `/api/presets/${preset.id}/thumbnail`,
    type: preset.type || "image",
    status: "done",
    filename: preset.name,
    outputName: `civitai-${preset.id}.${preset.type === "video" ? "mp4" : "png"}`,
    createdAt: preset.savedAt || previous.createdAt || new Date().toISOString(),
    prompt: preset.prompt,
    negative: preset.negative,
    width: preset.imageWidth || preset.settings.width,
    height: preset.imageHeight || preset.settings.height,
    model: checkpoint?.localName || checkpoint?.file || preset.baseModel,
    settings: {
      ...preset.settings,
      count: 1,
      workflow: "",
      profileId: checkpoint?.profileId || "",
      ...(vae ? { vae: vae.localName || vae.file } : {}),
      ...(encoders.length ? { textEncoder: encoders[0], textEncoders: encoders } : {}),
      loras: preset.resources
        .filter(
          (item) =>
            item.folder === "loras" && item.weight !== null && (item.localName || item.file),
        )
        .map((item) => ({
          name: item.localName || item.file,
          strength: item.weight,
          enabled: true,
        })),
    },
    civitai: {
      imageId: preset.id,
      sourceUrl: preset.sourceUrl,
      creator: preset.creator,
      baseModel: preset.baseModel,
      resources: preset.resources,
      settings: preset.settings,
      sourceMetadata: preset.sourceMetadata,
      type: preset.type || "image",
      warnings: preset.warnings,
      previewUrl: preset.previewUrl,
      downloadWarnings: preset.downloadWarnings || [],
    },
  };
}

export function presetFromGallery(item) {
  return {
    ...item.civitai,
    id: item.civitai.imageId,
    name: item.filename,
    prompt: item.prompt,
    negative: item.negative,
    savedAt: item.createdAt,
    galleryItemId: item.id,
    imageWidth: item.width,
    imageHeight: item.height,
    thumbnailUrl: item.thumbnailUrl,
  };
}

export function refreshImportedItem(preset) {
  const previous = gallery.find((item) => item.id === `civitai:${preset.id}`);
  if (!previous || !fs.existsSync(importedImageFile(previous))) return;
  const item = importedGalleryItem(preset, previous);
  if (JSON.stringify(item) !== JSON.stringify(previous)) addGalleryItems([item]);
}

export async function downloadPresetImage(
  preset,
  { models, imageRequest = civitaiFetch, download = startLibraryDownload } = {},
) {
  if (!/^[1-9]\d*$/.test(preset.id)) throw new Error("Choose a valid Civitai image.");
  let matched = await matchResources(preset, await models());
  const item = importedGalleryItem(
    matched,
    gallery.find((item) => item.id === `civitai:${preset.id}`),
  );
  const file = importedImageFile(item);
  if (item.type === "video") {
    if (!fs.existsSync(file)) {
      if (!preset.previewUrl) throw new Error("This video has no downloadable link.");
      const response = await imageRequest(
        preset.previewUrl,
        { signal: AbortSignal.timeout(120000) },
        { media: true },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("The source video could not be downloaded. Try again.");
      }
      const data = await limitedBody(response, 512 * 1024 * 1024);
      await writeBytesFileAsync(file, data, {
        mode: 0o600,
        validate: async (temporary) => {
          const info = await probeVideo(temporary);
          if (!info) throw new Error("The source video could not be read.");
          item.width = info.width;
          item.height = info.height;
        },
      });
    }
  } else {
    let data;
    if (!fs.existsSync(file)) {
      if (!preset.previewUrl) throw new Error("This image has no downloadable image link.");
      const response = await imageRequest(
        preset.previewUrl,
        { signal: AbortSignal.timeout(60000) },
        { media: true },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("The source image could not be downloaded. Try again.");
      }
      const decoded = await sharp(await limitedBody(response, 50 * 1024 * 1024), {
        limitInputPixels: 80000000,
      })
        .rotate()
        .png()
        .toBuffer({ resolveWithObject: true });
      data = decoded.data;
      const { info } = decoded;
      item.width = info.width;
      item.height = info.height;
    } else {
      data = fs.readFileSync(file);
      const info = await sharp(data).metadata();
      item.width = info.width;
      item.height = info.height;
    }
    const metadata = {
      prompt: item.prompt,
      negative: item.negative,
      width: item.width,
      height: item.height,
      model: item.model,
      settings: item.settings,
      civitai: item.civitai,
    };
    const hashes = Object.fromEntries(
      matched.resources
        .filter((resource) => resource.file && resource.sha256)
        .map((resource) => [resource.localName || resource.file, resource.sha256.slice(0, 10)]),
    );
    const parameters = parametersText(
      { ...item.settings, prompt: item.prompt, negative: item.negative, model: item.model },
      { width: item.width, height: item.height, hashes },
    );
    const annotated = withPngText(data, "civitai", JSON.stringify(metadata)) || data;
    const buffer = withPngText(annotated, "parameters", parameters) || annotated;
    await writeBytesFileAsync(file, buffer, { mode: 0o600 });
  }
  addGalleryItems([item]);
  const downloadWarnings = [];
  for (const resource of matched.resources.filter(
    (item) => item.status === "missing" && item.supported,
  )) {
    const spec = preset.resources.find((item) => item.versionId === resource.versionId)?.spec;
    if (!spec) continue;
    try {
      await download(spec);
    } catch (error) {
      downloadWarnings.push(`${resource.name}: ${error.message}`);
    }
  }
  if (downloadWarnings.length && gallery.some((current) => current.id === item.id)) {
    item.civitai.downloadWarnings = downloadWarnings;
    addGalleryItems([item]);
  }
  matched = {
    ...preset,
    galleryItemId: item.id,
    imageWidth: item.width,
    imageHeight: item.height,
    downloadWarnings,
  };
  return matched;
}
