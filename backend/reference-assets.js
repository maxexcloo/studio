import crypto from "node:crypto";
import { mediaFile, mediaParams } from "./media-paths.js";
import fs from "node:fs";
import path from "node:path";
import Busboy from "busboy";
import { comfy, comfyOutputDir, comfyInputDir } from "./comfy.js";
import {
  dataDir,
  importedImageFile,
  filterVisibleGallery,
  gallery,
  galleryKey,
  outputFileCandidates,
} from "./gallery-store.js";

import { extractLastFrame } from "./video-previews.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { isInside } from "./paths.js";
import { loadSharp } from "./sharp-loader.js";
import { prepareInputImage } from "./input-image-sizing.js";
import { forgetComfyRun } from "./comfy-traces.js";
import { families } from "./family-catalog.js";
import { mimeExtension, referenceInputName } from "./reference-names.js";
import {
  ownerIdForRequest,
  recordBelongsToRequest,
  recordBelongsToAccount,
  recordsForRequest,
} from "./account-ownership.js";

const assetsDir = path.join(dataDir, "reference-assets");
const filesDir = path.join(assetsDir, "files");
const thumbsDir = path.join(assetsDir, "thumbnails");
const manifestPath = path.join(assetsDir, "index.json");
const maxUploadBytes = Math.max(
  1024,
  Number(process.env.STUDIO_REFERENCE_MAX_BYTES || 25 * 1024 * 1024),
);
const maxPixels = Math.max(
  1_000_000,
  Number(process.env.STUDIO_REFERENCE_MAX_PIXELS || 80_000_000),
);
const acceptedMimes = new Set(["image/png", "image/jpeg", "image/webp"]);

function safeName(value = "reference-image") {
  return (
    path
      .basename(String(value || "reference-image"))
      .replace(/[^\w.() -]+/g, "-")
      .slice(0, 180) || "reference-image"
  );
}

function mimeFromName(name = "") {
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.webp$/i.test(name)) return "image/webp";
  return "image/png";
}

function ensureDirs() {
  fs.mkdirSync(filesDir, { recursive: true });
  fs.mkdirSync(thumbsDir, { recursive: true });
}

// The crash-safe JSON store (json-store.js), like every other file Studio remembers.
function loadManifest() {
  try {
    const parsed = readJsonFile(manifestPath);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeManifest(items) {
  ensureDirs();
  writeJsonFile(manifestPath, items, { mode: 0o600 });
}

function publicUploadAsset(record) {
  return {
    id: record.id,
    source: "upload",
    name: record.name,
    mime: record.mime,
    width: record.width,
    height: record.height,
    size: record.size,
    createdAt: record.createdAt,
    thumbnailUrl: `/api/reference-assets/${encodeURIComponent(record.id)}/thumbnail`,
    url: `/api/reference-assets/${encodeURIComponent(record.id)}/media`,
  };
}

function encodedGalleryId(item) {
  return `gallery:${Buffer.from(String(galleryKey(item))).toString("base64url")}`;
}

function galleryAsset(item) {
  return {
    id: encodedGalleryId(item),
    source: "generation",
    name: item.outputName || item.filename || "Generated image",
    mime: item.mime || mimeFromName(item.outputName || item.filename || item.url),
    width: Number(item.width || 0),
    height: Number(item.height || 0),
    size: Number(item.size || 0),
    createdAt: item.createdAt || "",
    // The version on show: the upscale when it is switched on, as a run will use.
    thumbnailUrl:
      (item.upscaleActive && item.upscale?.url
        ? item.upscale.thumbnailUrl || item.upscale.url
        : item.thumbnailUrl) ||
      item.url ||
      "",
    url: item.url || "",
    galleryItemId: item.id,
  };
}

// The page is mapped, not the whole shelf: a large gallery would otherwise
// build an asset object for every image before returning thirty of them.
function paginate(items, cursor = "", limit = 60, map = (item) => item) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit || 60)));
  const start = Math.max(0, Number(cursor || 0) || 0);
  const page = items.slice(start, start + safeLimit).map(map);
  const next = start + safeLimit;
  return {
    items: page,
    nextCursor: next < items.length ? String(next) : "",
    hasMore: next < items.length,
  };
}

const finishedImage = (item) => item.status === "done" && item.type === "image" && item.url;
const newestFirst = (a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);

