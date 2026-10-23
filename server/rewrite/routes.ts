import type { GenerationInput, GenerationOperation } from "../../shared/queue.ts";
import { GenerationQueue } from "./queue.ts";
import { publicJob, RewriteStore } from "./store.ts";

interface Request {
  studioAccount?: { userId: string; role?: string };
  params: Record<string, string>;
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
const missing = (res: Response) => res.status(404).json({ error: "Not found." });
const object = (value: unknown): value is GenerationInput =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
function admissionError(res: Response, error: unknown) {
  const failure = error as { status?: number; reason?: string; message: string };
  if (failure.status !== 429) throw error;
  return res.status(429).json({ ok: false, reason: failure.reason, error: failure.message });
}

export function registerRewriteRoutes(
  app: Router,
  {
    store,
    queue,
    resourceFor = () => "local-media",
    jobLimit,
  }: {
    store: RewriteStore;
    queue: GenerationQueue;
    resourceFor?: (input: GenerationInput) => string | Promise<string>;
    jobLimit?: number;
  },
) {
  app.get("/api/user-presets", (req, res) => res.json({ presets: store.presets(owner(req)) }));
  app.post("/api/user-presets", (req, res) => {
    if (typeof req.body?.title !== "string" || !req.body.title.trim() || !object(req.body.input))
      return res.status(400).json({ error: "A title and generation input are required." });
    return res
      .status(201)
      .json({ preset: store.createPreset(owner(req), req.body.title.trim(), req.body.input) });
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
  app.get("/api/sessions", (req, res) => res.json({ sessions: store.sessions(owner(req)) }));
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
  app.get("/api/sessions/:id", (req, res) => {
    const session = store.session(owner(req), req.params.id);
    return session
      ? res.json({ session, jobs: store.jobs(owner(req), session.id).map(publicJob) })
      : missing(res);
  });
  app.patch("/api/sessions/:id", (req, res) => {
    if (req.body?.inputs !== undefined && !object(req.body.inputs))
      return res.status(400).json({ error: "Inputs must be an object." });
    const patch = {
      ...(typeof req.body?.title === "string" ? { title: req.body.title } : {}),
      ...(object(req.body?.inputs) ? { inputs: req.body.inputs } : {}),
    };
    const session = store.updateSession(owner(req), req.params.id, patch);
    return session ? res.json({ session }) : missing(res);
  });
  app.post("/api/sessions/:id/generations", async (req, res) => {
    if (!store.session(owner(req), req.params.id)) return missing(res);
    const { operation = "image", parentJobId, ...input } = req.body || {};
    if (!["image", "refine", "animate"].includes(String(operation)))
      return res.status(400).json({ error: "Unknown generation operation." });
    if (
      parentJobId !== undefined &&
      (typeof parentJobId !== "string" ||
        !store.jobs(owner(req), req.params.id).some((job) => job.id === parentJobId))
    )
      return res.status(400).json({ error: "Parent generation must belong to this session." });
    let job;
    try {
      job = store.enqueue(
        owner(req),
        req.params.id,
        input,
        operation as GenerationOperation,
        parentJobId as string | undefined,
        await resourceFor(input),
        undefined,
        req.studioAccount?.role === "user" ? jobLimit : undefined,
      );
    } catch (error) {
      return admissionError(res, error);
    }
    // The scheduler is also driven by its timer; responses acknowledge durable acceptance.
    void queue.tick().catch(() => undefined);
    return res
      .status(202)
      .json({ jobId: job.id, sessionId: job.sessionId, status: job.status, job: publicJob(job) });
  });
  app.get("/api/queue", (req, res) => res.json({ jobs: store.jobs(owner(req)).map(publicJob) }));
  app.post("/api/queue/cancel-pending", async (req, res) => {
    let cancelled = 0;
    for (const job of store
      .jobs(owner(req))
      .filter((item) => ["queued", "waiting"].includes(item.status))) {
      if ((await queue.cancel(owner(req), job.id))?.status === "cancelled") cancelled++;
    }
    return res.json({ cancelled });
  });
  app.post("/api/queue/:id/cancel", async (req, res) => {
    const job = await queue.cancel(owner(req), req.params.id);
    return job ? res.json({ job: publicJob(job) }) : missing(res);
  });
  app.post("/api/queue/:id/retry", (req, res) => {
    if (!store.job(owner(req), req.params.id)) return missing(res);
    let job;
    try {
      job = queue.retry(
        owner(req),
        req.params.id,
        req.studioAccount?.role === "user" ? jobLimit : undefined,
      );
    } catch (error) {
      return admissionError(res, error);
    }
    if (!job) return res.status(409).json({ error: "Only failed generations can be retried." });
    void queue.tick().catch(() => undefined);
    return res.status(202).json({ job: publicJob(job) });
  });
}
