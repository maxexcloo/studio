import {
  type GenerationInput,
  type QueueCancelAllResponse,
  type QueueMedia,
  type QueueResponse,
  type UnfinishedJob,
} from "../../shared/queue.ts";
import type { DomainResponse, GenerationAccount, GenerationScope } from "./admission.ts";
import { directRoute, type RouteAccount } from "./direct-route.ts";
import { GenerationQueue } from "./queue.ts";
import { everyone, publicJob, queuePriority, Store, type OwnedJob } from "./store.ts";

interface Request {
  studioAccount?: { userId: string; role?: string };
  params: Record<string, string>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}
interface Response {
  status(code: number): Response;
  json(value: unknown): unknown;
}
type Handler = (req: Request, res: Response) => unknown;
interface Router {
  get(path: string, handler: Handler): unknown;
  patch(path: string, handler: Handler): unknown;
  post(path: string, handler: Handler): unknown;
  delete(path: string, handler: Handler): unknown;
}
const owner = (req: Request) => req.studioAccount?.userId || "";
const ownerOf = (account: RouteAccount) => account?.userId || "";
/** The person's queue, Dream's background jobs included, without failed jobs the person cleared. */
const listed = (store: Store, ownerId: string) => store.jobs(ownerId).filter((job) => !job.cleared);
/** What Stop All and Cancel Pending act on: the person's own unfinished work, as Dream's pause stops Dream's. */
const ownWork = (store: Store, ownerId: string) =>
  store.openJobs(ownerId).filter((job) => !job.cleared && job.priority !== queuePriority.dream);
const clear = (store: Store, job: OwnedJob) => store.save({ ...job, cleared: true });
const missing = (res: Response) => res.status(404).json({ error: "Not found." });
const notFound = { status: 404, payload: { error: "Not found." } };
// A cancel the worker could not confirm yet (busy, or a proxy answering for it); recovery finishes it.
export const unconfirmedCancel =
  "Cancellation could not be confirmed. The recorded job remains available for recovery.";
