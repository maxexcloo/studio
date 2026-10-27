/** What a finished gallery image shows, in the assistant model's words, so search can find it. */
export interface Caption {
  text: string;
  tags: string[];
  model: string;
  at: string;
  /** The caption format; a pass redoes captions from an older one. */
  version: number;
}
export interface CaptionItem {
  id?: string;
  url?: string;
  type?: string;
  status?: string;
  ownerId?: string;
  library?: unknown;
  caption?: Partial<Caption>;
}
interface CaptionImage {
  mime: string;
  data: string;
}
/** The assistant gateway (assistant.js). */
export interface CaptionWriter {
  /** Whether the running text model reads images. */
  supportsVision(): Promise<boolean>;
  caption(request: {
    image: CaptionImage;
    signal?: AbortSignal;
  }): Promise<{ text: string; tags: string[]; model: string }>;
}
type CaptionTick =
  | "off"
  | "busy"
  | "spaced"
  | "capped"
  | "failing"
  | "text-only"
  | "none"
  | "captioned"
  | "yielded"
  | "failed";

/** An administrator's Caption Gallery pass, saved so a restart resumes or reports it. */
interface CaptionPass {
  state: "running" | "stopped" | "finished";
  startedAt: string;
  endedAt?: string;
  done: number;
  failed: number;
}
/** The saved captioner state: the pass and the idle trickle's count for the day. */
export interface CaptionDocument {
  pass?: CaptionPass;
  trickle?: { day: string; count: number };
}
export interface CaptionStatus {
  state: "ready" | "running" | "waiting" | "stopped" | "finished" | "unavailable";
  /** Whether a pass is under way (also while it waits or is unavailable). */
  active: boolean;
  /** Why captions can't run now; empty when they can. */
  reason: string;
  done: number;
  failed: number;
  remaining: number;
  total: number;
  /** Captions a minute over the pass's recent captions, 0 until there are two. */
  perMinute: number;
  /** Seconds left at that rate, null while unknown. */
  etaSeconds: number | null;
  startedAt: string;
  endedAt: string;
}

export const captionVersion = 2;
/** Captions in flight at once during a pass. */
export const passConcurrency = 2;
export const dailyCaptions = 500;
const spacingMs = 10_000;
const watchMs = 1_000;
// After this many failures in a row the model, not the image, is at fault: wait, then retry them.
const failureStreak = 3;
const backoffMs = 60_000;
const rateWindow = 20;

/**
 * Captions finished gallery images while Studio is idle (the same signal Dream uses: no live job
 * and no text work), newest first. Outside a pass a trickle captions new images one at a time, at
 * most one every 10 s and `dailyCaptions` a day (the server's local day). An administrator's pass
 * runs flat out, `passConcurrency` at a time, until every image has a current-format caption or it
 * is stopped. Either yields the moment work appears: the calls are aborted and those images are
 * tried again later. Only while the running text model reads images, never with cloud, and only for owners
 * `allowed` to use the prompt assistant. An image that fails is skipped until the next start.
 */
