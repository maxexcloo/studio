/**
 * How long generations take on this machine, learned from ComfyUI's own
 * events and kept only for HEISS UI's estimates.
 *
 * A run splits into setup (loading the model, reading the prompt, encoding a
 * reference), sampling (a steady time per step) and a tail (decoding and
 * saving). Per model, a step costs about the same for the same amount of
 * work, where work is megapixels × batch × frames; a step's cost grows a
 * little faster than the pixel count at large sizes, so the exponent is
 * learned from the sizes you actually use. Runs near a size speak for it
 * once there are two (a native 2K draw is measured at 2K, not bent from 1K
 * along the curve), and switching sizes keeps each size's own history.
 * Runs that read images (references, a start image) and runs that decode in
 * tiles are learned apart from those that don't, once there are enough.
 *
 * Estimates stay quiet until they have earned trust: three runs of the model
 * (two for a video, which takes minutes; another file of the same family
 * stands in until this one has its own), sizes not far outside what it has
 * seen, and recent predictions that landed within about 30%.
 */
import { isSampler } from "./progress-phase.js";

// Kept per model, size and whether it reads images, so a week at 2K keeps the 1K runs.
const RUNS_PER_BUCKET = 30;
const RUNS_TOTAL = 600;
const RUNS_PER_FAMILY = 40;
// Runs within this factor of a size speak for it, once there are this many.
const NEAR_SIZE = 1.5;
const NEAR_RUNS = 2;
const MIN_RUNS = 3;
const MIN_VIDEO_RUNS = 2;
const TRUSTED_ERROR = 0.3;
const DEFAULT_EXPONENT = 1.15;
// A model used within this long is most likely still loaded.
const WARM_WINDOW_MS = 30 * 60_000;

/** Which history a run belongs to: its kind and the model or workflow it ran. */
export function timingKey(body = {}) {
  const model = String(body.model || body.profileId || body.workflow || "").trim();
  return model ? `${body.kind === "video" ? "video" : "image"}:${model}` : "";
}

/** The work one step does, in megapixels × batch × frames. */
export function workUnits(body = {}) {
  const pixels = (Number(body.width) || 0) * (Number(body.height) || 0);
  if (!pixels) return 0;
  const count = Math.max(1, Number(body.count) || 1);
  const frames = body.kind === "video" ? Math.max(1, Number(body.frames) || 1) : 1;
  return (pixels / 1e6) * count * frames;
}

/** What else shapes a run's time besides its size: the images it reads, and decoding in tiles. */
export function runVariant(body = {}) {
  // The start image is the first reference when there are references, so it counts once.
  const images = Array.isArray(body.referenceAssets) ? body.referenceAssets.length : Math.max(0, Number(body.refs) || 0);
  return { refs: Math.max(images, body.startImageId ? 1 : 0), tiled: Boolean(body.tiledDecode) };
}

const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * Follows one run through ComfyUI's messages and says how its time split.
 * Timestamps are passed in, so it can be fed recorded messages in tests.
 */
export class RunTimer {
  /** `endNodes`: save nodes whose output ends the generation proper (Smart upscale runs on after them). */
  constructor(graph = {}, { endNodes = [] } = {}) {
    this.graph = graph;
    this.endNodes = new Set(endNodes.map(String));
    this.runAt = null;
    this.endAt = null;
    // One segment per sampler run: its first and latest reported step. A
    // sampler that starts counting again (a second pass) opens a new one.
    this.segments = [];
    this.active = new Map();
  }

  classOf(node) {
    const id = String(node ?? "");
    return this.graph?.[id]?.class_type || this.graph?.[id.split(/[.:]/)[0]]?.class_type || "";
  }

  note(message, now = Date.now()) {
    const data = message?.data || {};
    if (message?.type === "execution_start") this.runAt ??= now;
    if (message?.type === "execution_success" || (message?.type === "executing" && (data.node === null || data.node === undefined) && this.runAt !== null)) this.endAt ??= now;
    if (message?.type === "executed" && this.runAt !== null && this.endNodes.has(String(data.node ?? ""))) this.endAt ??= now;
    if (message?.type !== "progress") return;
    this.runAt ??= now;
    const node = String(data.node ?? "");
    const classType = this.classOf(node);
    // A node the graph does not know (a custom node's inner graph) counts as sampling, like the progress line.
    if (classType && !isSampler(classType)) return;
    const value = Number(data.value) || 0;
    const max = Number(data.max) || 0;
    const segment = this.active.get(node);
    if (!segment || value < segment.lastV) {
      const fresh = { firstT: now, firstV: value, lastT: now, lastV: value, max };
      this.segments.push(fresh);
      this.active.set(node, fresh);
      return;
    }
    segment.lastT = now;
    segment.lastV = value;
    segment.max = max || segment.max;
  }

