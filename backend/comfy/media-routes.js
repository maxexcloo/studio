import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { outputFilenameBelongsToRequest } from "../account-ownership.js";
import { derivedMediaCache, immutableMediaCache } from "../media-response.js";
import { mediaType, outputMediaPattern, videoPattern } from "../media-paths.js";
import { stripMetadata } from "../metadata-strip.js";
import { getThumbnail } from "../thumbnails.js";
import {
  getComfyVideoGif,
  getComfyVideoLoop,
  getComfyVideoPlayback,
  getComfyVideoPoster,
  getComfyVideoPreview,
  sendVideoPoster,
  sendVideoPreview,
} from "../video-previews.js";
import {
  comfyUrl,
  inDotFolder,
  localOutputFile,
  noteComfyFetchError,
  noteComfyReachable,
} from "./comfy.js";

// Accounts read their own outputs: ComfyUI's output folder, or Studio-owned media.
export const ownerMediaTypes = new Set(["output", mediaType]);

/**
 * A thumbnail's caching. The gallery asks for every thumbnail with a `v` that
 * names its item (mediaUrl.ts), so a reused file name is a new address: that
 * one is used straight from the browser's cache for a while and checked again
 * in the background after, so a reload or a scroll back sends no requests and
 * a file changed in place still shows up on the next look. Without `v` the
 * address is only a file name, so it is checked every time.
 */
function thumbnailCacheControl(req) {
  if (req.query.type === mediaType) return derivedMediaCache;
  return req.query.v ? "private, max-age=600, stale-while-revalidate=2592000" : "private, no-cache";
}

/**
 * "Share without settings" for an output: the whole file, with the prompt and
 * workflow ComfyUI wrote into it taken out (metadata-strip.js). Buffered, since
 * the file changes; never cached, since the plain one lives at the same address.
 */