/** One shelf of references: uploads (the default) or finished generations. */
export function listReferenceAssets(
  req,
  { source = "upload", cursor = "", limit = 60, q = "" } = {},
) {
  const words = String(q).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = (item) => {
    if (!words.length) return true;
    const text = [item.name, item.outputName, item.filename, item.prompt, item.model]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  };
  if (source === "generation") {
    return paginate(
      filterVisibleGallery(recordsForRequest(gallery, req))
        .filter((item) => finishedImage(item) && !item.library && matches(item))
        .sort(newestFirst),
      cursor,
      limit,
      galleryAsset,
    );
  }

  const items = loadManifest()
    .filter(
      (item) => item.source === "upload" && recordBelongsToRequest(item, req) && matches(item),
    )
    .sort(newestFirst);
  return paginate(items, cursor, limit, publicUploadAsset);
}

export function readMultipartImage(req) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let found = false;
    let limited = false;
    let name = "reference-image";
    let mime = "";
    const chunks = [];
    let size = 0;
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: maxUploadBytes, fields: 4 },
      });
    } catch (error) {
      reject(new Error(`The upload failed: ${error.message}`));
      return;
    }
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    parser.on("file", (field, file, info) => {
      if (field !== "image" || found) {
        file.resume();
        return;
      }
      found = true;
      name = safeName(info.filename);
      mime = String(info.mimeType || "").toLowerCase();
      file.on("limit", () => {
        limited = true;
      });
      file.on("data", (chunk) => {
        size += chunk.length;
        chunks.push(chunk);
      });
      file.on("error", fail);
    });
    parser.on("error", fail);
    parser.on("finish", () => {
      if (settled) return;
      if (!found) return fail(new Error("Choose an image to upload."));
      if (limited || size > maxUploadBytes)
        return fail(
          new Error(
            `Reference images can be up to ${Math.round(maxUploadBytes / 1024 / 1024)} MB.`,
          ),
        );
      settled = true;
      resolve({ buffer: Buffer.concat(chunks), name, mime, size });
    });
    req.pipe(parser);
  });
}

/**
 * What the file's first bytes say it is, for when sharp is missing. Only PNG
 * carries its size this plainly; the others report 0 × 0 like gallery items do.
 */
