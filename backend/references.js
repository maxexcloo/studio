import crypto from "node:crypto";
import { mediaFile, mediaParams, mediaPath, mediaSubfolder } from "./media-paths.js";
import fs from "node:fs";
import path from "node:path";
import Busboy from "busboy";
import { comfy, comfyOutputDir, comfyInputDir } from "./comfy.js";
import {
  addGalleryItems,
  importedImageFile,
  filterVisibleGallery,
  gallery,
  galleryKey,
  outputFileCandidates,
} from "./gallery-store.js";

import { extractLastFrame } from "./video-previews.js";
import { writeBytesFileAsync } from "./json-store.js";
import { isInside } from "./paths.js";
import { loadSharp } from "./sharp-loader.js";
import { prepareInputImage } from "./input-image-sizing.js";
import { forgetComfyRun } from "./comfy-traces.js";
import { families } from "./family-catalog.js";
import { mimeExtension, referenceInputName } from "./reference-names.js";
import { uploadedGalleryItem } from "./uploads.js";
import { recordBelongsToAccount } from "./account-ownership.js";

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

function encodedGalleryId(item) {
  return `gallery:${Buffer.from(String(galleryKey(item))).toString("base64url")}`;
}

function galleryAsset(item) {
  return {
    id: encodedGalleryId(item),
    source: item.uploaded ? "upload" : "generation",
    name: (item.uploaded ? item.filename : item.outputName || item.filename) || "Generated image",
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

/** An uploaded image as a gallery image (uploads.js); the same bytes from the same owner return the first copy. */
export async function saveUploadedImage({ buffer, name, mime: declaredMime = "" }, ownerId = "") {
  if (!buffer?.length) throw new Error("That image is empty.");
  if (buffer.length > maxUploadBytes)
    throw new Error(
      `Reference images can be up to ${Math.round(maxUploadBytes / 1024 / 1024)} MB.`,
    );
  const inspected = await inspectImage(buffer, declaredMime);
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const stored = (item) => {
    const media = mediaParams(item.url);
    return Boolean(media && mediaFile(media.filename, media.subfolder));
  };
  const existing = gallery.find(
    (item) =>
      item.uploaded && item.hash === hash && (item.ownerId || "") === ownerId && stored(item),
  );
  if (existing) return { item: existing, asset: galleryAsset(existing) };
  const id = crypto.randomUUID();
  const subfolder = mediaSubfolder(ownerId);
  const filename = `${id}.${mimeExtension(inspected.mime)}`;
  const file = mediaPath(filename, subfolder);
  if (!file) throw new Error("This upload's name cannot be stored.");
  await writeBytesFileAsync(file, buffer, { mode: 0o600 });
  const item = uploadedGalleryItem({
    id,
    ownerId,
    name: safeName(name),
    ...inspected,
    size: buffer.length,
    hash,
    createdAt: new Date().toISOString(),
    filename,
    subfolder,
  });
  addGalleryItems([item]);
  return { item, asset: galleryAsset(item) };
}

function decodeGalleryReference(id = "") {
  if (!String(id).startsWith("gallery:")) return "";
  try {
    return Buffer.from(String(id).slice(8), "base64url").toString("utf8");
  } catch {
    return "";
  }
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

export async function publicGalleryBuffer(item) {
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
  if (!item || item.type !== "video" || item.status !== "done" || !item.url)
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
  if (!item || item.type !== "video" || item.status !== "done")
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
  const publicItem = findGalleryItemForAccount(galleryItemId, account);
  if (publicItem && publicItem.type === "image" && publicItem.status === "done" && publicItem.url)
    return galleryAsset(publicItem);
  throw new Error("That image is no longer in the gallery.");
}

/** Reopen one saved reference without enumerating the catalogue or reading worker media. */
export function referenceAssetMetadataForAccount(account, id) {
  const lastFrame = String(id).endsWith(lastFrameSuffix);
  const item = findGalleryItemForAccount(
    lastFrame ? String(id).slice(0, -lastFrameSuffix.length) : id,
    account,
  );
  if (!item || item.status !== "done" || !item.url || item.type !== (lastFrame ? "video" : "image"))
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
  const lastFrame = String(id).endsWith(lastFrameSuffix);
  const item = findGalleryItemForAccount(
    lastFrame ? String(id).slice(0, -lastFrameSuffix.length) : id,
    account,
  );
  return Boolean(
    item && item.status === "done" && item.url && item.type === (lastFrame ? "video" : "image"),
  );
}

/** The bytes a run gets for a reference (exported for tests). */
export async function bytesForReference(req, id) {
  return bytesForReferenceAccount(req?.studioAccount, id);
}

export async function bytesForReferenceAccount(account, id) {
  if (String(id).endsWith(lastFrameSuffix))
    return lastFrameBytes(account, String(id).slice(0, -lastFrameSuffix.length));
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
    ? `studio-${crypto.randomUUID()}.${mimeExtension(mime)}`
    : referenceInputName(buffer, mime);
  const form = new FormData();
  form.append("image", new Blob([buffer], { type: mime }), filename);
  form.append("type", "input");
  form.append("overwrite", "false");
  const uploaded = await comfy("/upload/image", { method: "POST", body: form });
  return { comfyName: uploaded.name || filename, name: safeName(name), mime };
}

export function stageReferenceAssets(req, references = [], options = {}) {
  return stageReferenceAssetsForAccount(req?.studioAccount, references, options);
}

export async function stageReferenceAssetsForAccount(
  account,
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
      const original = await bytesForReferenceAccount(account, assetId);
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
