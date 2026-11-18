import {
  type GenerationInput,
  type QueueCancelAllResponse,
  type QueueMedia,
  type QueueResponse,
  type QueueRetryResponse,
  type UnfinishedJob,
  pendingStatuses,
} from "../../shared/queue.ts";
import { logEvent, logWarning } from "../crash-log.js";
import type { DomainResponse, GenerationAccount, GenerationScope } from "./admission.ts";
import { type RouteAccount, directRoute } from "./direct-route.ts";
import { GenerationQueue } from "./queue.ts";
import { type OwnedJob, Store, everyone, publicJob, queuePriority } from "./store.ts";
import { acceptedWork } from "./workload-queue.ts";

const ownerOf = (account: RouteAccount) => account?.userId || "";
/**
 * The person's queue, Dream's background jobs included, without failed jobs the person cleared:
 * its unfinished and failed work and its latest finished jobs (`Store.queueJobs`).
 */
const listed = (store: Store, ownerId: string, options?: { results: boolean }) =>
  store.queueJobs(ownerId, options).filter((job) => !job.cleared);
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

const newPollProfile = () => ({
  requests: 0,
  deltaRequests: 0,
  listedJobs: 0,
  returnedJobs: 0,
  totalListMs: 0,
  totalHydrateMs: 0,
  totalJsonSendMs: 0,
  slowest: { totalMs: 0, listMs: 0, hydrateMs: 0, jsonSendMs: 0 },
});

