import { randomInt, randomUUID } from "node:crypto";
import { compareVariants } from "../../shared/compare.ts";
import type { GenerationInput, QueueMedia } from "../../shared/queue.ts";
import type { DomainResponse, GenerationAccount, GenerationScope } from "./admission.ts";
import { directRoute, type RouteAccount } from "./direct-route.ts";
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
  /** The one thing the variants vary (variants of a result, "lighting"), which a pick adds to the brief. */
  axis?: string;
  /** The project whose brief the pick updates, where the run came from an attached chat. */
  projectId?: string;
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

/** The jobs and chosen items a comparison reads from the gallery. */
type ComparisonIds = { jobIds?: string[]; itemIds?: string[] };

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
    gallery(req: Request, ids: ComparisonIds): GalleryItem[] | null;
    pendingItems(id: string, input: GenerationInput): QueueMedia[];
    /** The variants' items with their result numbers. */
    numbered(items: GalleryItem[]): GalleryItem[];
    /** Hears the winning image and other finished variants, for the taste profile; must not throw. */
    voted?(ownerId: string, winner: GalleryItem, others: GalleryItem[]): void;
    /** Adds an axis comparison's pick to its project's brief, answering what changed, or null. */
    picked?(
      record: ComparisonRecord,
      choice: string,
      by: "chat" | "studio",
    ): { projectId: string; name: string; styles: string } | null;
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
    const variants = record.jobIds.map((jobId, index) => {
      const item = recordItem(record, items, index);
      return {
        jobId,
        label: record.labels?.[index] || `Variant ${letter(index)}`,
        item: item && options.numbered([item])[0],
      };
    });
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
      ...(record.axis ? { axis: record.axis } : {}),
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
  const galleryOff = {
    status: 403,
    payload: { ok: false, error: "The gallery is off for this account." },
  };
  const galleryFor = (account: RouteAccount | null | undefined, ids: ComparisonIds) =>
    options.gallery({ studioAccount: account ?? undefined, params: {} } as Request, ids);
  const idsOf = (record?: ComparisonRecord): ComparisonIds => ({
    jobIds: record?.jobIds || [],
    itemIds: record?.itemIds || [],
  });
  const gallery = (req: Request, res: Response, ids: ComparisonIds) => {
    const items = options.gallery(req, ids);
    if (!items) res.status(403).json({ ok: false, error: "The gallery is off for this account." });
    return items;
  };
  const labelsValid = (labels: unknown, length: number) =>
    labels === undefined ||
    (Array.isArray(labels) &&
      labels.length === length &&
      labels.every((label) => typeof label === "string" && label.trim() && label.length <= 80));

  directRoute(app, "GET", "/api/comparisons", (account, { query }) => {
    const jobs = typeof query.jobIds === "string" ? new Set(query.jobIds.split(",")) : null;
    const records = options
      .read()
      .filter(
        (record) =>
          record.ownerId === (account?.userId || "") &&
          (!jobs || record.jobIds.some((id) => jobs.has(id))),
      );
    const items = galleryFor(
      account,
      query.members === "1"
        ? {}
        : {
            jobIds: records.flatMap((record) => record.jobIds),
            itemIds: records.flatMap((record) => record.itemIds || []),
          },
    );
    if (!items) return galleryOff;
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
    const record = options
      .read()
      .find((item) => item.id === req.params.id && item.ownerId === owner(req));
    const items = gallery(req, res, idsOf(record));
    if (!items) return;
    return record
      ? res.json(show(record, items))
      : res.status(404).json({ ok: false, error: "That comparison is unavailable." });
  });
  // MCP records its multi-model runs through this one, and Compare Selected the chosen images
  // (`itemIds`, one per job).
  directRoute(app, "POST", "/api/comparisons", (account, { body }) => {
    const strings = (value: unknown) =>
      Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
    const items = galleryFor(account, {
      jobIds: strings(body?.jobIds),
      itemIds: strings(body?.itemIds),
    });
    if (!items) return galleryOff;
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
  // The variants run as one queue set, sharing the first numeric seed (else a random one) unless
  // they carry their own, as a comparison of seeds does; a refused variant cancels the rest.
  async function run(account: RouteAccount, items: GalleryItem[], body: Record<string, any>) {
    const { variants, sessionId, parentJobId, parentItemId, axis, projectId } = body || {};
    if (
      !Array.isArray(variants) ||
      !sized(variants) ||
      variants.some((variant) => !object(variant?.input) || variant.input.kind === "video") ||
      !labelsValid(
        variants.map((variant) => variant.label),
        variants.length,
      )
    )
      return {
        status: 400,
        payload: {
          ok: false,
          error: `Choose ${range} image variants, each with a label and settings.`,
        },
      };
    if (
      (axis !== undefined && !labelsValid([axis], 1)) ||
      (projectId !== undefined && (typeof projectId !== "string" || !projectId))
    )
      return { status: 400, payload: { ok: false, error: "Name the axis and project as text." } };
    const ownerId = account?.userId || "";
    if (
      sessionId !== undefined &&
      (typeof sessionId !== "string" || !store.session(ownerId, sessionId))
    )
      return { status: 404, payload: { ok: false, error: "Session not found." } };
    if (
      parentJobId !== undefined &&
      (typeof parentJobId !== "string" ||
        !store.job(ownerId, parentJobId) ||
        store.job(ownerId, parentJobId)?.sessionId !== sessionId)
    )
      return { status: 404, payload: { ok: false, error: "Source generation not found." } };
    if (
      parentItemId !== undefined &&
      (typeof parentItemId !== "string" || !items.some((item) => item.id === parentItemId))
    )
      return { status: 404, payload: { ok: false, error: "Source image not found." } };
    const own = variants.map((variant) => {
      const requested = String(variant.input.seed ?? "");
      return /^\d+$/.test(requested) ? requested : undefined;
    });
    const shared = own.find(Boolean) ?? String(randomInt(2 ** 32));
    const seeds = own.map((seed) => seed ?? shared);
    const id = randomUUID();
    const session = (sessionId as string | undefined) || store.createSession(ownerId).id;
    const jobIds: string[] = [];
    for (const [index, variant] of variants.entries()) {
      const { clientJobId: _clientJobId, ...input } = variant.input as GenerationInput;
      const resultSet = comparisonSet(id, index, String(variant.label).trim());
      const result = await options.admit(
        { ...input, kind: "image", seed: seeds[index], count: 1, resultSet },
        account ?? undefined,
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
        return { status: result.status, payload: result.payload };
      }
      jobIds.push(String(result.payload.jobId));
    }
    const record: ComparisonRecord = {
      id,
      ownerId,
      createdAt: new Date().toISOString(),
      seed: new Set(seeds).size === 1 ? shared : "",
      jobIds,
      labels: variants.map((variant) => String(variant.label).trim()),
      vote: null,
      ...(axis ? { axis: String(axis).trim() } : {}),
      ...(projectId ? { projectId } : {}),
    };
    save(record);
    return { status: 201, payload: { ...show(record, items), sessionId: session } };
  }
  directRoute(app, "POST", "/api/comparisons/run", async (account, { body }) => {
    const source = body?.parentItemId;
    const items = galleryFor(account, { itemIds: typeof source === "string" ? [source] : [] });
    return items ? run(account, items, body || {}) : galleryOff;
  });
  // Variants of one result: its recorded run and seed, each variant with its own prompt, lettered
  // A, B, C… in the run's session as versions of it.
  directRoute(app, "POST", "/api/comparisons/variants", async (account, { body }) => {
    const items = galleryFor(account, {
      itemIds: typeof body?.itemId === "string" ? [body.itemId] : [],
    });
    if (!items) return galleryOff;
    const { itemId, axis, projectId, variants } = body || {};
    const ownerId = account?.userId || "";
    const source = items.find((item) => item.id === itemId && item.status === "done");
    const job = source?.jobId ? store.job(ownerId, source.jobId) : undefined;
    if (!source || !job || job.input.kind === "video")
      return { status: 404, payload: { ok: false, error: "That image is unavailable." } };
    if (
      !Array.isArray(variants) ||
      variants.some((variant) => typeof variant?.prompt !== "string" || !variant.prompt.trim())
    )
      return { status: 400, payload: { ok: false, error: "Give each variant a prompt." } };
    const {
      clientJobId: _id,
      writing: _writing,
      assistant: _assistant,
      resultSet: _set,
      ...input
    } = job.input;
    const seed = (source.settings as GenerationInput | undefined)?.seed ?? input.seed;
    return run(account, items, {
      variants: variants.map((variant, index) => ({
        label: [letter(index), String(variant.label || "").trim()].filter(Boolean).join(" · "),
        input: { ...input, prompt: variant.prompt.trim(), seed },
      })),
      sessionId: job.sessionId,
      parentJobId: job.id,
      parentItemId: source.id,
      axis,
      projectId,
    });
  });
  directRoute(app, "PUT", "/api/comparisons/:id/vote", (account, { params, body }) => {
    const records = options.read();
    const record = records.find(
      (item) => item.id === params.id && item.ownerId === (account?.userId || ""),
    );
    const items = galleryFor(account, idsOf(record));
    if (!items) return galleryOff;
    if (!record)
      return { status: 404, payload: { ok: false, error: "That comparison is unavailable." } };
    const { itemId, jobId, by } = body || {};
    const clear = itemId === null || (itemId === undefined && jobId === null);
    const variants = record.jobIds.map((_, index) => recordItem(record, items, index));
    const winner = clear
      ? undefined
      : variants.find((item) =>
          itemId !== undefined ? item?.id === itemId : item?.jobId === jobId,
        );
    if (!clear && (!winner || winner.status !== "done"))
      return {
        status: 400,
        payload: { ok: false, error: "Choose a finished, available variant." },
      };
    record.vote = winner?.jobId || null;
    if (winner) record.winnerItemId = winner.id;
    else delete record.winnerItemId;
    record.votedAt = new Date().toISOString();
    options.write(records);
    let brief = null;
    if (winner) {
      const others = variants.filter((item): item is GalleryItem =>
        Boolean(item && item.id !== winner.id && item.status === "done"),
      );
      options.voted?.(record.ownerId, winner, others);
      // The letter variants of a result lead with stays out of the brief.
      const label = record.labels?.[variants.indexOf(winner)]?.replace(/^[A-J] · /, "");
      if (record.axis && record.projectId && label)
        brief = options.picked?.(record, label, by === "chat" ? "chat" : "studio") ?? null;
    }
    return { status: 200, payload: { ...show(record, items), ...(brief ? { brief } : {}) } };
  });
}
