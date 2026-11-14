import { randomInt, randomUUID } from "node:crypto";
import { compareVariants } from "../../shared/compare.ts";
import type { GenerationInput, QueueMedia } from "../../shared/queue.ts";
import type { DomainResponse, GenerationAccount, GenerationScope } from "./admission.ts";
import { directRoute } from "./direct-route.ts";
import type { Store, QueueOrigin } from "./store.ts";

/**
 * A compare set: `compareVariants` image jobs shown side by side. `vote` is the starred winner and,
 * with the variants' recorded inputs, the taste signal the taste profile learns from. A compare run
 * is also a result set of the same ID (`comparisonSet`), so the gallery keeps its results together.
 */
export interface ComparisonRecord {
  id: string;
  ownerId: string;
  createdAt: string;
  /** The shared seed; empty when the variants were drawn with different seeds. */
  seed: string;
  jobIds: string[];
  /** Each variant's own image, where its job made several (Compare Selected); else its first. */
  itemIds?: string[];
  labels?: string[];
  vote: string | null;
  /** The exact winning image, including when several variants share one job. */
  winnerItemId?: string;
  votedAt?: string;
}
type GalleryItem = QueueMedia & {
  jobId?: string;
  type?: string;
  status?: string;
  resultSet?: { id: string };
};
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
/** The result set a compare run's variant `index` belongs to, named by its label. */
export const comparisonSet = (id: string, index: number, label: string) => ({
  id,
  title: "Comparison",
  index,
  variation: label,
});
const object = (value: unknown): value is GenerationInput =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const owner = (req: Request) => req.studioAccount?.userId || "";
const range = `${compareVariants.min}–${compareVariants.max}`;
const sized = (list: unknown[]) =>
  list.length >= compareVariants.min && list.length <= compareVariants.max;

