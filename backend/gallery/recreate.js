import { recreationPrompt } from "../../shared/media.ts";
import { recordsForRequest } from "../account-ownership.js";
import { requireLocal } from "../route-access.js";
import { galleryItem } from "./store.js";

/**
 * Recreate's start for a finished item without a run of its own (an upload or import): the session
 * and job a run made from it joins, so the run is one of its versions, and the prompt it recreates
 * from. The item gets a finished job holding it (`store.recordFinished`) in a Recreate session, made
 * once and reused. That prompt is the item's own, else its suggested prompt
 * (domain/suggested-prompts.ts) or caption; `describe(item)` captions an item with none now.
 */
export function registerRecreateRoute(app, { store, describe }) {
  app.post("/api/gallery/recreate", async (req, res) => {
    if (!req.studioAccount && !requireLocal(req, res)) return;
    const item = recordsForRequest(
      [galleryItem(req.body?.galleryItemId)].filter(Boolean),
      req,
    ).find((entry) => entry.status === "done" && entry.url);
    if (!item)
      return res.status(404).json({ ok: false, error: "That item is no longer in the gallery." });
    let prompt = recreationPrompt(item);
    if (!prompt && req.body.savedPromptOnly === true)
      return res.status(409).json({
        ok: false,
        reason: "no-saved-prompt",
        error: "That item has no saved prompt or caption yet.",
      });
    if (!prompt)
      try {
        prompt = await describe(item);
      } catch (error) {
        return res.status(503).json({ ok: false, error: error.message });
      }
    const job = recreateSource(store, item, prompt);
    res.json({ ok: true, sessionId: job.sessionId, jobId: job.id, prompt });
  });
}

/** Finds or records the original so later runs are versions of the same result. */
export function recreateSource(store, item, prompt) {
  const ownerId = item.ownerId || "";
  const upload = store.uploadJob(ownerId, item.id);
  return (
    (item.jobId && store.job(ownerId, item.jobId)) ||
    (upload && store.session(ownerId, upload.sessionId) && upload) ||
    store.recordFinished(
      ownerId,
      store.createSession(ownerId, "Recreate").id,
      { prompt, kind: item.type },
      {
        operation: item.type === "video" ? "animate" : "image",
        outputs: [{ id: item.id, url: item.url, thumbnailUrl: item.thumbnailUrl, type: item.type }],
      },
    )
  );
}
