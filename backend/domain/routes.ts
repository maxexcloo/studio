import {
  type GenerationInput,
  type QueueCancelAllResponse,
  type QueueMedia,
  type QueueResponse,
  type UnfinishedJob,
} from "../../shared/queue.ts";
import type { DomainResponse, GenerationAccount, GenerationScope } from "./admission.ts";
import { type RouteAccount, directRoute } from "./direct-route.ts";
import { GenerationQueue } from "./queue.ts";
import { type OwnedJob, Store, everyone, publicJob, queuePriority } from "./store.ts";

const ownerOf = (account: RouteAccount) => account?.userId || "";
/**
 * The person's queue, Dream's background jobs included, without failed jobs the person cleared:
 * its unfinished and failed work and its latest finished jobs (`Store.queueJobs`).
 */
const listed = (store: Store, ownerId: string) =>
  store.queueJobs(ownerId).filter((job) => !job.cleared);
/** What Stop All acts on: the person's own unfinished work, as Dream's pause stops Dream's. */
const ownWork = (store: Store, ownerId: string) =>
  store.openJobs(ownerId).filter((job) => !job.cleared && job.priority !== queuePriority.dream);
const clear = (store: Store, job: OwnedJob) => store.save({ ...job, cleared: true });
const notFound = { status: 404, payload: { error: "Not found." } };
const refused = (error: string) => ({ status: 400, payload: { error } });
// A cancel the worker could not confirm yet (busy, or a proxy answering for it); recovery finishes it.
export const unconfirmedCancel =
  "Cancellation could not be confirmed. The recorded job remains available for recovery.";