  /** Time per step so far, once two steps of one sampler have been seen. */
  stepMs() {
    let span = 0;
    let steps = 0;
    for (const segment of this.segments) {
      span += segment.lastT - segment.firstT;
      steps += segment.lastV - segment.firstV;
    }
    return steps > 0 ? span / steps : null;
  }

  /** Steps finished across every sampler so far. */
  stepsDone() {
    return this.segments.reduce((sum, segment) => sum + segment.lastV, 0);
  }

  /** The sampler reporting right now, if any. */
  current() {
    const segments = this.segments;
    return segments.length ? segments.reduce((latest, segment) => (segment.lastT >= latest.lastT ? segment : latest)) : null;
  }

  /** How the finished run split, or null when it never really ran. */
  result() {
    if (this.runAt === null || this.endAt === null || this.endAt <= this.runAt) return null;
    const runMs = this.endAt - this.runAt;
    const segments = this.segments;
    const stepMs = this.stepMs();
    if (!segments.length || !stepMs) return { runMs, stepMs: null, steps: 0, setupMs: null, tailMs: null };
    const first = segments.reduce((a, b) => (b.firstT < a.firstT ? b : a));
    const last = segments.reduce((a, b) => (b.lastT > a.lastT ? b : a));
    const steps = segments.reduce((sum, segment) => sum + (segment.max || segment.lastV), 0);
    // The first report comes after its step finished; that step was sampling, not setup.
    const setupMs = Math.max(0, first.firstT - this.runAt - first.firstV * stepMs);
    const tailMs = Math.max(0, this.endAt - last.lastT - Math.max(0, (last.max || last.lastV) - last.lastV) * stepMs);
    return { runMs, stepMs, steps, setupMs, tailMs };
  }
}

/** Whether a run of `key` now would likely find its model loaded: the last run used it, recently. */
export function isWarm(history = [], key, now = Date.now()) {
  const last = history[history.length - 1];
  return Boolean(last && last.key === key && now - Date.parse(last.at) < WARM_WINDOW_MS);
}

/** How fast a step's cost grows with work, from the sizes this model has run at. */
export function workExponent(runs) {
  const points = runs.filter((run) => run.stepMs > 0 && run.w > 0).map((run) => [Math.log(run.w), Math.log(run.stepMs)]);
  if (points.length < 3) return DEFAULT_EXPONENT;
  const xs = points.map(([x]) => x);
  // Too little spread in size to tell growth from noise.
  if (Math.exp(Math.max(...xs) - Math.min(...xs)) < 1.8) return DEFAULT_EXPONENT;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = points.reduce((a, [, y]) => a + y, 0) / points.length;
  const slope = points.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) / points.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  return Math.min(1.6, Math.max(0.8, slope));
}

/**
 * What a run of `body` should take here: `{ totalMs, setupMs, stepMs, steps,
 * tailMs, trusted }`, or null with too little to go on. `trusted` is false
 * while recent predictions for this model missed by more than about 30%.
 */
export function estimateRun(history = [], body = {}, { now = Date.now(), warm: knownWarm } = {}) {
  const key = timingKey(body);
  const w = workUnits(body);
  if (!key || !w) return null;
  // A video takes minutes, so two runs already say more than nothing; images need three.
  const need = body.kind === "video" ? MIN_VIDEO_RUNS : MIN_RUNS;
  const variant = runVariant(body);
  let runs = history.filter((run) => run.key === key);
  // Too few runs of this file: other files of the same family here (an fp8 and an fp16 build) run alike.
  if (runs.length < need && body.family) {
    const kind = key.slice(0, key.indexOf(":") + 1);
    const family = history.filter((run) => run.fam === body.family && run.key.startsWith(kind)).slice(-RUNS_PER_FAMILY);
    if (family.length >= need) runs = family;
  }
  if (runs.length < need) return null;
  // Reading images costs time (encoding, longer sequences) and a start image samples fewer steps: alike runs speak once there are enough.
  const sameImages = runs.filter((run) => (run.refs || 0) === variant.refs);
  if (sameImages.length >= need) runs = sameImages;
  // Far outside the sizes this model has run at, the curve is a guess.
  const sizes = runs.map((run) => run.w);
  if (w > Math.max(...sizes) * 3 || w < Math.min(...sizes) / 3) return null;

  const warm = knownWarm ?? isWarm(history, key, now);
  const alike = runs.filter((run) => Boolean(run.warm) === warm);
  const setupPool = alike.length >= 2 ? alike : runs;
  // Runs near this size, when there are enough; else all of them, along the curve.
  const near = (pool) => {
    const close = pool.filter((run) => Math.abs(Math.log(run.w / w)) <= Math.log(NEAR_SIZE));
    return close.length >= NEAR_RUNS ? close : pool;
  };
  // Misses at another size say little about this one: a few bad 2K guesses don't silence 1K.
  const errorsOf = (pool) => pool.map((run) => run.error).filter(Number.isFinite).slice(-5);
  const nearErrors = errorsOf(near(runs));
  const errors = nearErrors.length >= 2 ? nearErrors : errorsOf(runs);
  const trusted = errors.length < 2 || median(errors) <= TRUSTED_ERROR;

  const stepped = runs.filter((run) => run.stepMs > 0);
  if (stepped.length >= need) {
    const k = workExponent(stepped);
    const stepMs = median(near(stepped).map((run) => run.stepMs / run.w ** k)) * w ** k;
    // A two-pass workflow samples more steps than the steps setting; keep its ratio.
    const asked = Number(body.steps) || 0;
    const ratio = median(stepped.filter((run) => run.asked > 0).map((run) => run.steps / run.asked));
    const steps = asked ? Math.round(asked * (ratio || 1)) : Math.round(median(stepped.map((run) => run.steps)));
    const setupMs = median(setupPool.map((run) => run.setupMs).filter((ms) => ms !== null && ms !== undefined)) ?? 0;
    // Decoding in tiles (native 2K/4K) costs differently from one whole-frame decode.
    const decoded = stepped.filter((run) => Boolean(run.tiled) === variant.tiled);
    const tailMs = (median(near(decoded.length >= NEAR_RUNS ? decoded : stepped).map((run) => run.tailMs / run.w)) ?? 0) * w;
    const totalMs = setupMs + steps * stepMs + tailMs;
    return { totalMs: Math.round(totalMs), setupMs: Math.round(setupMs), stepMs, steps, tailMs: Math.round(tailMs), trusted, warm };
  }
  // No step reports from this workflow: scale whole runs by work instead.
  const perWork = median(near(setupPool).map((run) => run.runMs / run.w));
  return perWork ? { totalMs: Math.round(perWork * w), setupMs: null, stepMs: null, steps: 0, tailMs: null, trusted, warm } : null;
}