function sniffImage(buffer) {
  if (buffer.length > 24 && buffer.readUInt32BE(0) === 0x89504e47)
    return { format: "png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return { format: "jpeg", width: 0, height: 0 };
  if (
    buffer.length > 12 &&
    buffer.toString("latin1", 0, 4) === "RIFF" &&
    buffer.toString("latin1", 8, 12) === "WEBP"
  )
    return { format: "webp", width: 0, height: 0 };
  return {};
}

async function inspectImage(buffer, declaredMime = "") {
  const sharp = await loadSharp();
  const metadata = sharp
    ? await sharp(buffer, { limitInputPixels: maxPixels }).metadata()
    : sniffImage(buffer);
  const mime =
    metadata.format === "jpeg"
      ? "image/jpeg"
      : metadata.format === "webp"
        ? "image/webp"
        : metadata.format === "png"
          ? "image/png"
          : "";
  if (!mime || !acceptedMimes.has(mime)) throw new Error("Choose a PNG, JPEG or WebP image.");
  if (declaredMime && acceptedMimes.has(declaredMime) && declaredMime !== mime)
    throw new Error("That file isn’t the type of image its name says.");
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if ((sharp || metadata.format === "png") && (!width || !height || width * height > maxPixels))
    throw new Error("That image is too large, or its size can’t be read.");
  return { mime, width, height };
}

export async function saveUploadedReference(
  { buffer, name, mime: declaredMime = "" },
  ownerId = "",
) {
  if (!buffer?.length) throw new Error("That image is empty.");
  if (buffer.length > maxUploadBytes)
    throw new Error(
      `Reference images can be up to ${Math.round(maxUploadBytes / 1024 / 1024)} MB.`,
    );
  const inspected = await inspectImage(buffer, declaredMime);
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const existing = loadManifest().find(
    (item) =>
      item.hash === hash && item.source === "upload" && String(item.ownerId || "") === ownerId,
  );
  if (
    existing &&
    fs.existsSync(path.join(filesDir, existing.file)) &&
    fs.existsSync(path.join(thumbsDir, existing.thumbnail))
  )
    return publicUploadAsset(existing);
  ensureDirs();
  const id = crypto.randomUUID();
  const ext = mimeExtension(inspected.mime);
  const file = `${id}.${ext}`;
  fs.writeFileSync(path.join(filesDir, file), buffer, { mode: 0o600 });
  const sharp = await loadSharp();
  // Without sharp the thumbnail is a copy of the original, in its own format.
  const thumbnail = sharp ? `${id}.webp` : `${id}-thumb.${ext}`;
  if (sharp)
    await sharp(buffer, { limitInputPixels: maxPixels })
      .rotate()
      .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(path.join(thumbsDir, thumbnail));
  else fs.writeFileSync(path.join(thumbsDir, thumbnail), buffer, { mode: 0o600 });
  const record = {
    id,
    source: "upload",
    name: safeName(name),
    mime: inspected.mime,
    width: inspected.width,
    height: inspected.height,
    size: buffer.length,
    hash,
    file,
    thumbnail,
    ...(ownerId ? { ownerId } : {}),
    createdAt: new Date().toISOString(),
  };
  writeManifest([record, ...loadManifest()]);
  return publicUploadAsset(record);
}

export function readUploadedReference(id, variant = "media", ownerId = "") {
  const record = loadManifest().find(
    (item) =>
      item.id === String(id || "") &&
      item.source === "upload" &&
      String(item.ownerId || "") === ownerId,
  );
  if (!record) return null;
  const isThumb = variant === "thumbnail";
  const file = path.join(isThumb ? thumbsDir : filesDir, isThumb ? record.thumbnail : record.file);
  const base = path.resolve(isThumb ? thumbsDir : filesDir);
  const resolved = path.resolve(file);
  if (!resolved.startsWith(`${base}${path.sep}`) || !fs.existsSync(resolved)) return null;
  return {
    file: resolved,
    mime: isThumb && record.thumbnail.endsWith(".webp") ? "image/webp" : record.mime,
    name: record.name,
  };
}

export function deleteUploadedReference(id, ownerId = "") {
  const records = loadManifest();
  const record = records.find(
    (item) =>
      item.id === String(id || "") &&
      item.source === "upload" &&
      String(item.ownerId || "") === ownerId,
  );
  if (!record) throw new Error("That reference image is gone.");
  for (const [baseDir, filename] of [
    [filesDir, record.file],
    [thumbsDir, record.thumbnail],
  ]) {
    const base = path.resolve(baseDir);
    const target = path.resolve(baseDir, filename || "");
    if (filename && target.startsWith(`${base}${path.sep}`)) {
      try {
        fs.unlinkSync(target);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  writeManifest(records.filter((item) => item.id !== record.id));
  return { ok: true, id: record.id };
}

function decodeGalleryReference(id = "") {
  if (!String(id).startsWith("gallery:")) return "";
  try {
    return Buffer.from(String(id).slice(8), "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function findGalleryItem(id = "", req = null) {
  return findGalleryItemForAccount(id, req?.studioAccount);
}

function findGalleryItemForAccount(id, account) {
  const decoded = decodeGalleryReference(id);
  const wanted = decoded || String(id || "");
  return (
    gallery.find(
      (item) =>
        recordBelongsToAccount(item, account) &&
        (galleryKey(item) === wanted || item.id === wanted || item.url === wanted) &&
        filterVisibleGallery([item]).length,
    ) || null
  );
}

async function publicGalleryBuffer(item) {
  const imported = importedImageFile(item);
  if (imported && fs.existsSync(imported))
    return { buffer: fs.readFileSync(imported), mime: "image/png", name: item.outputName };
  const media = mediaParams(item.url);
  if (media) {
    const file = mediaFile(media.filename, media.subfolder);
    if (!file) throw new Error("That image is no longer in the gallery.");
    return {
      buffer: fs.readFileSync(file),
      mime: mimeFromName(file),
      name: item.outputName || path.basename(file),
    };
  }
  const base = comfyOutputDir ? path.resolve(comfyOutputDir) : "";
  const file = outputFileCandidates(item).find((candidate) => {
    const resolved = path.resolve(candidate);
    return (
      base && isInside(base, resolved) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()
    );
  });
  if (file)
    return {
      buffer: fs.readFileSync(file),
      mime: mimeFromName(file),
      name: item.outputName || path.basename(file),
    };
  if (!String(item.url || "").startsWith("/comfy/"))
    throw new Error("That image is no longer in the gallery.");
  const relative = String(item.url).replace(/^\/comfy/, "");
  const data = await comfy(relative);
  return {
    buffer: Buffer.from(data),
    mime: mimeFromName(item.outputName || item.filename || item.url),
    name: item.outputName || item.filename || "generated-image.png",
  };
}

// Marks a reference to a finished video's last frame, which is cut from the video when a run is staged.
const lastFrameSuffix = ":last-frame";

/**
 * A finished video of this request's own, as the reference for its last frame.
 * Nothing is stored: the id carries the video's own reference and the frame
 * is cut when used.
 */
function lastFrameAssetForAccount(account, galleryItemId) {
  const item = findGalleryItemForAccount(galleryItemId, account);
  if (!item || item.type !== "video" || item.status !== "done" || !item.url || item.library)
    throw new Error("That video is no longer in the gallery.");
  const asset = galleryAsset(item);
  return {
    ...asset,
    id: `${asset.id}${lastFrameSuffix}`,
    name: `${String(asset.name).replace(/\.[a-z0-9]+$/i, "")} last frame.png`,
    mime: "image/png",
    size: 0,
    url: "",
    thumbnailUrl: item.thumbnailUrl || "",
  };
}

async function lastFrameBytes(account, videoId) {
  const item = findGalleryItemForAccount(videoId, account);
  if (!item || item.type !== "video" || item.status !== "done" || item.library)
    throw new Error("That video is no longer in the gallery.");
  const video = {
    buffer: (await publicGalleryBuffer(item)).buffer,
    name: item.outputName || item.filename || "video",
  };
  return {
    buffer: await extractLastFrame(video.buffer),
    mime: "image/png",
    name: `${String(video.name).replace(/\.[a-z0-9]+$/i, "")}-last-frame.png`,
  };
}

export function referenceAssetFromGallery(req, galleryItemId, { frame = "" } = {}) {
  return referenceAssetForAccount(req?.studioAccount, galleryItemId, { frame });
}

export function referenceAssetForAccount(account, galleryItemId, { frame = "" } = {}) {
  if (frame === "last") return lastFrameAssetForAccount(account, galleryItemId);
  // Images added from another folder are shown in place, not ComfyUI outputs it can read back.
  const publicItem = findGalleryItemForAccount(galleryItemId, account);
  if (
    publicItem &&
    publicItem.type === "image" &&
    publicItem.status === "done" &&
    !publicItem.library &&
    publicItem.url
  )
    return galleryAsset(publicItem);
  throw new Error("That image is no longer in the gallery.");
}

/** Reopen one saved reference without enumerating the catalogue or reading worker media. */
export function referenceAssetMetadataForAccount(account, id) {
  const upload = loadManifest().find(
    (item) => item.id === id && item.source === "upload" && recordBelongsToAccount(item, account),
  );
  if (upload && readUploadedReference(id, "media", account?.userId || ""))
    return publicUploadAsset(upload);
  const lastFrame = String(id).endsWith(lastFrameSuffix);
  const item = findGalleryItemForAccount(
    lastFrame ? String(id).slice(0, -lastFrameSuffix.length) : id,
    account,
  );
  if (
    !item ||
    item.library ||
    item.status !== "done" ||
    !item.url ||
    item.type !== (lastFrame ? "video" : "image")
  )
    throw new Error("That reference image is gone.");
  const asset = lastFrame ? lastFrameAssetForAccount(account, item.id) : galleryAsset(item);
  return { ...asset, id };
}

/**
 * An image shown upscaled is used upscaled: its sharper pixels, scaled back to
 * the original's size, since an image-to-image start image is encoded at its
 * own size and a 4x one would make a 4x render (slow, and often out of GPU
 * memory). Decided when a run is staged, so switching the upscale off in the
 * viewer goes back to the original for the next run. Without sharp, or when
 * anything about the upscale is off, the original is used.
 */
async function preferUpscale(original, readUpscale) {
  try {
    const upscaled = await readUpscale();
    const sharp = upscaled && (await loadSharp());
    if (!sharp) return original;
    const { width, height } = await sharp(original.buffer, {
      limitInputPixels: maxPixels,
    }).metadata();
    if (!width || !height) return original;
    const buffer = await sharp(upscaled.buffer, { limitInputPixels: maxPixels })
      .resize({ width, height, fit: "fill", kernel: "lanczos3" })
      .png()
      .toBuffer();
    return {
      buffer,
      mime: "image/png",
      name: String(original.name || "reference").replace(/\.[a-z0-9]+$/i, "") + ".png",
    };
  } catch {
    return original;
  }
}

/** Ownership can be checked while a selected worker is offline, without fetching its media. */
export function referenceExistsForAccount(account, id) {
  if (readUploadedReference(id, "media", account?.userId || "")) return true;
  const lastFrame = String(id).endsWith(lastFrameSuffix);
  const item = findGalleryItemForAccount(
    lastFrame ? String(id).slice(0, -lastFrameSuffix.length) : id,
    account,
  );
  return Boolean(
    item &&
    !item.library &&
    item.status === "done" &&
    item.url &&
    item.type === (lastFrame ? "video" : "image"),
  );
}

/** The bytes a run gets for a reference (exported for tests). */
export async function bytesForReference(req, id) {
  return bytesForReferenceAccount(req?.studioAccount, id);
}

export async function bytesForReferenceAccount(account, id) {
  if (String(id).endsWith(lastFrameSuffix))
    return lastFrameBytes(account, String(id).slice(0, -lastFrameSuffix.length));

  const ownerId = account?.userId || "";
  const upload = loadManifest().find(
    (item) => item.id === id && item.source === "upload" && String(item.ownerId || "") === ownerId,
  );
  if (upload) {
    const file = path.resolve(filesDir, upload.file);
    if (!file.startsWith(`${path.resolve(filesDir)}${path.sep}`) || !fs.existsSync(file))
      throw new Error("That reference image is gone.");
    return { buffer: fs.readFileSync(file), mime: upload.mime, name: upload.name };
  }
  const item = findGalleryItemForAccount(id, account);
  if (!item || item.type !== "image" || item.status !== "done")
    throw new Error("That image is no longer in the gallery.");
  const original = await publicGalleryBuffer(item);
  if (!item.upscaleActive || item.upscale?.status !== "done" || !item.upscale.url) return original;
  const { url, outputName } = item.upscale;
  return preferUpscale(original, () =>
    publicGalleryBuffer({ id: url, url, outputName, type: "image" }),
  );
}

export async function uploadBufferToComfy({ buffer, mime, name }, { unique = false } = {}) {
  await inspectImage(buffer, mime);
  // Content-named files are shared between runs; a run-only copy gets its own name,
  // so removing it afterwards can never pull an input out from under another job.
  const filename = unique
    ? `heiss-ui-${crypto.randomUUID()}.${mimeExtension(mime)}`
    : referenceInputName(buffer, mime);
  const form = new FormData();
  form.append("image", new Blob([buffer], { type: mime }), filename);
  form.append("type", "input");
  form.append("overwrite", "false");
  const uploaded = await comfy("/upload/image", { method: "POST", body: form });
  return { comfyName: uploaded.name || filename, name: safeName(name), mime };
}

export async function stageReferenceAssets(
  req,
  references = [],
  { unique = false, generation = null } = {},
) {
  const staged = [];
  try {
    for (const reference of Array.isArray(references) ? references : []) {
      const assetId = String(reference?.assetId || "");
      const slot = String(reference?.slot || "reference");
      if (!assetId) continue;
      const family = generation && families[generation.family];
      // Inpaint stitches the crop back onto the full original. Its existing crop pipeline
      // already limits sampling pixels and keeps the painted mask aligned.
      const keepOriginal = generation?.inpaint && staged.length === 0;
      const pixels =
        generation && generation.autoResizeInputs !== false && !keepOriginal
          ? Number(generation.width) * Number(generation.height)
          : 0;
      const step = family?.img2img && !family.references ? family.sizeStep || 8 : 1;
      const original = await bytesForReference(req, assetId);
      const inspected = await inspectImage(original.buffer, original.mime);
      const bytes = await prepareInputImage({ ...original, ...inspected }, { pixels, step });
      // Remote ComfyUI has no native input-delete endpoint. Reuse content names there
      // instead of accumulating a new public resized file on every run.
      const temporary = unique || Boolean(bytes.resized && comfyInputDir());
      const uploaded = await uploadBufferToComfy(bytes, { unique: temporary });
      staged.push({
        slot,
        assetId,
        source: String(reference?.source || ""),
        ...uploaded,
        ...(temporary ? { temporary: true } : {}),
        ...(bytes.width ? { width: bytes.width, height: bytes.height } : {}),
      });
    }
    return staged;
  } catch (error) {
    await forgetComfyRun({
      inputNames: staged.filter((item) => item.temporary).map((item) => item.comfyName),
    });
    throw error;
  }
}
