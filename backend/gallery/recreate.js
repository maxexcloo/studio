import { recordsForRequest } from "../account-ownership.js";
import { mayUseFeature } from "../account-policy.js";
import { requireLocal } from "../route-access.js";
import { gallery } from "./store.js";

/**
 * Recreate's start: the Chat and job a run made from a finished item joins, so the run is one of
 * its versions. An item without a run of its own (an upload) gets a finished job holding it
 * (`store.recordFinished`) in a Recreate Chat, made once and reused. The composer then runs the
 * item's suggested prompt (domain/suggested-prompts.ts) there.
 */
export function registerRecreateRoute(app, { store }) {
  app.post("/api/gallery/recreate", (req, res) => {
    if (req.studioAccount && !mayUseFeature(req.studioAccount, "gallery"))
      return res
        .status(403)
        .json({ ok: false, error: "The gallery is disabled for this account." });
    if (!req.studioAccount && !requireLocal(req, res)) return;
    const item = recordsForRequest(gallery, req).find(
      (entry) => entry.id === req.body?.galleryItemId && entry.status === "done" && entry.url,
    );
    if (!item)
      return res.status(404).json({ ok: false, error: "That item is no longer in the gallery." });
    const ownerId = item.ownerId || "";
    const job =
      (item.jobId && store.job(ownerId, item.jobId)) ||
      store
        .jobs(ownerId)
        .find(
          (entry) =>
            entry.resource === "studio" &&
            !entry.parentJobId &&
            entry.outputs[0]?.id === item.id &&
            store.session(ownerId, entry.sessionId),
        ) ||
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