const object = (value: unknown): value is GenerationInput =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export function registerRewriteRoutes(
  app: Router,
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
    admit?: (
      input: GenerationInput,
      account?: GenerationAccount,
      scope?: GenerationScope,
    ) => Promise<DomainResponse>;
    /**
     * The owner's gallery records of a job. A job's own results are what its adapter reported (a
     * cloud provider's bare files, or a snapshot taken on completion), so the queue shows the
     * gallery's records instead: each with its prompt, settings, title and star.
     */
    media?: (ownerId: string, jobId: string) => QueueMedia[];
    /** Whether the owner has this gallery item, which a run may then be made from. */
    ownsItem?: (ownerId: string, id: string) => boolean;
  },
) {
  const shown = (ownerId: string, jobs: OwnedJob[]) =>
    jobs.map((job) => {
      const items = media?.(ownerId, job.id);
      return publicJob(items?.length ? { ...job, items } : job);
    });
  app.get("/api/user-presets", (req, res) => res.json({ presets: store.presets(owner(req)) }));
  app.post("/api/user-presets", (req, res) => {
    if (typeof req.body?.title !== "string" || !req.body.title.trim() || !object(req.body.input))
      return res.status(400).json({ error: "A title and generation input are required." });
    // The parts of a draft a preset holds, when it holds only some (the Presets popup's names).
    const parts = req.body.parts;
    if (
      parts !== undefined &&
      (!Array.isArray(parts) || !parts.every((part) => typeof part === "string"))
    )
      return res.status(400).json({ error: "Preset parts must be a list of names." });
    return res.status(201).json({
      preset: store.createPreset(owner(req), req.body.title.trim(), req.body.input, parts),
    });
  });
  app.delete("/api/user-presets/:id", (req, res) =>
    store.deletePreset(owner(req), req.params.id) ? res.json({ ok: true }) : missing(res),
  );
  app.patch("/api/user-presets/:id", (req, res) => {
    if (
      req.body?.title !== undefined &&
      (typeof req.body.title !== "string" || !req.body.title.trim())
    )
      return res.status(400).json({ error: "A preset title is required." });
    if (req.body?.input !== undefined && !object(req.body.input))
      return res.status(400).json({ error: "Generation input must be an object." });
    const preset = store.updatePreset(owner(req), req.params.id, {
      ...(typeof req.body?.title === "string" ? { title: req.body.title.trim() } : {}),
      ...(object(req.body?.input) ? { input: req.body.input } : {}),
    });
    return preset ? res.json({ preset }) : missing(res);
  });
  app.post("/api/sessions", (req, res) => {
    if (req.body?.inputs !== undefined && !object(req.body.inputs))
      return res.status(400).json({ error: "Inputs must be an object." });
    return res.status(201).json({
      session: store.createSession(
        owner(req),
        typeof req.body?.title === "string" ? req.body.title : undefined,
        req.body?.inputs as GenerationInput | undefined,
      ),
    });
  });
  // A session's jobs, with their gallery records.
  app.get("/api/sessions/:id", (req, res) => {
    const session = store.session(owner(req), req.params.id);
    return session
      ? res.json({ session, jobs: shown(owner(req), store.jobs(owner(req), session.id)) })
      : missing(res);
  });
  app.post("/api/sessions/:id/generations", async (req, res) => {
    if (!store.session(owner(req), req.params.id)) return missing(res);
    const { operation = "image", parentJobId, parentItemId, ...input } = req.body || {};
    if (!["image", "refine", "animate"].includes(String(operation)))
      return res.status(400).json({ error: "Unknown generation operation." });
    const parent =
      typeof parentJobId === "string"
        ? store.jobs(owner(req), req.params.id).find((job) => job.id === parentJobId)
        : undefined;
    if (parentJobId !== undefined && !parent)
      return res.status(400).json({ error: "Parent generation must belong to this session." });
    // The result a run is made from is the owner's: one of the parent's results or a gallery item.
    if (
      parentItemId !== undefined &&
      (typeof parentItemId !== "string" ||
        !(
          [...(parent?.items || []), ...(parent?.outputs || [])].some(
            (item) => item.id === parentItemId,
          ) || ownsItem?.(owner(req), parentItemId)
        ))
    )
      return res.status(400).json({ error: "Parent result must be one of your items." });
    if (!admit) return res.status(501).json({ error: "Generation is unavailable." });
    const admitted = await admit(input, req.studioAccount as GenerationAccount | undefined, {
      sessionId: req.params.id,
      operation: operation as GenerationScope["operation"],
      parentJobId: parentJobId as string | undefined,
      parentItemId: parentItemId as string | undefined,
    });
    if (admitted.status >= 400) return res.status(admitted.status).json(admitted.payload);
    const job = store.job(owner(req), String(admitted.payload.jobId))!;
    return res
      .status(202)
      .json({ jobId: job.id, sessionId: job.sessionId, status: job.status, job: publicJob(job) });
  });
  directRoute(app, "GET", "/api/queue", (account) => {
    const ownerId = ownerOf(account);
    const pauses = store.pauses();
    return {
      status: 200,
      payload: {
        // Polled while work runs: a job with gallery records drops the adapter's copies of them,
        // which every reader passes over for the records.
        jobs: shown(ownerId, listed(store, ownerId)).map((job) =>
          job.items.length ? { ...job, outputs: [] } : job,
        ),
        paused: { mine: pauses.has(ownerId), all: pauses.has(everyone) },
      } satisfies QueueResponse,
    };
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
    return store.move(ownerOf(account), params.id, to)
      ? { status: 200, payload: { ok: true } }
      : { status: 409, payload: { error: "Only waiting generations can be moved." } };
  });
  app.post("/api/queue/cancel-pending", async (req, res) => {
    let cancelled = 0;
    for (const job of ownWork(store, owner(req)).filter((item) =>
      ["writing", "queued", "waiting"].includes(item.status),
    )) {
      if ((await queue.cancel(owner(req), job.id))?.status === "cancelled") cancelled++;
    }
    return res.json({ cancelled });
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
  app.post("/api/queue/:id/cancel", async (req, res) => {
    let job;
    try {
      job = await queue.cancel(owner(req), req.params.id);
    } catch {
      return res.status(503).json({ error: unconfirmedCancel });
    }
    return job ? res.json({ job: publicJob(job) }) : missing(res);
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
 * finished, oldest first, to retry (end it and queue it again) or delete (end it and take it out of
 * the queue).
 */
export function registerMaintenanceRoutes(
  app: Router,
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
}
