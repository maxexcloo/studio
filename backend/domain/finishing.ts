import type { FinishingSettings, FinishingStatus, UpscaleQuality } from "../../shared/upscale.ts";
import { readRuntimeDocument, writeRuntimeDocument } from "../persistence/runtime.ts";
import type { DomainResponse } from "./admission.ts";
import { queuePriority, type OwnedJob, type RewriteStore } from "./store.ts";

export interface FinishingItem {
  id?: string;
  type?: string;
  status?: string;
  prompt?: string;
  favorite?: boolean;
  library?: unknown;
  upscale?: { status?: string; url?: string };
}
/** Whether smart upscale can run now, and with face detail. */
type FinishingReadiness = { reason: string } | { reason?: undefined; faceDetail: boolean };
interface FinishingRecord {
  settings: FinishingSettings;
  /** Starred item IDs waiting to be finished, oldest first. */
  waiting: string[];
}
interface Request {
  body?: Record<string, unknown>;
  studioAccount?: { userId?: string };
}
interface Response {
  status(code: number): Response;
  json(value: unknown): unknown;
}
type Handler = (req: Request, res: Response) => unknown;
interface Router {
  get(path: string, handler: Handler): unknown;
  put(path: string, handler: Handler): unknown;
}

const defaultFinishingSettings: FinishingSettings = {
  enabled: false,
  quality: "balanced",
  faceDetail: true,
};
const qualities: UpscaleQuality[] = ["fast", "balanced", "high"];
const tickMs = 30_000;
const waiting = (job: OwnedJob) => ["queued", "waiting"].includes(job.status);
const finishingJob = (job: OwnedJob) => job.priority === queuePriority.finishing;

/**
 * Finish Starred Images: an image an account stars is queued for smart upscale while Studio is idle,
 * by the captioner's rule (no live job, Dream's included, and no text work). One runs at a time,
 * at the lowest queue tier, on the upscale worker only; a waiting one is cancelled and requeued the
 * moment other work arrives, and a started one finishes. Settings and the waiting list live per
 * account in the runtime document store as `finishing:<ownerId>`.
 */
