import crypto from "node:crypto";
import {
  mediaFile,
  mediaParams,
  mediaPath,
  mediaRoot,
  mediaSubfolder,
  mediaType,
} from "./media-paths.js";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import { comfy } from "./comfy/comfy.js";
import {
  addGalleryItems,
  importedImageFile,
  filterVisibleGallery,
  gallery,
} from "./gallery/store.js";

import { extractFrame, getComfyVideoPoster, probeVideo } from "./video-previews.js";
import { writeBytesFileAsync } from "./json-store.js";
import { loadSharp } from "./sharp-loader.js";
import { prepareInputImage } from "./input-image-sizing.js";
import { families } from "./family-catalogue.js";
import { imageMimes, mimeExtension, referenceInputName } from "./reference-names.js";
import { uploadedGalleryItem } from "./uploads.js";
import { recordBelongsToAccount } from "./account-ownership.js";
import { galleryKey } from "./persistence/gallery-rows.ts";

export const maxUploadBytes = Math.max(
  1024,
  Number(process.env.STUDIO_REFERENCE_MAX_BYTES || 25 * 1024 * 1024),
);
const maxVideoBytes = Math.max(maxUploadBytes, 200 * 1024 * 1024);
const megabytes = (bytes) => Math.round(bytes / 1024 / 1024);
const maxPixels = Math.max(
  1_000_000,
  Number(process.env.STUDIO_REFERENCE_MAX_PIXELS || 80_000_000),
);
const acceptedMimes = new Set(imageMimes);

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

/**
 * Where multipart uploads are written while they arrive: a dot folder in the media folder, never
 * served (media-paths.js) and on the same disk, so a video is moved into place rather than copied.
 */
const uploadsInFlight = path.join(mediaRoot, ".uploads");
const staleUploadMs = 24 * 60 * 60 * 1000;

/** Removes what a crash left mid-upload; only files a day old, so live uploads are never touched. */
async function sweepUploadsInFlight() {
  const names = await fs.promises.readdir(uploadsInFlight).catch(() => []);
  for (const name of names) {
    const file = path.join(uploadsInFlight, name);
    const stat = await fs.promises.stat(file).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > staleUploadMs)
      await fs.promises.rm(file, { force: true });
  }
}

/**
 * The `image` field of a multipart upload, an image or a video up to `maxVideoBytes`, streamed to a
 * temporary `file` so no upload is held in memory. saveUpload moves or removes the file.
 */
