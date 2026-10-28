import { randomInt, randomUUID } from "node:crypto";
import type { GenerationInput, QueueMedia } from "../../shared/queue.ts";
import type { DomainResponse, GenerationAccount, GenerationScope } from "./admission.ts";
import type { RewriteStore, QueueOrigin } from "./store.ts";

/**
 * A compare set: 2–4 image jobs shown side by side. `vote` is the starred winner and, with the
 * variants' recorded inputs, the taste signal the taste profile learns from.
 */
export interface ComparisonRecord {
  id: string;
  ownerId: string;
  createdAt: string;
  /** The shared seed; empty when the variants were drawn with different seeds. */
  seed: string;
  jobIds: string[];
  labels?: string[];
  vote: string | null;
  votedAt?: string;
}
type GalleryItem = QueueMedia & { jobId?: string; type?: string; status?: string };
interface Request {
  studioAccount?: GenerationAccount;
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
  post(path: string, handler: Handler): unknown;
  put(path: string, handler: Handler): unknown;
}

const letter = (index: number) => String.fromCharCode(65 + index);
const object = (value: unknown): value is GenerationInput =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const owner = (req: Request) => req.studioAccount?.userId || "";

/** Compare runs queue as one set and read back against the caller's current gallery. */
export function registerCompareRoutes(
  app: Router,
  options: {
    store: RewriteStore;
    admit(
      input: GenerationInput,
      account?: GenerationAccount,
      scope?: GenerationScope,
      origin?: QueueOrigin,
    ): Promise<DomainResponse>;
    cancel(ownerId: string, jobId: string): Promise<unknown>;
    read(): ComparisonRecord[];
    write(records: ComparisonRecord[]): void;
    /** The caller's visible gallery, or `null` when the account may not use the gallery. */
    gallery(req: Request): GalleryItem[] | null;
    pendingItems(id: string, input: GenerationInput): QueueMedia[];
    /** Hears the winning job of a vote and the other finished variants, for the taste profile; must not throw. */
    voted?(ownerId: string, jobId: string, others: string[]): void;
    /** Titles the chat a compare run starts; must not reject. */
    title?(account: GenerationAccount | undefined, sessionId: string, prompt: string): unknown;
  },
) {
  const { store } = options;
  /** The variant's saved image, else a placeholder from its queue record. */
  function variantItem(ownerId: string, items: GalleryItem[], jobId: string) {
    const saved = items.find(
      (item) => item.jobId === jobId && item.type === "image" && item.status !== "canceled",
    );
    if (saved) return saved;
    const job = store.job(ownerId, jobId);
    if (!job) return null;
    const [pending] = options.pendingItems(job.id, {
      ...job.input,
      ownerId,
      createdAt: job.createdAt,
    });
    return {
      ...pending,
      status:
        job.status === "failed" ? "error" : job.status === "cancelled" ? "canceled" : "pending",
      ...(job.status === "failed" ? { error: job.reason } : {}),
    };
  }
  function show(record: ComparisonRecord, items: GalleryItem[]) {
    const variants = record.jobIds.map((jobId, index) => ({
      jobId,
      label: record.labels?.[index] || `Variant ${letter(index)}`,
      item: variantItem(record.ownerId, items, jobId),
    }));
    const shared = (key: "prompt" | "negative") =>
      new Set(variants.map((variant) => variant.item?.[key] || "")).size === 1
        ? { [key]: variants[0].item?.[key] || "" }
        : {};
    return {
      id: record.id,
      createdAt: record.createdAt,
      seed: record.seed,
      ...shared("prompt"),
      ...shared("negative"),
      vote: variants.some(
        (variant) => variant.jobId === record.vote && variant.item?.status === "done",
      )
        ? record.vote
        : null,
      variants,
    };
  }
  function save(record: ComparisonRecord) {
    const records = options.read();
    options.write([
      record,
      ...records.filter((item) => item.ownerId === record.ownerId).slice(0, 99),
      ...records.filter((item) => item.ownerId !== record.ownerId),
    ]);
  }
  /** Records an existing set of the owner's image jobs, such as an MCP fan-out run. */
  function create(ownerId: string, jobIds: string[], labels?: string[]) {
    const seeds = new Set(
      jobIds.map((id) => String(store.job(ownerId, id)?.input.seed ?? "")).filter(Boolean),
    );
    const record: ComparisonRecord = {
      id: randomUUID(),
      ownerId,
      createdAt: new Date().toISOString(),
      seed: seeds.size === 1 ? [...seeds][0] : "",
      jobIds,
      ...(labels ? { labels } : {}),
      vote: null,
    };
    save(record);
    return record;
  }
  const gallery = (req: Request, res: Response) => {
    const items = options.gallery(req);
    if (!items)
      res.status(403).json({ ok: false, error: "Gallery access is disabled for this account." });
    return items;
  };
  const labelsValid = (labels: unknown, length: number) =>
    labels === undefined ||
    (Array.isArray(labels) &&
      labels.length === length &&
      labels.every((label) => typeof label === "string" && label.trim() && label.length <= 80));

  app.get("/api/comparisons", (req, res) => {
    const items = gallery(req, res);
    if (!items) return;
    res.json({
      comparisons: options
        .read()
        .filter((record) => record.ownerId === owner(req))
        .map((record) => show(record, items)),
    });
  });
  app.get("/api/comparisons/:id", (req, res) => {
    const items = gallery(req, res);
    if (!items) return;
    const record = options
      .read()
      .find((item) => item.id === req.params.id && item.ownerId === owner(req));
    return record
      ? res.json(show(record, items))
      : res.status(404).json({ ok: false, error: "That comparison is unavailable." });
  });
  app.post("/api/comparisons", (req, res) => {
    const items = gallery(req, res);
    if (!items) return;
    const { jobIds, labels } = req.body || {};
    if (
      !Array.isArray(jobIds) ||
      jobIds.length < 2 ||
      jobIds.length > 4 ||
      jobIds.some((id) => typeof id !== "string") ||
      new Set(jobIds).size !== jobIds.length ||
      !labelsValid(labels, jobIds.length)
    )
      return res.status(400).json({ ok: false, error: "Choose 2–4 different image jobs." });
    const ownerId = owner(req);
    const image = (id: string) => {
      const job = store.job(ownerId, id);
      return job
        ? job.input.kind !== "video" && job.operation !== "upscale"
        : items.some((item) => item.jobId === id && item.type === "image");
    };
    if (!jobIds.every(image))
      return res.status(404).json({ ok: false, error: "A comparison image is unavailable." });
    const record = create(ownerId, jobIds, labels as string[] | undefined);
    return res.status(201).json(show(record, items));
  });
  // Every variant shares the seed and runs as one queue set; a refused variant cancels the rest.
  app.post("/api/comparisons/run", async (req, res) => {
    const items = gallery(req, res);
    if (!items) return;
    const { variants, sessionId } = req.body || {};
    if (
      !Array.isArray(variants) ||
      variants.length < 2 ||
      variants.length > 4 ||
      variants.some((variant) => !object(variant?.input) || variant.input.kind === "video") ||
      !labelsValid(
        variants.map((variant) => variant.label),
        variants.length,
      )
    )
      return res
        .status(400)
        .json({ ok: false, error: "Choose 2–4 image variants, each with a label and settings." });
    const ownerId = owner(req);
    if (
      sessionId !== undefined &&
      (typeof sessionId !== "string" || !store.session(ownerId, sessionId))
    )
      return res.status(404).json({ ok: false, error: "Session not found." });
    const requested = String(variants[0].input.seed ?? "");
    const seed = /^\d+$/.test(requested) ? requested : String(randomInt(2 ** 32));
    const id = randomUUID();
    const chat = (sessionId as string | undefined) || store.createSession(ownerId).id;
    const jobIds: string[] = [];
    for (const variant of variants) {
      const { clientJobId: _clientJobId, ...input } = variant.input as GenerationInput;
      const result = await options.admit(
        { ...input, kind: "image", seed, count: 1 },
        req.studioAccount,
        { sessionId: chat, operation: "image" },
        { queueSet: id },
      );
      if (result.status >= 400) {
        await Promise.all(
          jobIds.map((jobId) => options.cancel(ownerId, jobId).catch(() => undefined)),
        );
        return res.status(result.status).json(result.payload);
      }
      jobIds.push(String(result.payload.jobId));
    }
    const prompt = String(variants[0].input.prompt || "").trim();
    if (!sessionId && prompt) void options.title?.(req.studioAccount, chat, prompt);
    const record: ComparisonRecord = {
      id,
      ownerId,
      createdAt: new Date().toISOString(),
      seed,
      jobIds,
      labels: variants.map((variant) => String(variant.label).trim()),
      vote: null,
    };
    save(record);
    return res.status(201).json({ ...show(record, items), sessionId: chat });
  });
  app.put("/api/comparisons/:id/vote", (req, res) => {
    const items = gallery(req, res);
    if (!items) return;
    const records = options.read();
    const record = records.find((item) => item.id === req.params.id && item.ownerId === owner(req));
    if (!record)
      return res.status(404).json({ ok: false, error: "That comparison is unavailable." });
    const vote = req.body?.jobId;
    if (
      vote !== null &&
      (typeof vote !== "string" ||
        !record.jobIds.includes(vote) ||
        variantItem(record.ownerId, items, vote)?.status !== "done")
    )
      return res.status(400).json({ ok: false, error: "Choose a finished, available variant." });
    record.vote = vote;
    record.votedAt = new Date().toISOString();
    options.write(records);
    if (vote)
      options.voted?.(
        record.ownerId,
        vote,
        record.jobIds.filter(
          (jobId) => jobId !== vote && variantItem(record.ownerId, items, jobId)?.status === "done",
        ),
      );
    return res.json(show(record, items));
  });
}
