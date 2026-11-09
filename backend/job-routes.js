import { ownerIdForRequest } from "./account-ownership.js";
import { unconfirmedCancel } from "./domain/routes.ts";
import { pausedReason, terminalStatuses } from "../shared/queue.ts";

/**
 * A job's status and its cancellation, and cancelling all of an account's unfinished work, read
 * from the queue's records. Answers `generationJobResponse(account, id)`, which MCP reads a job
 * through.
 */
export function registerJobRoutes(app, { store, queue }) {
  function generationJobResponse(account, id) {
    const queued = store.job(account?.userId || "", id);
    if (!queued) return { status: "missing" };
    // MCP clients read these words; they predate the queue's own.
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
  app.get("/api/jobs/:id", (req, res) => {
    res.json(generationJobResponse(req.studioAccount, req.params.id));
  });

  app.post("/api/jobs/:id/cancel", async (req, res) => {
    // Another account's job answers exactly like an unknown one.
    if (!store.job(ownerIdForRequest(req), req.params.id))
      return res.json({ ok: true, stale: true, changed: false });
    try {
      await queue.cancel(ownerIdForRequest(req), req.params.id);
    } catch {
      return res.status(503).json({ ok: false, error: unconfirmedCancel });
    }
    return res.json({ ok: true });
  });

  app.post("/api/queue/cancel", async (req, res) => {
    const ownerId = ownerIdForRequest(req);
    // A cancel the worker can't confirm yet stays recorded; recovery finishes it.
    await Promise.allSettled(
      store
        .jobs(ownerId)
        .filter((job) => !terminalStatuses.has(job.status))
        .map((job) => queue.cancel(ownerId, job.id)),
    );
    res.json({ ok: true });
  });
  return { generationJobResponse };
}