export async function readMultipartUpload(req) {
  await fs.promises.mkdir(uploadsInFlight, { recursive: true });
  await sweepUploadsInFlight();
  const temporary = path.join(uploadsInFlight, crypto.randomUUID());
  return new Promise((resolve, reject) => {
    let settled = false;
    let found = false;
    let limited = false;
    let name = "reference-image";
    let mime = "";
    let size = 0;
    let written = Promise.resolve();
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: maxVideoBytes, fields: 4 },
      });
    } catch (error) {
      reject(new Error(`The upload failed: ${error.message}`));
      return;
    }
    const fail = (error) => {
      if (settled) return;
      settled = true;
      written
        .catch(() => {})
        .then(() => fs.promises.rm(temporary, { force: true }))
        .finally(() => reject(error instanceof Error ? error : new Error(String(error))));
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
      });
      written = pipeline(file, fs.createWriteStream(temporary, { mode: 0o600 }));
      written.catch(fail);
    });
    parser.on("error", fail);
    parser.on("finish", async () => {
      if (settled) return;
      if (!found) return fail(new Error("Choose an image or video to upload."));
      if (limited || size > maxVideoBytes)
        return fail(new Error(`Videos can be up to ${megabytes(maxVideoBytes)} MB.`));
      try {
        await written;
      } catch (error) {
        return fail(error);
      }
      if (settled) return;
      settled = true;
      resolve({ file: temporary, name, mime, size });
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

/** MP4 or WebM by the file's first bytes, else "". HEIF and AVIF images share MP4's box format. */
function sniffVideo(buffer) {
  if (
    buffer.length > 12 &&
    buffer.toString("latin1", 4, 8) === "ftyp" &&
    !/^(hei|hev|mif|msf|avi)/.test(buffer.toString("latin1", 8, 12))
  )
    return "video/mp4";
  if (buffer.length > 4 && buffer.readUInt32BE(0) === 0x1a45dfa3) return "video/webm";
  return "";
}

/** The first bytes of a file, enough for sniffVideo. */
async function fileHead(file, length = 16) {
  const handle = await fs.promises.open(file, "r");
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(length), 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * An uploaded image, or MP4 or WebM video, as a gallery item (uploads.js), with the `source` it was
 * imported from, if any; the same bytes from the same owner return the first copy. The content is
 * a `buffer`, or a temporary `file` (readMultipartUpload) that is moved into place or removed.
 */
export async function saveUpload(upload, ownerId = "") {
  try {
    return await saveUploadContent(upload, ownerId);
  } finally {
    if (upload.file) await fs.promises.rm(upload.file, { force: true });
  }
}

async function saveUploadContent(
  { buffer, file: temporary, name, mime: declaredMime = "", source },
  ownerId,
) {
  const size = temporary ? (await fs.promises.stat(temporary)).size : buffer?.length || 0;
  if (!size) throw new Error("That file is empty.");
  const video = sniffVideo(temporary ? await fileHead(temporary) : buffer);
  if (video && declaredMime.startsWith("image/"))
    throw new Error("That file isn’t the type of image its name says.");
  const limit = video ? maxVideoBytes : maxUploadBytes;
  if (size > limit)
    throw new Error(`${video ? "Videos" : "Images"} can be up to ${megabytes(limit)} MB.`);
  // Images are small enough to read whole; a video stays on disk.
  if (!video && temporary) buffer = await fs.promises.readFile(temporary);
  const inspected = video ? { mime: video } : await inspectImage(buffer, declaredMime);
  const digest = crypto.createHash("sha256");
  if (buffer) digest.update(buffer);
  else for await (const chunk of fs.createReadStream(temporary)) digest.update(chunk);
  const hash = digest.digest("hex");
  const stored = (item) => {
    const media = mediaParams(item.url);
    return Boolean(media && mediaFile(media.filename, media.subfolder));
  };
  const existing = gallery.find(
    (item) =>
      item.uploaded && item.hash === hash && (item.ownerId || "") === ownerId && stored(item),
  );
  if (existing) return { item: existing, asset: uploadAsset(existing) };
  const id = crypto.randomUUID();
  const subfolder = mediaSubfolder(ownerId);
  const filename = `${id}.${mimeExtension(inspected.mime)}`;
  const file = mediaPath(filename, subfolder);
  if (!file) throw new Error("This upload's name cannot be stored.");
  if (buffer) await writeBytesFileAsync(file, buffer, { mode: 0o600 });
  else {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.rename(temporary, file);
  }
  if (video) {
    const clip = await probeVideo(file);
    if (!clip) {
      await fs.promises.rm(file, { force: true });
      throw new Error("That video can’t be read.");
    }
    Object.assign(inspected, {
      width: clip.width,
      height: clip.height,
      durationMs: clip.durationMs,
    });
  }
  const item = uploadedGalleryItem({
    id,
    ownerId,
    name: safeName(name),
    ...inspected,
    size,
    hash,
    createdAt: new Date().toISOString(),
    filename,
    subfolder,
    source,
  });
  addGalleryItems([item]);
  return { item, asset: uploadAsset(item) };
}

/** An upload as a reference: a video by its first frame, as reference slots take images. */
const uploadAsset = (item) => (item.type === "video" ? frameAsset(item, 0) : galleryAsset(item));

/**
 * A gallery image's bytes, or a video's poster (its first frame, cut by ffmpeg and cached with the
 * grid's), for captions, suggested prompts and image search.
 */
export async function galleryStill(item) {
  if (item.type !== "video") return (await publicGalleryBuffer(item)).buffer;
  const media = mediaParams(item.url);
  if (!media) throw new Error("That video is no longer in the gallery.");
  return fs.promises.readFile(
    await getComfyVideoPoster(media.filename, media.subfolder, mediaType),
  );
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

/**
 * The account's own photo a video job starts from (its first reference), or null. Extend starts
 * from a video's frame, so it has none.
 */
export function animatedPhoto(job) {
  if (job.input?.kind !== "video") return null;
  const item = findGalleryItemForAccount(job.input.referenceAssets?.[0]?.assetId, {
    userId: job.ownerId,
  });
  return item?.type === "image" && item.status === "done" ? item : null;
}

export async function publicGalleryBuffer(item) {
  const imported = importedImageFile(item);
  if (imported && fs.existsSync(imported))
    return { buffer: fs.readFileSync(imported), mime: "image/png", name: item.outputName };
  const media = mediaParams(item.url);
  if (media) {
    const file = mediaFile(media.filename, media.subfolder);
    if (!file)
      throw Object.assign(new Error("That image is no longer in the gallery."), { status: 404 });
    return {
      buffer: fs.readFileSync(file),
      mime: mimeFromName(file),
      name: item.outputName || path.basename(file),
    };
  }
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

// Marks a reference to a frame of a finished video (its last, or at a time in milliseconds), which is
// cut from the video when a run is staged.
const framePattern = /^(.*):(?:last-frame|frame-(\d+))$/;
const frameSuffix = (at) => (at === "last" ? ":last-frame" : `:frame-${at}`);

/** A frame reference's video id and time ("last" or milliseconds), or null for any other id. */
function frameReference(id) {
  const match = framePattern.exec(String(id));
  return match && { videoId: match[1], at: match[2] === undefined ? "last" : Number(match[2]) };
}

/**
 * A finished video of this request's own, as the reference for one of its frames.
 * Nothing is stored: the id carries the video's own reference and the frame
 * is cut when used.
 */
function frameAssetForAccount(account, galleryItemId, at) {
  const item = findGalleryItemForAccount(galleryItemId, account);
  if (!item || item.type !== "video" || item.status !== "done" || !item.url)
    throw new Error("That video is no longer in the gallery.");
  return frameAsset(item, at);
}

function frameAsset(item, at) {
  const asset = galleryAsset(item);
  const label = at === "last" ? "last frame" : `frame at ${(at / 1000).toFixed(1)} s`;
  return {
    ...asset,
    id: `${asset.id}${frameSuffix(at)}`,
    name: `${String(asset.name).replace(/\.[a-z0-9]+$/i, "")} ${label}.png`,
    mime: "image/png",
    size: 0,
    url: "",
    thumbnailUrl: item.thumbnailUrl || "",
  };
}

async function frameBytes(account, { videoId, at }) {
  const item = findGalleryItemForAccount(videoId, account);
  if (!item || item.type !== "video" || item.status !== "done")
    throw new Error("That video is no longer in the gallery.");
  const video = {
    buffer: (await publicGalleryBuffer(item)).buffer,
    name: item.outputName || item.filename || "video",
  };
  return {
    buffer: await extractFrame(video.buffer, at),
    mime: "image/png",
    name: `${String(video.name).replace(/\.[a-z0-9]+$/i, "")}-${at === "last" ? "last-frame" : `frame-${at}`}.png`,
  };
}

/**
 * The local file (null once the owner's video is gone) and time of a video frame reference (an
 * Extend's start), or null for any other reference.
 */
export function frameSourceFile(id, ownerId = "") {
  const frame = frameReference(id);
  if (!frame) return null;
  const item = findGalleryItemForAccount(frame.videoId, { userId: ownerId });
  const media = item?.type === "video" && mediaParams(item.url);
  return { file: (media && mediaFile(media.filename, media.subfolder)) || null, at: frame.at };
}

/** `frame` picks a video's frame: "last", or a time in milliseconds. */
export function referenceAssetForAccount(account, galleryItemId, { frame = "" } = {}) {
  if (frame !== "") return frameAssetForAccount(account, galleryItemId, frame);
  const publicItem = findGalleryItemForAccount(galleryItemId, account);
  if (publicItem && publicItem.type === "image" && publicItem.status === "done" && publicItem.url)
    return galleryAsset(publicItem);
  throw new Error("That image is no longer in the gallery.");
}

/** Reopen one saved reference without enumerating the catalogue or reading worker media. */
export function referenceAssetMetadataForAccount(account, id) {
  const frame = frameReference(id);
  const item = findGalleryItemForAccount(frame ? frame.videoId : id, account);
  if (!item || item.status !== "done" || !item.url || item.type !== (frame ? "video" : "image"))
    throw new Error("That reference image is gone.");
  const asset = frame ? frameAssetForAccount(account, item.id, frame.at) : galleryAsset(item);
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
  const frame = frameReference(id);
  const item = findGalleryItemForAccount(frame ? frame.videoId : id, account);
  return Boolean(
    item && item.status === "done" && item.url && item.type === (frame ? "video" : "image"),
  );
}

/**
 * An image reference's gallery caption (domain/captions.ts), or "" for a video frame, whose caption
 * describes the video's first frame rather than this one.
 */
export function captionForReferenceAccount(account, id) {
  if (frameReference(id)) return "";
  const caption = findGalleryItemForAccount(id, account)?.caption?.text;
  return typeof caption === "string" ? caption.trim() : "";
}

/** The bytes a run gets for a reference. */
export async function bytesForReferenceAccount(account, id) {
  const frame = frameReference(id);
  if (frame) return frameBytes(account, frame);
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

export async function stageReferenceAssetsForAccount(
  account,
  references = [],
  { unique = false, generation = null } = {},
) {
  const staged = [];
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
    // Content names are reused, so a resized file is not uploaded again on every run; a unique
    // copy is the run's own and goes when it ends (media-store.js temporaryInputFiles).
    const uploaded = await uploadBufferToComfy(bytes, { unique });
    staged.push({
      slot,
      assetId,
      source: String(reference?.source || ""),
      ...uploaded,
      ...(unique ? { temporary: true } : {}),
      ...(bytes.width ? { width: bytes.width, height: bytes.height } : {}),
    });
  }
  return staged;
}