export function registerQueueRoutes(
  app: object,
  {
    store,
    queue,
    admit,
    media,
    ownsItem,
    removeRetryTiles = () => {},
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
    removeRetryTiles?: (ownerId: string, jobIds: ReadonlySet<string>) => void;
  },
) {
  const shown = (ownerId: string, jobs: OwnedJob[]) =>
    jobs.map((job) => {
      const items = media(ownerId, job.id);
      if (items?.length) return publicJob({ ...job, items });
      // A record listed without its results (Store.queueJobs) is read whole only when needed.
      return publicJob(job.items ? job : store.job(ownerId, job.id)!);
    });
  // Polled while work runs: a job with gallery records drops the adapter's copies of them, which
  // every reader passes over for the records.
  const queued = (ownerId: string, jobs: OwnedJob[]) =>
    shown(ownerId, jobs).map((job) => (job.items.length ? { ...job, outputs: [] } : job));
  let pollProfile = newPollProfile();
  let pollReport: ReturnType<typeof setTimeout> | undefined;
  function reportPollProfile() {
    const { totalListMs, totalHydrateMs, totalJsonSendMs, slowest, ...counts } = pollProfile;
    logEvent("Queue poll profile", {
      ...counts,
      totalListMs: Math.round(totalListMs),
      totalHydrateMs: Math.round(totalHydrateMs),
      totalJsonSendMs: Math.round(totalJsonSendMs),
      slowest,
    });
    pollProfile = newPollProfile();
    pollReport = undefined;
  }
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
    const started = performance.now();
    const ownerId = ownerOf(account);
    const pauses = store.pauses();
    const jobs = listed(store, ownerId, { results: false });
    const failedSets = new Set<string>();
    const mixedSets = new Set<string>();
    for (const job of jobs) {
      if (!job.queueSet || job.priority === queuePriority.dream) continue;
      if (job.status === "failed") failedSets.add(job.queueSet);
      else if (job.status !== "cancelled") mixedSets.add(job.queueSet);
    }
    const clearableFailedSets = store.clearableFailedSets(
      ownerId,
      [...failedSets].filter((set) => !mixedSets.has(set)),
    );
    const listedAt = performance.now();
    const since = typeof query.since === "string" ? query.since : undefined;
    const queuePositions: Record<string, number> = Object.create(null);
    const waitingResources: string[] = [];
    const byResource = new Map<string, string[]>();
    for (const job of jobs) {
      if (!pendingStatuses.has(job.status)) continue;
      const position = queue.queuePosition(job.id);
      if (position === undefined) continue;
      queuePositions[job.id] = position;
      const resource = job.status === "writing" ? "writing" : job.resource;
      const ids = byResource.get(resource) ?? [];
      ids.push(job.id);
      byResource.set(resource, ids);
      waitingResources.push(resource);
    }
    // Each resource keeps its slots in the saved list. Their jobs run in parallel without a shared rank.
    for (const ids of byResource.values())
      ids.sort((a, b) => queuePositions[b] - queuePositions[a]);
    const payload = {
      jobs: queued(ownerId, since ? jobs.filter((job) => job.updatedAt >= since) : jobs),
      ...(since ? { ids: jobs.map((job) => job.id) } : {}),
      queuePositions,
      queueOrder: waitingResources.map((resource) => byResource.get(resource)!.pop()!),
      paused: { mine: pauses.has(ownerId), all: pauses.has(everyone) },
      clearableFailedSets,
    } satisfies QueueResponse;
    const listMs = listedAt - started;
    const hydrateMs = performance.now() - listedAt;
    return {
      status: 200,
      payload,
      onJsonSent(jsonSendMs: number) {
        pollProfile.requests += 1;
        if (since) pollProfile.deltaRequests += 1;
        pollProfile.listedJobs += jobs.length;
        pollProfile.returnedJobs += payload.jobs.length;
        pollProfile.totalListMs += listMs;
        pollProfile.totalHydrateMs += hydrateMs;
        pollProfile.totalJsonSendMs += jsonSendMs;
        const totalMs = listMs + hydrateMs + jsonSendMs;
        if (totalMs > pollProfile.slowest.totalMs)
          pollProfile.slowest = { totalMs, listMs, hydrateMs, jsonSendMs };
        pollReport ??= setTimeout(reportPollProfile, 60_000).unref();
      },
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
    if (!store.move(ownerOf(account), [params.id], to))
      return { status: 409, payload: { error: "Only waiting generations can be moved." } };
    void queue.tick();
    return { status: 200, payload: { ok: true } };
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
    void queue.tick();
    return { status: 200, payload: { ok: true } };
  });
  // A conversationId narrows Stop All to the work that chat submitted (MCP's cancel_all).
  directRoute(app, "POST", "/api/queue/cancel-all", async (account, { body }) => {
    const ownerId = ownerOf(account);
    const chat = body?.conversationId;
    const work = ownWork(store, ownerId).filter(
      (job) =>
        chat === undefined ||
        (job.input.chat as { conversationId?: string } | undefined)?.conversationId === chat,
    );
    const outcomes = await Promise.all(
      work.map(async (initial) => {
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
  directRoute(app, "POST", "/api/queue/sets/:set/clear-failed", (account, { params }) => {
    const ownerId = ownerOf(account);
    const set = params.set;
    store.db.exec("BEGIN IMMEDIATE");
    try {
      if (!store.clearableFailedSets(ownerId, [set]).length) {
        store.db.exec("ROLLBACK");
        return {
          status: 409,
          payload: { error: "Only sets with failed work alone can be cleared." },
        };
      }
      const failed = store.failedSetJobs(ownerId, set);
      failed.forEach((job) => clear(store, job));
      store.db.exec("COMMIT");
      return { status: 200, payload: { cleared: failed.length } };
    } catch (error) {
      store.db.exec("ROLLBACK");
      throw error;
    }
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
  directRoute(app, "POST", "/api/queue/retry", (account, { body }) => {
    const ids = body?.ids;
    if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === "string"))
      return refused("Specify the failed generations to retry.");
    const ownerId = ownerOf(account);
    const accepted = new Set<string>();
    const outcomes = [...new Set<string>(ids)].map((id) => {
      try {
        const job = queue.retry(ownerId, id, true);
        if (!job) return { id, error: "Only your failed generations can be retried." };
        accepted.add(id);
        return { id, replacement: job.id };
      } catch (error) {
        logWarning(`Could not retry generation ${id}: ${(error as Error).message}`);
        return { id, error: "Could not queue the retry." };
      }
    });
    if (accepted.size) {
      void queue.tick();
      removeRetryTiles(ownerId, accepted);
    }
    return { status: 202, payload: { outcomes } satisfies QueueRetryResponse };
  });
}

/**
 * Settings › Maintenance › Unfinished Items lists every account's jobs for administrators.
 * Working jobs come first, then queued jobs in queue order. Administrators can retry, stop or
 * clear a job, or act on every listed job at once.
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
    const working: UnfinishedJob[] = [];
    const queued: UnfinishedJob[] = [];
    const remaining: UnfinishedJob[] = [];
    for (const job of store.openJobs()) {
      if (job.cleared) continue;
      const row = { ...publicJob(job), ownerId: job.ownerId };
      if (acceptedWork(job) || queue.isWriting(job.id)) working.push(row);
      else if (job.status === "queued" || job.status === "waiting") queued.push(row);
      else remaining.push(row);
    }
    return { status: 200, payload: { jobs: [...working, ...queued, ...remaining] } };
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
