import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { recordsForRequest } from "../account-ownership.js";
import { mediaFile, mediaParams, mediaPath, mediaUrls } from "../media-paths.js";
import { requireLocal } from "../route-access.js";
import { editClip, probeVideo, videoEditKinds } from "../video-previews.js";
import { addGalleryItems, gallery } from "./store.js";

/**
 * The Edit menu's video edits (Trim, …): ffmpeg writes the edited clip beside the original, which
 * stays, and it is saved as a new version of it, owned by the same account. The version is a
 * finished job made from the original (`store.recordFinished`), in the original's Chat.
 */
export function registerVideoEditRoutes(app, { store }) {
  app.post("/api/gallery/video-edit", async (req, res) => {
    if (!req.studioAccount && !requireLocal(req, res)) return;
    const { galleryItemId, kind, start, end } = req.body || {};
    if (!videoEditKinds.includes(kind))
      return res.status(400).json({ ok: false, error: "Unknown video edit." });
    if (
      kind === "trim" &&
      !(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end - start >= 100)
    )
      return res
        .status(400)
        .json({ ok: false, error: "A trim keeps at least a tenth of a second." });
    const item = recordsForRequest(gallery, req).find(
      (entry) => entry.id === galleryItemId && entry.type === "video" && entry.status === "done",
    );
    const media = item && mediaParams(item.url);
    const source = media && mediaFile(media.filename, media.subfolder);
    if (!source)
      return res.status(404).json({ ok: false, error: "That video is no longer in the gallery." });
    const name = `${path.parse(media.filename).name}-${kind}-${crypto.randomUUID().slice(0, 8)}.mp4`;
    const output = mediaPath(name, media.subfolder);
    try {
      await editClip(source, output, { kind, start, end });
    } catch (error) {
      await fs.promises.rm(output, { force: true });
      return res.status(500).json({ ok: false, error: error.message });
    }
    const ownerId = item.ownerId || "";
    const parent = item.jobId ? store.job(ownerId, item.jobId) : undefined;
    const session = parent
      ? parent.sessionId
      : store.createSession(ownerId, "Edit Video", { prompt: item.prompt || "" }).id;
    const urls = mediaUrls(name, media.subfolder);
    const job = store.recordFinished(
      ownerId,
      session,
      { ...(parent?.input || item.settings), prompt: item.prompt || "", kind: "video" },
      {
        parentJobId: parent?.id,
        parentItemId: item.id,
        outputs: [{ id: urls.url, url: urls.url, type: "video" }],
      },
    );
    const size = await probeVideo(output);
    // The original's prompt, settings and title carry over; its star, upscale, caption and
    // generation time do not.
    const {
      caption: _caption,
      durationMs: _durationMs,
      favorite: _favorite,
      timing: _timing,
      upscale: _upscale,
      upscaleActive: _upscaleActive,
      ...kept
    } = item;
    const version = {
      ...kept,
      ...urls,
      id: urls.url,
      jobId: job.id,
      outputName: name,
      index: 0,
      width: size?.width || item.width,
      height: size?.height || item.height,
      createdAt: new Date().toISOString(),
    };
    addGalleryItems([version]);
    res.status(201).json({ ok: true, id: version.id, jobId: job.id });
  });
}