async function sendWithoutSettings(req, res) {
  const params = new URLSearchParams(
    Object.entries(req.query)
      .filter(([key]) => key !== "clean")
      .map(([key, value]) => [key, String(value)]),
  );
  let response;
  try {
    response = await fetch(`${comfyUrl}/view?${params}`, { signal: AbortSignal.timeout(120000) });
    noteComfyReachable();
  } catch (error) {
    noteComfyFetchError(error);
    res.status(502).json({ ok: false, error: "ComfyUI isn’t answering." });
    return;
  }
  if (!response.ok) {
    res.status(response.status).json({ ok: false, error: "ComfyUI doesn’t have this file." });
    return;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get("content-type") || "";
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.type(type || path.extname(String(req.query.filename || "")) || "application/octet-stream");
  res.send(stripMetadata(bytes).buffer);
}

/**
 * Outputs, inputs and previews through /comfy: video previews, thumbnails and ComfyUI's image
 * route, each limited to what the account owns. Studio media is served from its own folder.
 */
export function registerComfyMediaRoutes(app) {
  app.get("/comfy/video-preview", async (req, res) => {
    const filename = String(req.query.filename || "");
    const subfolder = String(req.query.subfolder || "");
    const type = String(req.query.type || "output");
    if (
      req.studioAccount &&
      (!ownerMediaTypes.has(type) || !outputFilenameBelongsToRequest(filename, subfolder, req))
    ) {
      res.status(404).end();
      return;
    }
    if (
      !["output", "input", "temp", mediaType].includes(type) ||
      !videoPattern.test(filename) ||
      filename !== path.basename(filename) ||
      /[\\/]/.test(filename) ||
      inDotFolder(subfolder)
    ) {
      res.status(404).end();
      return;
    }
    try {
      const cacheControl = type === mediaType ? derivedMediaCache : undefined;
      if (req.query.format === "gif") {
        res
          .type("image/gif")
          .attachment(`${path.parse(filename).name}.gif`)
          .send(await getComfyVideoGif(filename, subfolder, type));
        return;
      }
      if (req.query.format === "loop") {
        res
          .type("video/mp4")
          .attachment(`${path.parse(filename).name} loop.mp4`)
          .send(await getComfyVideoLoop(filename, subfolder, type));
        return;
      }
      // The viewer's copy (getComfyVideoPlayback); a video not kept here plays as ComfyUI has it.
      if (req.query.format === "play") {
        const playback = await getComfyVideoPlayback(filename, subfolder, type);
        if (!playback)
          res.redirect(302, `/comfy/view?${new URLSearchParams({ filename, subfolder, type })}`);
        else if (playback.original)
          res.sendFile(playback.file, { headers: { "Cache-Control": immutableMediaCache } });
        else sendVideoPreview(req, res, playback.file, cacheControl);
        return;
      }
      // The still comes from the original, ahead of any preview still being encoded.
      if (req.query.poster === "1")
        await sendVideoPoster(
          req,
          res,
          await getComfyVideoPoster(filename, subfolder, type),
          cacheControl,
        );
      else
        sendVideoPreview(
          req,
          res,
          await getComfyVideoPreview(filename, subfolder, type),
          cacheControl,
        );
    } catch {
      if (!res.headersSent) res.status(503).end();
    }
  });

  app.get("/comfy/thumb", async (req, res) => {
    const filename = String(req.query.filename || "");
    const subfolder = String(req.query.subfolder || "");
    const type = String(req.query.type || "output");
    if (!filename) {
      res.status(400).json({ ok: false, error: "filename is required." });
      return;
    }
    if (
      req.studioAccount &&
      (!ownerMediaTypes.has(type) || !outputFilenameBelongsToRequest(filename, subfolder, req))
    ) {
      res.status(404).json({ ok: false, error: "Not an output." });
      return;
    }
    // The same outputs /comfy/view serves, and nothing else.
    if (
      !["output", "input", "temp", mediaType].includes(type) ||
      !outputMediaPattern.test(filename) ||
      inDotFolder(req.query.subfolder)
    ) {
      res.status(404).json({ error: "Not an output." });
      return;
    }
    try {
      // A video's thumbnail is its poster, so every small view that asks for one gets a picture.
      if (videoPattern.test(filename)) {
        await sendVideoPoster(
          req,
          res,
          await getComfyVideoPoster(filename, subfolder, type),
          thumbnailCacheControl(req),
        );
        return;
      }
      // ?size=display is the viewer's larger copy (thumbnails.js RENDITIONS).
      const thumbnail = await getThumbnail(
        filename,
        subfolder,
        type,
        req.query.size === "display" ? "display" : "thumb",
      );
      if (!thumbnail) {
        res.status(404).json({ ok: false, error: "Source image is unavailable." });
        return;
      }
      // No sharp (see sharp-loader.js): the full image stands in for the thumbnail.
      if (thumbnail.original) {
        res.redirect(302, `/comfy/view?${new URLSearchParams({ filename, subfolder, type })}`);
        return;
      }
      // The ETag is a source-content hash, so revalidation safely handles a reused filename.
      res.setHeader("Cache-Control", thumbnailCacheControl(req));
      if (req.headers["if-none-match"] === thumbnail.etag) {
        res.status(304).end();
        return;
      }
      if (thumbnail.etag) res.setHeader("ETag", thumbnail.etag);
      res.type("image/webp");
      await pipeline(fs.createReadStream(thumbnail.file), res);
    } catch (error) {
      if (!res.headersSent) res.status(502).json({ ok: false, error: error.message });
      else res.destroy();
    }
  });

  app.get("/comfy/*path", async (req, res) => {
    try {
      const query = req.originalUrl.split("?")[1] ? `?${req.originalUrl.split("?")[1]}` : "";
      const proxyPath = Array.isArray(req.params.path)
        ? req.params.path.join("/")
        : req.params.path;
      const filename = String(req.query.filename || "");
      if (
        req.studioAccount &&
        (proxyPath !== "view" ||
          !ownerMediaTypes.has(String(req.query.type || "output")) ||
          !outputFilenameBelongsToRequest(filename, String(req.query.subfolder || ""), req))
      ) {
        res.status(404).json({ ok: false, error: "Not an output." });
        return;
      }
      // Only ComfyUI's image route, for images, videos and sound among its outputs, inputs
      // and previews. Its other GET routes (settings, logs, Manager's) are not for the studio's visitors,
      // and neither are dot folders among the outputs (such as an old `.studio-trash`).
      if (
        proxyPath !== "view" ||
        !["output", "input", "temp", mediaType].includes(String(req.query.type || "output")) ||
        !outputMediaPattern.test(String(req.query.filename || "")) ||
        inDotFolder(req.query.subfolder)
      ) {
        res.status(404).json({ ok: false, error: "Not an output." });
        return;
      }
      // Forward conditional headers so an unchanged image gets a 304 instead of a
      // full re-transfer over a slow LAN link, and stream the body instead of
      // buffering it so bytes start moving to the client as soon as they arrive.
      const conditional = {};
      for (const header of ["if-none-match", "if-modified-since", "range", "if-range"]) {
        if (req.headers[header]) conditional[header] = req.headers[header];
      }
      // Studio-owned media is served from its folder only, never forwarded to ComfyUI.
      if (String(req.query.type || "") === mediaType) {
        const file = localOutputFile(
          String(req.query.filename || ""),
          String(req.query.subfolder || ""),
          mediaType,
        );
        if (!file) {
          res.status(404).json({ ok: false, error: "This file is no longer available." });
          return;
        }
        if (req.query.clean === "1") {
          res.setHeader("Cache-Control", "private, no-store, max-age=0");
          res.type(path.extname(file) || "application/octet-stream");
          res.send(stripMetadata(fs.readFileSync(file)).buffer);
          return;
        }
        if (req.query.download === "1") res.attachment(path.basename(file));
        res.sendFile(file, { headers: { "Cache-Control": immutableMediaCache } });
        return;
      }
      if (req.query.clean === "1") {
        await sendWithoutSettings(req, res);
        return;
      }
      let response;
      try {
        response = await fetch(`${comfyUrl}/${proxyPath}${query}`, { headers: conditional });
        noteComfyReachable();
      } catch (error) {
        noteComfyFetchError(error);
        throw error;
      }
      res.status(response.status);
      const etag = response.headers.get("etag");
      const lastModified = response.headers.get("last-modified");
      const contentLength = response.headers.get("content-length");
      if (etag) res.setHeader("ETag", etag);
      if (lastModified) res.setHeader("Last-Modified", lastModified);
      if (contentLength) res.setHeader("Content-Length", contentLength);
      for (const header of ["accept-ranges", "content-range", "content-disposition"]) {
        const value = response.headers.get(header);
        if (value) res.setHeader(header, value);
      }
      res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
      if (response.status === 304 || !response.body) {
        res.end();
        return;
      }
      res.type(response.headers.get("content-type") || "application/octet-stream");
      await pipeline(Readable.fromWeb(response.body), res);
    } catch (error) {
      if (!res.headersSent) res.status(502).json({ ok: false, error: error.message });
      else res.destroy();
    }
  });
}