/** Compare runs queue as one set and read back against the caller's current gallery. */
export function registerCompareRoutes(
  app: Router,
  options: {
    store: Store;
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
    /** Hears the winning image and other finished variants, for the taste profile; must not throw. */
    voted?(ownerId: string, winner: GalleryItem, others: GalleryItem[]): void;
  },
) {
  const { store } = options;
  /** The variant's saved image (`itemId` when chosen), else a placeholder from its queue record. */
  function variantItem(ownerId: string, items: GalleryItem[], jobId: string, itemId?: string) {
    const saved = items.find(
      (item) =>
        item.jobId === jobId &&
        (!itemId || item.id === itemId) &&
        item.type === "image" &&
        item.status !== "cancelled",
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
      status: job.status === "failed" || job.status === "cancelled" ? job.status : "pending",
      ...(job.status === "failed" ? { error: job.reason } : {}),
    };
  }
  const recordItem = (record: ComparisonRecord, items: GalleryItem[], index: number) =>
    variantItem(record.ownerId, items, record.jobIds[index], record.itemIds?.[index]);
  function show(record: ComparisonRecord, items: GalleryItem[]) {
    const variants = record.jobIds.map((jobId, index) => ({
      jobId,
      label: record.labels?.[index] || `Variant ${letter(index)}`,
      item: recordItem(record, items, index),
    }));
    const winner = variants.find(
      (variant) =>
        variant.jobId === record.vote &&
        (!record.winnerItemId || variant.item?.id === record.winnerItemId) &&
        variant.item?.status === "done",
    );
    const shared = (key: "prompt" | "negative") =>
      new Set(variants.map((variant) => variant.item?.[key] || "")).size === 1
        ? { [key]: variants[0].item?.[key] || "" }
        : {};
    const sets = new Set(variants.map((variant) => variant.item?.resultSet?.id));
    const [set] = sets;
    return {
      id: record.id,
      createdAt: record.createdAt,
      seed: record.seed,
      // The result set every variant belongs to, which the gallery shows together.
      ...(sets.size === 1 && set ? { set } : {}),
      ...shared("prompt"),
      ...shared("negative"),
      vote: winner ? record.vote : null,
      winnerItemId: winner?.item?.id ?? null,
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
  function create(
    ownerId: string,
    jobIds: string[],
    items: GalleryItem[],
    labels?: string[],
    itemIds?: string[],
  ) {
    const seeds = new Set(
      jobIds.map((id, index) => {
        const selected = itemIds && items.find((item) => item.id === itemIds[index]);
        const settings = selected?.settings as GenerationInput | undefined;
        return String(settings?.seed ?? store.job(ownerId, id)?.input.seed ?? "");
      }),
    );
    const record: ComparisonRecord = {
      id: randomUUID(),
      ownerId,
      createdAt: new Date().toISOString(),
      seed: seeds.size === 1 ? [...seeds][0] : "",
      jobIds,
      ...(itemIds ? { itemIds } : {}),
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

  directRoute(app, "GET", "/api/comparisons", (account, { query }) => {
    const items = options.gallery({ studioAccount: account ?? undefined, params: {} });
    if (!items)
      return {
        status: 403,
        payload: { ok: false, error: "Gallery access is disabled for this account." },
      };
    const jobs = typeof query.jobIds === "string" ? new Set(query.jobIds.split(",")) : null;
    const records = options
      .read()
      .filter(
        (record) =>
          record.ownerId === (account?.userId || "") &&
          (!jobs || record.jobIds.some((id) => jobs.has(id))),
      );
    // `members=1` lists only which results each comparison holds, for finding an item's comparison.
    return {
      status: 200,
      payload: {
        comparisons:
          query.members === "1"
            ? records.map(({ id, jobIds, itemIds }) => ({
                id,
                jobIds,
                ...(itemIds ? { itemIds } : {}),
              }))
            : records.map((record) => show(record, items)),
      },
    };
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
  // MCP records its multi-model runs through this one, and Compare Selected the chosen images
  // (`itemIds`, one per job).
  directRoute(app, "POST", "/api/comparisons", (account, { body }) => {
    const items = options.gallery({ studioAccount: account ?? undefined, params: {} });
    if (!items)
      return {
        status: 403,
        payload: { ok: false, error: "Gallery access is disabled for this account." },
      };
    const { jobIds, labels, itemIds } = body || {};
    if (
      !Array.isArray(jobIds) ||
      !sized(jobIds) ||
      jobIds.some((id) => typeof id !== "string") ||
      (!itemIds && new Set(jobIds).size !== jobIds.length) ||
      !labelsValid(labels, jobIds.length) ||
      (itemIds !== undefined &&
        (!Array.isArray(itemIds) ||
          itemIds.length !== jobIds.length ||
          itemIds.some((id) => typeof id !== "string") ||
          new Set(itemIds).size !== itemIds.length))
    )
      return {
        status: 400,
        payload: { ok: false, error: `Choose ${range} different images.` },
      };
    const ownerId = account?.userId || "";
    const image = (id: string) => {
      const job = store.job(ownerId, id);
      return job
        ? job.input.kind !== "video" && job.operation !== "upscale"
        : items.some((item) => item.jobId === id && item.type === "image");
    };
    const chosen = (id: string, index: number) =>
      items.some((item) => item.id === id && item.jobId === jobIds[index] && item.type === "image");
    if (!jobIds.every(image) || (itemIds && !itemIds.every(chosen)))
      return { status: 404, payload: { ok: false, error: "A comparison image is unavailable." } };
    const record = create(ownerId, jobIds, items, labels as string[] | undefined, itemIds);
    return { status: 201, payload: show(record, items) };
  });
  // Every variant shares the seed and runs as one queue set; a refused variant cancels the rest.
  app.post("/api/comparisons/run", async (req, res) => {
    const items = gallery(req, res);
    if (!items) return;
    const { variants, sessionId, parentJobId, parentItemId } = req.body || {};
    if (
      !Array.isArray(variants) ||
      !sized(variants) ||
      variants.some((variant) => !object(variant?.input) || variant.input.kind === "video") ||
      !labelsValid(
        variants.map((variant) => variant.label),
        variants.length,
      )
    )
      return res.status(400).json({
        ok: false,
        error: `Choose ${range} image variants, each with a label and settings.`,
      });
    const ownerId = owner(req);
    if (
      sessionId !== undefined &&
      (typeof sessionId !== "string" || !store.session(ownerId, sessionId))
    )
      return res.status(404).json({ ok: false, error: "Session not found." });
    if (
      parentJobId !== undefined &&
      (typeof parentJobId !== "string" ||
        !store.job(ownerId, parentJobId) ||
        store.job(ownerId, parentJobId)?.sessionId !== sessionId)
    )
      return res.status(404).json({ ok: false, error: "Source generation not found." });
    if (
      parentItemId !== undefined &&
      (typeof parentItemId !== "string" || !items.some((item) => item.id === parentItemId))
    )
      return res.status(404).json({ ok: false, error: "Source image not found." });
    const requested = String(variants[0].input.seed ?? "");
    const seed = /^\d+$/.test(requested) ? requested : String(randomInt(2 ** 32));
    const id = randomUUID();
    const session = (sessionId as string | undefined) || store.createSession(ownerId).id;
    const jobIds: string[] = [];
    for (const [index, variant] of variants.entries()) {
      const { clientJobId: _clientJobId, ...input } = variant.input as GenerationInput;
      const resultSet = comparisonSet(id, index, String(variant.label).trim());
      const result = await options.admit(
        { ...input, kind: "image", seed, count: 1, resultSet },
        req.studioAccount,
        {
          sessionId: session,
          operation: "image",
          parentJobId: parentJobId as string | undefined,
          parentItemId: parentItemId as string | undefined,
        },
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
    return res.status(201).json({ ...show(record, items), sessionId: session });
  });
  app.put("/api/comparisons/:id/vote", (req, res) => {
    const items = gallery(req, res);
    if (!items) return;
    const records = options.read();
    const record = records.find((item) => item.id === req.params.id && item.ownerId === owner(req));
    if (!record)
      return res.status(404).json({ ok: false, error: "That comparison is unavailable." });
    const { itemId, jobId } = req.body || {};
    const clear = itemId === null || (itemId === undefined && jobId === null);
    const variants = record.jobIds.map((_, index) => recordItem(record, items, index));
    const winner = clear
      ? undefined
      : variants.find((item) =>
          itemId !== undefined ? item?.id === itemId : item?.jobId === jobId,
        );
    if (!clear && (!winner || winner.status !== "done"))
      return res.status(400).json({ ok: false, error: "Choose a finished, available variant." });
    record.vote = winner?.jobId || null;
    if (winner) record.winnerItemId = winner.id;
    else delete record.winnerItemId;
    record.votedAt = new Date().toISOString();
    options.write(records);
    if (winner) {
      const others = variants.filter((item): item is GalleryItem =>
        Boolean(item && item.id !== winner.id && item.status === "done"),
      );
      options.voted?.(record.ownerId, winner, others);
    }
    return res.json(show(record, items));
  });
}
