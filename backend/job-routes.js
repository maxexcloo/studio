import { pausedReason } from "../shared/queue.ts";
import { ownerIdForRequest } from "./account-ownership.js";
import { directRoute } from "./domain/direct-route.ts";
import { unconfirmedCancel } from "./domain/routes.ts";
import { queueSchedule } from "./queue-eta.js";

/**
 * A job's status and its cancellation, and cancelling all of an account's unfinished work, read
 * from the queue's records. MCP reads and cancels a job through the first two.
 */
export function registerJobRoutes(app, { store, queue }) {
  /** Open jobs on its resource that run before a waiting job: started ones, then the queue's order by priority. */
  function aheadOf(job) {
    const open = store.openJobs().filter((other) => other.resource === job.resource);
    const at = open.findIndex((other) => other.id === job.id);
    const priority = job.priority ?? 0;
    return open.filter(
      (other, index) =>
        other.id !== job.id &&
        (["running", "saving"].includes(other.status) ||
          (other.reason !== pausedReason &&
            ((other.priority ?? 0) < priority ||
              ((other.priority ?? 0) === priority && index < at)))),
    ).length;
  }
  function generationJobResponse(account, id) {
    const queued = store.job(account?.userId || "", id);
    if (!queued) return { status: "missing" };
    // Work still waiting in Studio's queue has no end from its worker yet: list-schedule one.
    const waitingEnd =
      ["starting", "queued", "waiting"].includes(queued.status) &&
      !Number.isFinite(queued.progress?.endsAt)
        ? queueSchedule(queue).endsAt.get(queued.id)
        : undefined;
    // How many jobs run first, so a chat can say so where no end is known.
    const ahead =
      ["starting", "queued", "waiting"].includes(queued.status) &&
      !Number.isFinite(waitingEnd ?? queued.progress?.endsAt)
        ? aheadOf(queued)
        : undefined;
    // MCP clients read these words; they predate the queue's own.
    const status =
      {
        completed: "done",
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
      ...(ahead === undefined ? {} : { ahead }),
      // The prompt's thinking stays in Studio; a chat hears only the status.
      progress:
        queued.status === "writing"
          ? undefined
          : Number.isFinite(waitingEnd)
            ? { ...queued.progress, endsAt: waitingEnd }
            : queued.progress,
      ...(queued.resource.startsWith("provider:cliproxyapi")
        ? { provider: "cliproxyapi", kind: queued.input.kind, updatedAt: queued.updatedAt }
        : {}),
    };
  }
  directRoute(app, "GET", "/api/jobs/:id", (account, { params }) => ({
    status: 200,
    payload: generationJobResponse(account, params.id),
  }));

  directRoute(app, "POST", "/api/jobs/:id/cancel", async (account, { params }) => {
    const ownerId = ownerIdForRequest({ studioAccount: account });
    // Another account's job answers exactly like an unknown one.
    if (!store.job(ownerId, params.id))
      return { status: 200, payload: { ok: true, stale: true, changed: false } };
    try {
      await queue.cancel(ownerId, params.id);
    } catch {
      return { status: 503, payload: { ok: false, error: unconfirmedCancel } };
    }
    return { status: 200, payload: { ok: true } };
  });

  app.post("/api/queue/cancel", async (req, res) => {
    const ownerId = ownerIdForRequest(req);
    // A cancel the worker can't confirm yet stays recorded; recovery finishes it.
    await Promise.allSettled(store.openJobs(ownerId).map((job) => queue.cancel(ownerId, job.id)));
    res.json({ ok: true });
  });
}
