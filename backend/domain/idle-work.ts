/** A gallery record the idle work reads; the work's own fields are the caller's. */
export interface IdleItem {
  id?: string;
  url?: string;
  type?: string;
  status?: string;
  ownerId?: string;
}
export type IdleTick =
  | "off"
  | "busy"
  | "spaced"
  | "capped"
  | "failing"
  | "unavailable"
  | "none"
  | "done"
  | "yielded"
  | "failed";

/**
 * What a pass redoes: every item, items whose work is missing or from older rules, or only missing
 * ones. The work's `wanted` decides what each means for it.
 */
export type PassScope = "all" | "outdated" | "missing";
export const passScopes: PassScope[] = ["all", "outdated", "missing"];
/** The pass an item is weighed for: its scope, and when it started (for `all`). */
export interface PassTarget {
  scope: PassScope;
  startedAt: string;
}
/** An administrator's pass, saved so a restart resumes or reports it. */
interface IdlePass extends PassTarget {
  state: "running" | "stopped" | "finished";
  endedAt?: string;
  done: number;
  failed: number;
}
/** The saved state: the pass and the idle trickle's count for the day. */
export interface IdleDocument {
  pass?: IdlePass;
  trickle?: { day: string; count: number };
}
export interface IdleStatus {
  state: "ready" | "running" | "waiting" | "stopped" | "finished" | "unavailable";
  /** Whether a pass is under way (also while it waits or is unavailable). */
  active: boolean;
  /** Why the work can't run now; empty when it can. */
  reason: string;
  done: number;
  failed: number;
  remaining: number;
  total: number;
  /** The scope of the latest pass, which `remaining` counts. */
  scope: PassScope;
  /** Items each scope's pass would take now. */
  scopes: Record<PassScope, number>;
  /** Items a minute over the pass's recent ones, 0 until there are two. */
  perMinute: number;
  /** Seconds left at that rate, null while unknown. */
  etaSeconds: number | null;
  startedAt: string;
  endedAt: string;
}

/** Items in flight at once during a pass. */
export const passConcurrency = 2;
export const dailyItems = 500;
const spacingMs = 10_000;
const watchMs = 1_000;
// After this many failures in a row the model, not the item, is at fault: wait, then retry them.
const failureStreak = 3;
const backoffMs = 60_000;
const rateWindow = 20;

/**
 * Text-model work on finished gallery records while Studio is idle (the same signal Dream uses: no
 * live job and no text work), newest first. Outside a pass a trickle takes new items one at a
 * time, at most one every 10 s and `dailyItems` a day (the server's local day). A pass runs flat
 * out, `passConcurrency` at a time, until every item is done or it is stopped; `continuous` work
 * is always in a pass and keeps no saved state. Either yields the moment work appears: the calls
 * are aborted and those items are tried again later. Only for owners `allowed` to use the prompt
 * assistant. An item that fails is skipped until the next start.
 */