const object = (value: unknown): value is GenerationInput =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export function registerQueueRoutes(
  app: object,
  {
    store,
    queue,
    admit,
    media,
    ownsItem,
  }: {
    store: Store;
    queue: GenerationQueue;
    /** domain/admission.ts's: a session's generations are admitted as every other request. */
    admit: (
      input: GenerationInput,
      account?: GenerationAccount,
      scope?: GenerationScope,
    ) => Promise<DomainResponse>;
    /**
     * The owner's gallery records of a job. A job's own results are what its adapter reported (a
     * cloud provider's bare files, or a snapshot taken on completion), so the queue shows the
     * gallery's records instead: each with its prompt, settings, title and rating.
     */
    media: (ownerId: string, jobId: string) => QueueMedia[];
    /** Whether the owner has this gallery item, which a run may then be made from. */
    ownsItem: (ownerId: string, id: string) => boolean;
  },
) {
  const shown = (ownerId: string, jobs: OwnedJob[]) =>
    jobs.map((job) => {
      const items = media(ownerId, job.id);
      return publicJob(items?.length ? { ...job, items } : job);
    });
  // Polled while work runs: a job with gallery records drops the adapter's copies of them, which
  // every reader passes over for the records.
  const queued = (ownerId: string, jobs: OwnedJob[]) =>
    shown(ownerId, jobs).map((job) => (job.items.length ? { ...job, outputs: [] } : job));
  directRoute(app, "GET", "/api/user-presets", (account) => ({
    status: 200,
    payload: { presets: store.presets(ownerOf(account)) },
  }));
  directRoute(app, "POST", "/api/user-presets", (account, { body }) => {
    if (typeof body?.title !== "string" || !body.title.trim() || !object(body.input))
      return refused("A title and generation input are required.");
    // The parts of a draft a preset holds, when it holds only some (the Presets popup's names).
    const parts = body.parts;
    if (
      parts !== undefined &&
      (!Array.isArray(parts) || !parts.every((part) => typeof part === "string"))
    )
      return refused("Preset parts must be a list of names.");
    if (body.family !== undefined && typeof body.family !== "string")
      return refused("A preset family must be a name.");
    return {
      status: 201,
      payload: {
        preset: store.createPreset(
          ownerOf(account),
          body.title.trim(),
          body.input,
          parts,
          body.family,
        ),
      },
    };
  });
  directRoute(app, "DELETE", "/api/user-presets/:id", (account, { params }) =>
    store.deletePreset(ownerOf(account), params.id)
      ? { status: 200, payload: { ok: true } }
      : notFound,
  );
  directRoute(app, "PATCH", "/api/user-presets/:id", (account, { params, body }) => {
    if (body?.title !== undefined && (typeof body.title !== "string" || !body.title.trim()))
      return refused("A preset title is required.");
    if (body?.input !== undefined && !object(body.input))
      return refused("Generation input must be an object.");
    const preset = store.updatePreset(ownerOf(account), params.id, {
      ...(typeof body?.title === "string" ? { title: body.title.trim() } : {}),
      ...(object(body?.input) ? { input: body.input } : {}),
    });
    return preset ? { status: 200, payload: { preset } } : notFound;
  });
  directRoute(app, "POST", "/api/sessions", (account, { body }) => ({
    status: 201,
    payload: {
      session: store.createSession(
        ownerOf(account),
        typeof body?.title === "string" ? body.title : undefined,
      ),
    },
  }));
  directRoute(app, "POST", "/api/sessions/:id/generations", async (account, { params, body }) => {
    const ownerId = ownerOf(account);
    if (!store.session(ownerId, params.id)) return notFound;
    const { operation = "image", parentJobId, parentItemId, ...input } = body || {};
    if (!["image", "refine", "animate"].includes(String(operation)))
      return refused("Unknown generation operation.");
    const found = typeof parentJobId === "string" ? store.job(ownerId, parentJobId) : undefined;
    const parent = found?.sessionId === params.id ? found : undefined;
    if (parentJobId !== undefined && !parent)
      return refused("Parent generation must belong to this session.");
    // The result a run is made from is the owner's: one of the parent's results or a gallery item.
    if (
      parentItemId !== undefined &&
      (typeof parentItemId !== "string" ||
        !(
          [...(parent?.items || []), ...(parent?.outputs || [])].some(
            (item) => item.id === parentItemId,
          ) || ownsItem(ownerId, parentItemId)
        ))
    )
      return refused("Parent result must be one of your items.");
    const admitted = await admit(input, account ?? undefined, {
      sessionId: params.id,
      operation: operation as GenerationScope["operation"],
      parentJobId: parentJobId as string | undefined,
      parentItemId: parentItemId as string | undefined,
    });
    if (admitted.status >= 400) return admitted;
    const job = store.job(ownerId, String(admitted.payload.jobId))!;
    return {
      status: 202,
      payload: { jobId: job.id, sessionId: job.sessionId, status: job.status, job: publicJob(job) },
    };
  });
  // With `since` (an `updatedAt`), only the jobs changed since then, and every listed job's ID.
  directRoute(app, "GET", "/api/queue", (account, { query }) => {
    const ownerId = ownerOf(account);
    const pauses = store.pauses();
    const jobs = listed(store, ownerId);
    const since = typeof query.since === "string" ? query.since : undefined;
    return {
      status: 200,
      payload: {
        jobs: queued(ownerId, since ? jobs.filter((job) => job.updatedAt >= since) : jobs),
        ...(since ? { ids: jobs.map((job) => job.id) } : {}),
        paused: { mine: pauses.has(ownerId), all: pauses.has(everyone) },
      } satisfies QueueResponse,
    };
  });
  // One of the person's jobs, however old: the queue lists only the latest finished ones.
  directRoute(app, "GET", "/api/queue/:id", (account, { params }) => {
    const job = store.job(ownerOf(account), params.id);
    return job ? { status: 200, payload: { job: queued(ownerOf(account), [job])[0] } } : notFound;
  });
  // The account's own pause: nothing new of its work starts; started work finishes.
  for (const [action, paused] of [
    ["pause", true],
    ["resume", false],
  ] as const)
    directRoute(app, "POST", `/api/queue/${action}`, (account) => {
      store.setPaused(ownerOf(account), paused);
      void queue.tick();
      return { status: 200, payload: { ok: true } };
    });
  directRoute(app, "POST", "/api/queue/:id/move", (account, { params, body }) => {
    const to = body?.to;
    if (typeof to !== "number" || !Number.isInteger(to) || to < 0)
      return { status: 400, payload: { error: "Move to a place in the queue." } };
    if (!store.job(ownerOf(account), params.id)) return notFound;
    return store.move(ownerOf(account), [params.id], to)
      ? { status: 200, payload: { ok: true } }
      : { status: 409, payload: { error: "Only waiting generations can be moved." } };
  });
  // A set's waiting items move together, keeping their order; its started ones stay.
  directRoute(app, "POST", "/api/queue/sets/:set/move", (account, { params, body }) => {
    const to = body?.to;
    if (typeof to !== "number" || !Number.isInteger(to) || to < 0)
      return { status: 400, payload: { error: "Move to a place in the queue." } };
    const ids = store
      .movable(ownerOf(account))
      .filter((job) => job.queueSet === params.set)
      .map((job) => job.id);
    if (!ids.length)
      return { status: 409, payload: { error: "Only waiting generations can be moved." } };
    store.move(ownerOf(account), ids, to);
    return { status: 200, payload: { ok: true } };
  });
  directRoute(app, "POST", "/api/queue/cancel-all", async (account) => {
    const ownerId = ownerOf(account);
    const outcomes = await Promise.all(
      ownWork(store, ownerId).map(async (initial) => {
        let error: string | undefined;
        try {
          await queue.cancel(ownerId, initial.id);
        } catch {
          error = unconfirmedCancel;
        }
        const job = store.job(ownerId, initial.id)!;
        return {
          job: publicJob(job),
          cancelRequested: job.cancelRequested === true,
          ...(error ? { error } : {}),
        };
      }),
    );
    return { status: 200, payload: { outcomes } satisfies QueueCancelAllResponse };
  });
  directRoute(app, "POST", "/api/queue/clear-failed", (account) => {
    const failed = listed(store, ownerOf(account)).filter((job) => job.status === "failed");
    failed.forEach((job) => clear(store, job));
    return { status: 200, payload: { cleared: failed.length } };
  });
  directRoute(app, "POST", "/api/queue/:id/clear", (account, { params }) => {
    const job = store.job(ownerOf(account), params.id);
    if (!job) return notFound;
    if (job.status !== "failed")
      return { status: 409, payload: { error: "Only failed generations can be cleared." } };
    return { status: 200, payload: { job: publicJob(clear(store, job)) } };
  });
  directRoute(app, "POST", "/api/queue/:id/cancel", async (account, { params }) => {
    let job;
    try {
      job = await queue.cancel(ownerOf(account), params.id);
    } catch {
      return { status: 503, payload: { error: unconfirmedCancel } };
    }
    return job ? { status: 200, payload: { job: publicJob(job) } } : notFound;
  });
  directRoute(app, "POST", "/api/queue/:id/retry", (account, { params }) => {
    if (!store.job(ownerOf(account), params.id)) return notFound;
    const job = queue.retry(ownerOf(account), params.id);
    if (!job) return { status: 409, payload: { error: "Only failed generations can be retried." } };
    void queue.tick();
    return { status: 202, payload: { job: publicJob(job) } };
  });
}