export function createCaptioner(options: {
  /** The Settings › Models switch (STUDIO_GALLERY_CAPTIONS). */
  enabled(): boolean;
  writer: CaptionWriter | null;
  idle(): boolean;
  allowed(ownerId: string): boolean;
  /** Every gallery record, newest first. */
  items(): Iterable<CaptionItem>;
  /** Whether the record shows in the gallery (not hidden, not in Dream's pool, its file present). */
  visible(item: CaptionItem): boolean;
  /** A small (≤512 px) copy of the image, or null when there is none. */
  image(item: CaptionItem): Promise<CaptionImage | null>;
  save(item: CaptionItem, caption: Caption): void;
  load(): CaptionDocument | null;
  persist(document: CaptionDocument): void;
  now?: () => number;
  log?: { info(message: string): void };
}) {
  const { writer, now = Date.now, log = console } = options;
  const key = (item: CaptionItem) => item.url || item.id || "";
  const day = (time: number) => new Date(time).toDateString();
  const stamp = () => new Date(now()).toISOString();
  const saved = options.load() || {};
  let pass = saved.pass;
  let trickle = saved.trickle || { day: "", count: 0 };
  const persist = () => options.persist({ ...(pass && { pass }), trickle });
  const failed = new Set<string>();
  const inflight = new Map<string, AbortController>();
  const pending = new Set<Promise<unknown>>();
  let streak: string[] = [];
  let backoff = { until: -Infinity, reason: "" };
  let last = -Infinity;
  let finishes: number[] = [];
  let noted = "";
  const note = (reason: string) => {
    if (reason !== noted) log.info(`[Studio] Gallery captions skip: ${reason}`);
    noted = reason;
  };
  const running = () => pass?.state === "running";
  // The trickle captions new images; a pass also redoes captions from an older format.
  const wanted = (item: CaptionItem, all: boolean) =>
    item.type === "image" &&
    item.status === "done" &&
    !item.library &&
    (all ? item.caption?.version !== captionVersion : !item.caption) &&
    !failed.has(key(item));

  function* eligible(all: boolean) {
    const allowed = new Map<string, boolean>();
    for (const item of options.items()) {
      if (!wanted(item, all)) continue;
      const owner = item.ownerId || "";
      if (!allowed.has(owner)) allowed.set(owner, options.allowed(owner));
      if (allowed.get(owner) && options.visible(item)) yield item;
    }
  }

  /** Runs `tick` in the background; `settled` waits for every such run. */
  function spawn() {
    const run: Promise<unknown> = tick()
      .catch(() => undefined)
      .finally(() => pending.delete(run));
    pending.add(run);
  }

  async function tick(): Promise<CaptionTick> {
    if (!options.enabled() || !writer) return "off";
    const all = running();
    if (inflight.size >= (all ? passConcurrency : 1)) return "busy";
    if (!options.idle()) return "busy";
    const time = now();
    if (time < backoff.until) return "failing";
    if (!all) {
      if (time - last < spacingMs) return "spaced";
      if (trickle.day !== day(time)) trickle = { day: day(time), count: 0 };
      if (trickle.count >= dailyCaptions) return "capped";
    }
    if (!(await writer.supportsVision())) {
      note("the running text model can't read images.");
      return "text-only";
    }
    // Choosing and claiming happen together, so parallel ticks never take the same image.
    if (!options.idle() || running() !== all) return "busy";
    if (inflight.size >= (all ? passConcurrency : 1)) return "busy";
    let item: CaptionItem | null = null;
    for (const candidate of eligible(all))
      if (!inflight.has(key(candidate))) {
        item = candidate;
        break;
      }
    if (!item) {
      if (all && !inflight.size) {
        pass = { ...pass!, state: "finished", endedAt: stamp() };
        persist();
      }
      return "none";
    }
    if (!all) last = time;
    const controller = new AbortController();
    inflight.set(key(item), controller);
    if (all && inflight.size < passConcurrency) spawn();
    const watch = setInterval(() => {
      if (!options.idle()) controller.abort();
    }, watchMs);
    watch.unref?.();
    const result = await captionOne(item, controller, all).finally(() => {
      clearInterval(watch);
      inflight.delete(key(item));
    });
    if (all && running() && (result === "captioned" || result === "failed")) spawn();
    return result;
  }

  async function captionOne(
    item: CaptionItem,
    controller: AbortController,
    all: boolean,
  ): Promise<CaptionTick> {
    try {
      const image = await options.image(item);
      if (controller.signal.aborted) return "yielded";
      if (!image) throw new Error("no image to read");
      const reply = await writer!.caption({ image, signal: controller.signal });
      if (controller.signal.aborted) return "yielded";
      options.save(item, {
        text: reply.text,
        tags: reply.tags,
        model: reply.model,
        at: stamp(),
        version: captionVersion,
      });
      streak = [];
      noted = "";
      if (all && running()) {
        pass!.done += 1;
        finishes = [...finishes, now()].slice(-rateWindow);
      } else if (!all) trickle.count += 1;
      persist();
      return "captioned";
    } catch (error) {
      if (controller.signal.aborted) return "yielded";
      const reason = (error as Error).message;
      note(reason);
      streak.push(key(item));
      if (streak.length >= failureStreak) {
        // Not these images' fault: give them back and wait before trying again.
        for (const failure of streak) failed.delete(failure);
        if (all && running()) pass!.failed -= streak.length - 1;
        streak = [];
        backoff = { until: now() + backoffMs, reason };
        persist();
        return "failing";
      }
      failed.add(key(item));
      if (all && running()) {
        pass!.failed += 1;
        persist();
      }
      return "failed";
    }
  }

  async function unavailable() {
    if (!options.enabled()) return "Gallery Captions is off in Settings › Models.";
    if (!writer) return "No assistant model is configured.";
    if (!(await writer.supportsVision())) return "The running text model can't read images.";
    if (now() < backoff.until)
      return `The assistant model is failing (${backoff.reason}); retrying shortly.`;
    return "";
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    tick,
    /** Waits for every caption started in the background (a pass's parallel and follow-on ones). */
    async settled() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
    start() {
      timer ||= setInterval(() => void tick().catch(() => undefined), spacingMs / 2);
      timer.unref();
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
    /** Other work was admitted: captions in progress step aside at once. */
    interrupt() {
      for (const controller of inflight.values()) controller.abort();
    },
    /** Caption Gallery: caption every eligible image, flat out while idle, until done or stopped. */
    startPass() {
      if (!running()) {
        pass = { state: "running", startedAt: stamp(), done: 0, failed: 0 };
        failed.clear();
        finishes = [];
        backoff = { until: -Infinity, reason: "" };
        persist();
      }
      spawn();
    },
    stopPass() {
      if (!running()) return;
      pass = { ...pass!, state: "stopped", endedAt: stamp() };
      persist();
      for (const controller of inflight.values()) controller.abort();
    },
    async status(): Promise<CaptionStatus> {
      const reason = await unavailable();
      const remaining = [...eligible(true)].length;
      const done = pass?.done || 0;
      const failures = pass?.failed || 0;
      const span = finishes.length > 1 ? finishes.at(-1)! - finishes[0] : 0;
      const perMinute = running() && span ? ((finishes.length - 1) * 60_000) / span : 0;
      const state = running()
        ? reason
          ? "unavailable"
          : options.idle() || inflight.size
            ? "running"
            : "waiting"
        : reason
          ? "unavailable"
          : pass?.state || "ready";
      return {
        state,
        active: running(),
        reason,
        done,
        failed: failures,
        remaining,
        total: done + failures + remaining,
        perMinute: Math.round(perMinute * 10) / 10,
        etaSeconds: perMinute ? Math.round((remaining / perMinute) * 60) : null,
        startedAt: pass?.startedAt || "",
        endedAt: pass?.endedAt || "",
      };
    },
  };
}
type Captioner = ReturnType<typeof createCaptioner>;

interface Request {
  body?: Record<string, unknown>;
}
interface Response {
  json(value: unknown): unknown;
}
type Handler = (req: Request, res: Response) => unknown;

/** Settings › Maintenance › Caption Gallery, for administrators. */
export function registerCaptionRoutes(
  app: {
    get(path: string, handler: Handler): unknown;
    post(path: string, handler: Handler): unknown;
  },
  {
    captioner,
    requireAdmin,
  }: { captioner: Captioner; requireAdmin(req: Request, res: Response): boolean },
) {
  app.get("/api/gallery/captions", async (req, res) => {
    if (requireAdmin(req, res)) res.json(await captioner.status());
  });
  app.post("/api/gallery/captions/start", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    captioner.startPass();
    res.json(await captioner.status());
  });
  app.post("/api/gallery/captions/stop", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    captioner.stopPass();
    res.json(await captioner.status());
  });
}