export function createIdleWork<Item extends IdleItem>(options: {
  /** For the log, such as "Gallery captions". */
  name: string;
  enabled(): boolean;
  /** Why the work is off, for status while `enabled()` is false. */
  off?: string;
  /** Why the work can't run now ("" when it can), such as a model that can't do it. */
  unavailable(): Promise<string>;
  idle(): boolean;
  allowed(ownerId: string): boolean;
  /** Every gallery record, newest first. */
  items(): Iterable<Item>;
  /** Whether the record shows in the gallery (not hidden, not in Dream's pool, its file present). */
  visible(item: Item): boolean;
  /** Whether the item still needs the work; `all` and the pass's `target` during a pass. */
  wanted(item: Item, all: boolean, target?: PassTarget): boolean;
  /** Does the work for one item and saves it, unless `signal` aborted first; throws with the reason. */
  run(item: Item, signal: AbortSignal): Promise<void>;
  continuous?: boolean;
  load?(): IdleDocument | null;
  persist?(document: IdleDocument): void;
  now?: () => number;
  log?: { info(message: string): void };
}) {
  const { now = Date.now, log = console } = options;
  const key = (item: Item) => item.url || item.id || "";
  const day = (time: number) => new Date(time).toDateString();
  const stamp = () => new Date(now()).toISOString();
  const saved = options.load?.() || {};
  let pass = saved.pass;
  let trickle = saved.trickle || { day: "", count: 0 };
  const persist = () => options.persist?.({ ...(pass && { pass }), trickle });
  const failed = new Set<string>();
  const inflight = new Map<string, AbortController>();
  const pending = new Set<Promise<unknown>>();
  let streak: string[] = [];
  let backoff = { until: -Infinity, reason: "" };
  let last = -Infinity;
  let finishes: number[] = [];
  let noted = "";
  const note = (reason: string) => {
    if (reason !== noted) log.info(`[Studio] ${options.name} skip: ${reason}`);
    noted = reason;
  };
  const running = () => options.continuous || pass?.state === "running";
  const counting = () => !options.continuous && pass?.state === "running";

  const direct = new Set<string>();
  const target = (): PassTarget => ({
    scope: pass?.scope || "outdated",
    startedAt: pass?.startedAt || "",
  });
  /** Items open to the work at all, before `wanted` weighs them. */
  function* open(items: Iterable<Item>) {
    for (const item of items)
      if (item.status === "done" && !failed.has(key(item)) && !direct.has(key(item))) yield item;
  }
  /** Whether the item's owner may have the work done and the item shows in the gallery. */
  function shown() {
    const allowed = new Map<string, boolean>();
    return (item: Item) => {
      const owner = item.ownerId || "";
      if (!allowed.has(owner)) allowed.set(owner, options.allowed(owner));
      return allowed.get(owner)! && options.visible(item);
    };
  }
  function* eligible(all: boolean, items: Iterable<Item> = options.items()) {
    const passing = all ? target() : undefined;
    const visible = shown();
    for (const item of open(items))
      if (options.wanted(item, all, passing) && visible(item)) yield item;
  }
  /** How many items each scope's pass would take, counted in one walk over the gallery. */
  function scopeCounts() {
    const startedAt = running() ? target().startedAt : stamp();
    const counts = { all: 0, outdated: 0, missing: 0 };
    const visible = shown();
    for (const item of open(options.items())) {
      const wanted = passScopes.filter((scope) => options.wanted(item, true, { scope, startedAt }));
      if (wanted.length && visible(item)) for (const scope of wanted) counts[scope] += 1;
    }
    return counts;
  }

  /** Runs `tick` in the background; `settled` waits for every such run. */
  function spawn() {
    const run: Promise<unknown> = tick()
      .catch(() => undefined)
      .finally(() => pending.delete(run));
    pending.add(run);
  }

  async function tick(): Promise<IdleTick> {
    if (!options.enabled()) return "off";
    const all = running();
    if (inflight.size >= (all ? passConcurrency : 1)) return "busy";
    if (!options.idle()) return "busy";
    const time = now();
    if (time < backoff.until) return "failing";
    if (!all) {
      if (time - last < spacingMs) return "spaced";
      if (trickle.day !== day(time)) trickle = { day: day(time), count: 0 };
      if (trickle.count >= dailyItems) return "capped";
    }
    const reason = await options.unavailable();
    if (reason) {
      note(reason);
      return "unavailable";
    }
    // Choosing and claiming happen together, so parallel ticks never take the same item.
    if (!options.idle() || running() !== all) return "busy";
    if (inflight.size >= (all ? passConcurrency : 1)) return "busy";
    let item: Item | null = null;
    for (const candidate of eligible(all))
      if (!inflight.has(key(candidate))) {
        item = candidate;
        break;
      }
    if (!item) {
      if (counting() && !inflight.size) {
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
    const result = await runOne(item, controller, all).finally(() => {
      clearInterval(watch);
      inflight.delete(key(item));
    });
    if (all && running() && (result === "done" || result === "failed")) spawn();
    return result;
  }

  async function runOne(item: Item, controller: AbortController, all: boolean): Promise<IdleTick> {
    try {
      await options.run(item, controller.signal);
      if (controller.signal.aborted) return "yielded";
      streak = [];
      noted = "";
      if (all && counting()) {
        pass!.done += 1;
        finishes = [...finishes, now()].slice(-rateWindow);
      } else if (!all) trickle.count += 1;
      persist();
      return "done";
    } catch (error) {
      if (controller.signal.aborted) return "yielded";
      const reason = (error as Error).message;
      note(reason);
      streak.push(key(item));
      if (streak.length >= failureStreak) {
        // Not these items' fault: give them back and wait before trying again.
        for (const failure of streak) failed.delete(failure);
        if (all && counting()) pass!.failed -= streak.length - 1;
        streak = [];
        backoff = { until: now() + backoffMs, reason };
        persist();
        return "failing";
      }
      failed.add(key(item));
      if (all && counting()) {
        pass!.failed += 1;
        persist();
      }
      return "failed";
    }
  }

  async function unavailable() {
    if (!options.enabled()) return options.off || "";
    const reason = await options.unavailable();
    if (reason) return reason;
    if (now() < backoff.until)
      return `${options.name} keeps failing (${backoff.reason}); retrying shortly.`;
    return "";
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    tick,
    /** Waits for every item started in the background (a pass's parallel and follow-on ones). */
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
    /**
     * Does the work for new results at once, without waiting for Studio to be idle or stepping
     * aside; one that fails is left to the idle work.
     */
    async completed(items: Item[]) {
      if (!options.enabled() || (await options.unavailable())) return;
      for (const item of [...eligible(false, items)]) {
        if (inflight.has(key(item))) continue;
        direct.add(key(item));
        await options
          .run(item, new AbortController().signal)
          .catch((error: Error) => note(error.message))
          .finally(() => direct.delete(key(item)));
      }
    },
    /** Other work was admitted: items in progress step aside at once. */
    interrupt() {
      for (const controller of inflight.values()) controller.abort();
    },
    /** Work through every item the scope takes, flat out while idle, until done or stopped. */
    startPass(scope: PassScope) {
      if (!running()) {
        pass = { state: "running", scope, startedAt: stamp(), done: 0, failed: 0 };
        failed.clear();
        finishes = [];
        backoff = { until: -Infinity, reason: "" };
        persist();
      }
      spawn();
    },
    stopPass() {
      if (!counting()) return;
      pass = { ...pass!, state: "stopped", endedAt: stamp() };
      persist();
      for (const controller of inflight.values()) controller.abort();
    },
    async status(): Promise<IdleStatus> {
      const reason = await unavailable();
      const scopes = scopeCounts();
      const scope = target().scope;
      const remaining = scopes[scope];
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
        active: Boolean(running()),
        reason,
        done,
        failed: failures,
        remaining,
        total: done + failures + remaining,
        scope,
        scopes,
        perMinute: Math.round(perMinute * 10) / 10,
        etaSeconds: perMinute ? Math.round((remaining / perMinute) * 60) : null,
        startedAt: pass?.startedAt || "",
        endedAt: pass?.endedAt || "",
      };
    },
  };
}

interface Request {
  body?: Record<string, unknown>;
}
interface Response {
  status(code: number): Response;
  json(value: unknown): unknown;
}
type Handler = (req: Request, res: Response) => unknown;

/**
 * An administrator's pass in Settings › Maintenance, such as Caption Gallery at
 * `/api/gallery/captions`: its status there, and `/start` (with a `scope`, Out of Date when none)
 * and `/stop`.
 */
export function registerIdlePassRoutes(
  app: {
    get(path: string, handler: Handler): unknown;
    post(path: string, handler: Handler): unknown;
  },
  route: string,
  {
    work,
    requireAdmin,
  }: {
    work: Pick<ReturnType<typeof createIdleWork>, "status" | "startPass" | "stopPass">;
    requireAdmin(req: Request, res: Response): boolean;
  },
) {
  app.get(route, async (req, res) => {
    if (requireAdmin(req, res)) res.json(await work.status());
  });
  app.post(`${route}/start`, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const scope = (req.body?.scope ?? "outdated") as PassScope;
    if (!passScopes.includes(scope))
      return res.status(400).json({ error: `Choose a scope: ${passScopes.join(", ")}.` });
    work.startPass(scope);
    res.json(await work.status());
  });
  app.post(`${route}/stop`, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    work.stopPass();
    res.json(await work.status());
  });
}