/**
 * The history with one finished run added. `predicted` is what was estimated
 * before it started, so later estimates know how far off they have been.
 */
export function addRun(history = [], { body, result, predicted = null, warm = false, at = new Date().toISOString() }) {
  const key = timingKey(body);
  const w = workUnits(body);
  if (!key || !w || !result?.runMs) return history;
  const run = { key, at, w, asked: Number(body.steps) || 0, warm: Boolean(warm), runMs: Math.round(result.runMs) };
  // The family, so another file of it can borrow these timings until it has its own.
  if (body.family) run.fam = String(body.family);
  const variant = runVariant(body);
  if (variant.refs) run.refs = variant.refs;
  if (variant.tiled) run.tiled = 1;
  if (result.stepMs) Object.assign(run, { stepMs: Math.round(result.stepMs * 10) / 10, steps: result.steps, setupMs: Math.round(result.setupMs), tailMs: Math.round(result.tailMs) });
  if (predicted?.totalMs) run.error = Math.round((Math.abs(result.runMs - predicted.totalMs) / result.runMs) * 100) / 100;
  const next = [...history, run];
  // Keep each model's latest runs at each size (and with or without images), and the whole file small.
  const counts = new Map();
  const kept = [];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const item = next[index];
    const bucket = `${item.key}|${Math.round(Math.log2(item.w))}|${item.refs ? 1 : 0}`;
    const count = counts.get(bucket) || 0;
    if (count >= RUNS_PER_BUCKET || kept.length >= RUNS_TOTAL) continue;
    counts.set(bucket, count + 1);
    kept.push(next[index]);
  }
  return kept.reverse();
}

/**
 * How long is left of a running job, from what it has done so far: live step
 * speed while sampling (trustworthy on its own), the learned estimate before
 * and after. Null when there is nothing honest to say.
 */
export function remainingMs(timer, estimate, now = Date.now()) {
  const usable = estimate?.trusted ? estimate : null;
  if (!timer || timer.runAt === null) return usable ? usable.totalMs : null;
  const current = timer.current();
  const liveStep = timer.stepMs() ?? usable?.stepMs ?? null;
  const tailMs = usable?.tailMs ?? 0;
  if (current && liveStep) {
    const expected = usable?.steps || 0;
    const left = Math.max(expected - timer.stepsDone(), (current.max || 0) - current.lastV, 0);
    if (left > 0) return left * liveStep - Math.min(liveStep, now - current.lastT) + tailMs;
    return Math.max(0, tailMs - (now - current.lastT));
  }
  if (!usable) return null;
  const elapsed = now - timer.runAt;
  const sampling = usable.stepMs ? usable.steps * usable.stepMs + (usable.tailMs || 0) : 0;
  return Math.max(usable.totalMs - elapsed, sampling);
}

/** Steps well slower than this model's usual: the sign of a GPU out of memory, not of loading. */
export function slowSteps(result, estimate) {
  return Boolean(result?.stepMs && estimate?.trusted && estimate.stepMs && result.stepMs > estimate.stepMs * 2.5);
}
