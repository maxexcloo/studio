import { recordsForRequest } from "../account-ownership.js";
import { requireLocal } from "../route-access.js";
import { gallery } from "./store.js";

/**
 * Recreate's start: the session and job a run made from a finished item joins, so the run is one of
 * its versions. An item without a run of its own (an upload) gets a finished job holding it
 * (`store.recordFinished`) in a Recreate session, made once and reused. The composer then runs the
 * item's suggested prompt (domain/suggested-prompts.ts) there.
 */
export function registerRecreateRoute(app, { store }) {
  app.post("/api/gallery/recreate", (req, res) => {
    if (!req.studioAccount && !requireLocal(req, res)) return;
    const item = recordsForRequest(gallery, req).find(
      (entry) => entry.id === req.body?.galleryItemId && entry.status === "done" && entry.url,
    );
    if (!item)
      return res.status(404).json({ ok: false, error: "That item is no longer in the gallery." });
    const ownerId = item.ownerId || "";
    const upload = store.uploadJob(ownerId, item.id);
    const job =
      (item.jobId && store.job(ownerId, item.jobId)) ||
      (upload && store.session(ownerId, upload.sessionId) && upload) ||
      store.recordFinished(
        ownerId,
        store.createSession(ownerId, "Recreate", { prompt: item.suggestedPrompt || "" }).id,
        { prompt: item.suggestedPrompt || "", kind: item.type },
        {
          operation: item.type === "video" ? "animate" : "image",
          outputs: [
            { id: item.id, url: item.url, thumbnailUrl: item.thumbnailUrl, type: item.type },
          ],
        },
      );
    res.json({ ok: true, sessionId: job.sessionId, jobId: job.id });
  });
}