export function createFinishing(options: {
  dataDir: string;
  store: RewriteStore;
  owners(): string[];
  /** Whether the account may upscale its gallery images. */
  allowed(ownerId: string): boolean;
  item(ownerId: string, itemId: string): FinishingItem | undefined;
  idle(): boolean;
  ready(quality: UpscaleQuality): Promise<FinishingReadiness>;
  /** Whether the prompt shows a person small in frame, so face detail helps. */
  fullBody(prompt: string): boolean;
  upscale(
    ownerId: string,
    request: { galleryItemId: string; quality: UpscaleQuality; faceDetail: boolean },
  ): Promise<DomainResponse>;
  cancel(ownerId: string, jobId: string): Promise<unknown>;
  log?: { info(message: string): void };
}) {
  const { store, log = console } = options;
  const name = (ownerId: string) => `finishing:${ownerId}`;
  function read(ownerId: string): FinishingRecord {
    try {
      const saved = readRuntimeDocument(options.dataDir, name(ownerId)) as Partial<FinishingRecord>;
      return {
        waiting: saved.waiting || [],
        settings: { ...defaultFinishingSettings, ...saved.settings },
      };
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT")
        return { settings: { ...defaultFinishingSettings }, waiting: [] };
      throw error;
    }
  }
  const write = (ownerId: string, record: FinishingRecord) =>
    writeRuntimeDocument(options.dataDir, name(ownerId), record);
  /** A finished, starred, owned image with no upscale, made or on its way. */
  const finishable = (item?: FinishingItem) =>
    Boolean(
      item &&
      item.type === "image" &&
      item.status === "done" &&
      item.favorite &&
      !item.library &&
      !item.upscale?.url &&
      !["queued", "running"].includes(item.upscale?.status || ""),
    );
  const pending = (ownerId: string, record = read(ownerId)) =>
    record.waiting.filter((id) => finishable(options.item(ownerId, id)));
  const live = () => store.jobs().filter((job) => finishingJob(job) && waiting(job));

  let noted = "";
  function note(reason: string) {
    if (reason && reason !== noted) log.info(`[Studio] Finish Starred Images waits: ${reason}`);
    noted = reason;
  }
  let ticking = false;
  let next = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  async function tick() {
    if (ticking || !options.idle()) return;
    ticking = true;
    try {
      const owners = options.owners();
      // Accounts take turns: the search starts after the one served last.
      for (let step = 0; step < owners.length; step++) {
        const index = (next + step) % owners.length;
        const ownerId = owners[index];
        const record = read(ownerId);
        if (!record.settings.enabled || !options.allowed(ownerId)) continue;
        const ids = pending(ownerId, record);
        if (ids.length !== record.waiting.length) write(ownerId, { ...record, waiting: ids });
        if (!ids.length) continue;
        const readiness = await options.ready(record.settings.quality);
        if (readiness.reason !== undefined) return note(readiness.reason);
        note("");
        // Checking readiness takes a moment: anything that arrived meanwhile goes first.
        if (!options.idle()) return;
        const [itemId] = ids;
        const latest = read(ownerId);
        if (!latest.settings.enabled || !latest.waiting.includes(itemId)) return;
        write(ownerId, { ...latest, waiting: latest.waiting.filter((id) => id !== itemId) });
        const item = options.item(ownerId, itemId)!;
        const result = await options.upscale(ownerId, {
          galleryItemId: itemId,
          quality: latest.settings.quality,
          faceDetail:
            latest.settings.faceDetail &&
            readiness.faceDetail &&
            options.fullBody(item.prompt || ""),
        });
        if (result.status >= 400)
          log.info(
            `[Studio] Finish Starred Images skips ${itemId}: ${String(result.payload.error || result.status)}`,
          );
        next = index + 1;
        return;
      }
    } finally {
      ticking = false;
    }
  }
  /** Cancels finishing upscales that have not started, for this owner or all, and requeues them. */
  async function stopWaiting(owner?: string, requeue = true) {
    await Promise.all(
      live()
        .filter((job) => owner === undefined || job.ownerId === owner)
        .map(async (job) => {
          await options.cancel(job.ownerId, job.id).catch(() => undefined);
          const record = read(job.ownerId);
          const itemId = String(job.input.galleryItemId || "");
          if (requeue && record.settings.enabled && !record.waiting.includes(itemId))
            write(job.ownerId, { ...record, waiting: [itemId, ...record.waiting] });
        }),
    );
  }

  return {
    read,
    tick,
    start() {
      timer ||= setInterval(() => void tick().catch(() => undefined), tickMs);
      timer.unref();
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
    allowed: (ownerId: string) => options.allowed(ownerId),
    /** How many starred images wait to be finished. */
    waiting: (ownerId: string) => pending(ownerId).length,
    /** Hears every admitted job: other work makes a waiting finishing upscale step aside at once. */
    admitted(job: OwnedJob) {
      if (!finishingJob(job)) void stopWaiting();
    },
    /** Turning it off forgets the waiting list and cancels a finishing upscale that has not started. */
    async save(ownerId: string, patch: Partial<FinishingSettings>) {
      const record = read(ownerId);
      record.settings = { ...record.settings, ...patch };
      if (!record.settings.enabled) record.waiting = [];
      write(ownerId, record);
      if (!record.settings.enabled) await stopWaiting(ownerId, false);
      return record.settings;
    },
    /** Starring adds finishable images to the waiting list; unstarring takes them off it. */
    starred(ownerId: string, itemIds: string[], favorite: boolean) {
      const record = read(ownerId);
      if (!record.settings.enabled || !options.allowed(ownerId)) return;
      const ids = favorite
        ? [
            ...record.waiting,
            ...itemIds.filter(
              (id) => !record.waiting.includes(id) && finishable(options.item(ownerId, id)),
            ),
          ]
        : record.waiting.filter((id) => !itemIds.includes(id));
      write(ownerId, { ...record, waiting: [...new Set(ids)] });
      if (favorite && timer) void tick().catch(() => undefined);
    },
  };
}
export type Finishing = ReturnType<typeof createFinishing>;

/** The caller's own Finish Starred Images settings and how many images wait. */
export function registerFinishingRoutes(app: Router, { finishing }: { finishing: Finishing }) {
  const owner = (req: Request) => req.studioAccount?.userId || "";
  const allowed = (req: Request, res: Response) => {
    if (finishing.allowed(owner(req))) return true;
    res.status(403).json({ ok: false, error: "Upscaling is disabled for this account." });
    return false;
  };
  const show = (ownerId: string): FinishingStatus => ({
    settings: finishing.read(ownerId).settings,
    waiting: finishing.waiting(ownerId),
  });
  app.get("/api/finishing", (req, res) => {
    if (allowed(req, res)) res.json(show(owner(req)));
  });
  app.put("/api/finishing/settings", async (req, res) => {
    if (!allowed(req, res)) return;
    const body = req.body || {};
    const patch: Partial<FinishingSettings> = {};
    for (const key of ["enabled", "faceDetail"] as const) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== "boolean")
        return res.status(400).json({ ok: false, error: `Set ${key} to true or false.` });
      patch[key] = body[key];
    }
    if (body.quality !== undefined) {
      if (!qualities.includes(body.quality as UpscaleQuality))
        return res.status(400).json({ ok: false, error: "Choose fast, balanced or high quality." });
      patch.quality = body.quality as UpscaleQuality;
    }
    await finishing.save(owner(req), patch);
    return res.json(show(owner(req)));
  });
}
