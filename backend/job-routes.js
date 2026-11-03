import {
  ownerIdForRequest,
  recordBelongsToRequest,
  recordsForRequest,
} from "./account-ownership.js";
import { withComfyBackend } from "./comfy/backends.js";
import { cancelPrompt } from "./comfy/queue.js";
import { unconfirmedCancel } from "./domain/routes.ts";
import { gallery, saveGallery, setGallery, updateGalleryJob } from "./gallery/store.js";
import { jobs, setTerminalJob } from "./jobs.js";
import { pausedReason } from "../shared/queue.ts";

/** Marks every Studio job still waiting or running as canceled, and returns the prompt ids ComfyUI knows them by. */
function cancelOwnJobs(ownerId = "") {
  const promptIds = [];
  for (const [id, job] of jobs) {
    if (ownerId && job.ownerId !== ownerId) continue;
    if (job.status === "queued" || job.status === "running" || job.status === "canceling") {
      if (job.promptId) promptIds.push({ promptId: job.promptId, backend: job.comfyBackend });
      // Only upscaling now: its pictures stay, and runJob delivers them once ComfyUI lets go.
      if (job.keepsPicture) {
        jobs.set(id, { ...job, status: "canceling" });
        continue;
      }
      setTerminalJob(id, { status: "canceled" });
      updateGalleryJob(id, { status: "canceled" });
    }
  }
  return promptIds;
}

/**
 * A job's status and its cancellation, and cancelling all of an account's queued work. Answers
 * `generationJobResponse(account, id)`, which MCP reads a job through.
 */
export function registerJobRoutes(app, { store, queue }) {
  function generationJobResponse(account, id) {
    const queued = store.job(account?.userId || "", id);
    if (queued && !jobs.has(id)) {
      const status =
        {
          completed: "done",
          failed: "error",
          cancelled: "canceled",
          writing: "queued",
          waiting: "queued",
          starting: "queued",
          saving: "running",
        }[queued.status] || queued.status;
      return {
        status,
        items: queued.items,
        outputs: queued.outputs,
        error: queued.status === "failed" ? queued.reason : undefined,
        // A paused queue's hold is the one waiting reason a chat hears.
        ...(queued.reason === pausedReason ? { reason: pausedReason } : {}),
        // The prompt's thinking stays in Studio; a chat hears only the status.
        progress: queued.status === "writing" ? undefined : queued.progress,
        ...(queued.resource.startsWith("provider:cliproxyapi")
          ? { provider: "cliproxyapi", kind: queued.input.kind, updatedAt: queued.updatedAt }
          : {}),
      };
    }
    const job = jobs.get(id);
    if (!job || (account && job.ownerId !== account.userId)) {
      return { status: "missing" };
    }
    return { ...job, items: job.items || [] };
  }
  app.get("/api/jobs/:id", (req, res) => {
    res.json(generationJobResponse(req.studioAccount, req.params.id));
  });

  app.post("/api/jobs/:id/cancel", async (req, res) => {
    if (store.job(ownerIdForRequest(req), req.params.id)) {
      try {
        await queue.cancel(ownerIdForRequest(req), req.params.id);
      } catch {
        return res.status(503).json({
          ok: false,
          error: unconfirmedCancel,
        });
      }
      return res.json({ ok: true });
    }
    const job = jobs.get(req.params.id);
    if (!job) {
      // Nothing here runs it any more (Studio restarted): only the tile is left to settle.
      // Its prompt id went with the job, so ComfyUI is left alone rather than interrupted blindly.
      const hasOwnedRecord = recordsForRequest(gallery, req).some(
        (item) => item.jobId === req.params.id,
      );
      if (!hasOwnedRecord) return res.json({ ok: true, stale: true, changed: false });
      const changed = updateGalleryJob(req.params.id, { status: "canceled" });
      res.json({ ok: true, stale: true, changed });
      return;
    }
    // Another account's live job answers exactly like an unknown one.
    if (req.studioAccount && job.ownerId !== req.studioAccount.userId)
      return res.json({ ok: true, stale: true, changed: false });
    jobs.set(req.params.id, { ...job, status: "canceling" });
    // Its pictures are saved and only Smart upscale is left: they stay, and runJob delivers them.
    if (!job.keepsPicture) updateGalleryJob(req.params.id, { status: "canceled" });
    // Without a prompt id yet, runJob takes it back out of ComfyUI as soon as /prompt answers.
    if (job.promptId)
      await withComfyBackend(job.comfyBackend, () => cancelPrompt(job.promptId)).catch(() => null);
    res.json({ ok: true });
  });

  app.post("/api/queue/cancel", async (req, res) => {
    const ownerId = ownerIdForRequest(req);
    for (const pending of store
      .jobs(ownerId)
      .filter((job) => ["writing", "queued", "waiting"].includes(job.status)))
      await queue.cancel(ownerId, pending.id);
    const promptIds = cancelOwnJobs(ownerId);
    setGallery(
      gallery.map((item) =>
        recordBelongsToRequest(item, req) &&
        item.status === "pending" &&
        !jobs.get(item.jobId)?.keepsPicture
          ? { ...item, status: "canceled" }
          : item,
      ),
    );
    saveGallery();
    // Only Studio's own prompts: ComfyUI's queue also holds runs from its own UI and other apps.
    await Promise.allSettled(
      promptIds.map(({ promptId, backend }) =>
        withComfyBackend(backend, () => cancelPrompt(promptId)),
      ),
    );
    res.json({ ok: true });
  });
  return { generationJobResponse };
}