/**
 * Settings › Generation › Unfinished Items, for administrators: every account's jobs that have not
 * finished, oldest first, to retry (end it and queue it again), stop or delete (end it and take it
 * out of the queue, keeping its records), one at a time or every listed job at once.
 */
export function registerMaintenanceRoutes(
  app: object,
  {
    store,
    queue,
    adminRefusal,
  }: {
    store: Store;
    queue: GenerationQueue;
    /** route-access.js's: why the account may not, or null. */
    adminRefusal(account: RouteAccount): DomainResponse | null;
  },
) {
  const target = (body: Record<string, unknown> | undefined) =>
    store.job(String(body?.ownerId ?? ""), String(body?.id ?? ""));
  const end = async (job: OwnedJob) => {
    await queue.abandon(job.ownerId, job.id);
    return clear(store, store.job(job.ownerId, job.id)!);
  };
  // An administrator's pause holds every account's pending work, Dream's included.
  for (const [action, paused] of [
    ["pause-all", true],
    ["resume-all", false],
  ] as const)
    directRoute(app, "POST", `/api/queue/${action}`, (account) => {
      const refusal = adminRefusal(account);
      if (refusal) return refusal;
      store.setPaused(everyone, paused);
      void queue.tick();
      return { status: 200, payload: { ok: true } };
    });
  directRoute(app, "GET", "/api/maintenance/unfinished", (account) => {
    const refusal = adminRefusal(account);
    if (refusal) return refusal;
    const jobs: UnfinishedJob[] = store
      .openJobs()
      .filter((job) => !job.cleared)
      .map((job) => ({ ...publicJob(job), ownerId: job.ownerId }));
    return { status: 200, payload: { jobs } };
  });
  directRoute(app, "POST", "/api/maintenance/unfinished/retry", async (account, { body }) => {
    const refusal = adminRefusal(account);
    if (refusal) return refusal;
    const job = target(body);
    if (!job) return notFound;
    await end(job);
    const retried = queue.requeue(job);
    void queue.tick();
    return { status: 202, payload: { job: publicJob(retried) } };
  });
  directRoute(app, "POST", "/api/maintenance/unfinished/delete", async (account, { body }) => {
    const refusal = adminRefusal(account);
    if (refusal) return refusal;
    const job = target(body);
    if (!job) return notFound;
    return { status: 200, payload: { job: publicJob(await end(job)) } };
  });
  // The listed jobs at once, each named once however often it is sent.
  const targets = (body: Record<string, unknown> | undefined) => {
    const jobs = new Map<string, OwnedJob>();
    for (const entry of Array.isArray(body?.jobs) ? body.jobs : []) {
      const job = target(entry as Record<string, unknown>);
      if (job) jobs.set(`${job.ownerId}/${job.id}`, job);
    }
    return [...jobs.values()];
  };
  directRoute(app, "POST", "/api/maintenance/unfinished/retry-all", async (account, { body }) => {
    const refusal = adminRefusal(account);
    if (refusal) return refusal;
    const jobs = targets(body);
    // One at a time, so the retries queue in the listed order.
    for (const job of jobs) {
      await end(job);
      queue.requeue(job);
    }
    void queue.tick();
    return { status: 202, payload: { retried: jobs.length } };
  });
  // Stop for each: accepted work may stay active until its provider confirms.
  directRoute(app, "POST", "/api/maintenance/unfinished/cancel-all", async (account, { body }) => {
    const refusal = adminRefusal(account);
    if (refusal) return refusal;
    const outcomes = await Promise.all(
      targets(body).map((job) =>
        queue.cancel(job.ownerId, job.id).then(
          () => true,
          () => false,
        ),
      ),
    );
    return outcomes.every(Boolean)
      ? { status: 200, payload: { requested: outcomes.length } }
      : { status: 503, payload: { error: unconfirmedCancel } };
  });
  directRoute(app, "POST", "/api/maintenance/unfinished/delete-all", async (account, { body }) => {
    const refusal = adminRefusal(account);
    if (refusal) return refusal;
    const jobs = targets(body);
    for (const job of jobs) await end(job);
    return { status: 200, payload: { cleared: jobs.length } };
  });
}
