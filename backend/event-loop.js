import { AsyncLocalStorage } from "node:async_hooks";
import { Session } from "node:inspector/promises";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import { logWarning } from "./crash-log.js";

/**
 * Logs one line when the event loop stalls, naming the work active meanwhile: requests, MCP tools
 * and background ticks that ran during the stall or are still running. Synchronous work finishes
 * within the stall it causes, so work that ended since the previous check counts too.
 */
const active = new Set();
let windowStart = performance.now();

/** Marks work as active until the returned function is called; `label` may be a function. */
export function track(label) {
  const entry = { label, at: performance.now(), end: 0 };
  active.add(entry);
  return () => {
    entry.end = performance.now();
  };
}

/** Tracks a promise-returning call for as long as it runs. */
export function tracked(label, run) {
  const done = track(label);
  try {
    return Promise.resolve(run()).finally(done);
  } catch (error) {
    done();
    throw error;
  }
}

/** A request's method and path with ids and file names left out, so logs name only the route. */
export const routeLabel = (method, url) =>
  `${method} ${url
    .split("?")[0]
    .split("/")
    .slice(0, 5)
    .map((part) => (/[\d.]/.test(part) ? ":id" : part))
    .join("/")}`;

const name = (entry) => (typeof entry.label === "function" ? entry.label() : entry.label);

export function watchEventLoop({ intervalMs = 100, thresholdMs = 200 } = {}) {
  setInterval(() => {
    const now = performance.now();
    const stall = now - windowStart - intervalMs;
    if (stall > thresholdMs) {
      const work = [...active]
        .sort((a, b) => b.at - a.at)
        .slice(0, 12)
        .map(
          (entry) =>
            `${name(entry)} (${entry.end ? "ended" : "running"}, started ${Math.round(now - entry.at)} ms ago)`,
        );
      logWarning("Event loop stalled", { ms: Math.round(stall), work });
    }
    for (const entry of active) if (entry.end) active.delete(entry);
    windowStart = now;
  }, intervalMs).unref();
}

/**
 * Samples the CPU a minute at a time and logs each run of busy samples over `thresholdMs` with the
 * Studio functions it spent its time in, innermost first.
 */
export async function profileStalls({ windowMs = 60_000, thresholdMs = 200 } = {}) {
  const session = new Session();
  session.connect();
  await session.post("Profiler.enable");
  await session.post("Profiler.setSamplingInterval", { interval: 5000 });
  for (;;) {
    await session.post("Profiler.start");
    await delay(windowMs, undefined, { ref: false });
    const { profile } = await session.post("Profiler.stop");
    for (const stall of busyRuns(profile, thresholdMs)) logWarning("Stall profile", stall);
  }
}

function busyRuns({ nodes, samples, timeDeltas }, thresholdMs) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parent = new Map();
  for (const node of nodes) for (const child of node.children || []) parent.set(child, node.id);
  const studio = (frame) => frame.url.includes("/backend/") || frame.url.includes("/shared/");
  const label = (frame) =>
    `${frame.functionName || "(anonymous)"} ${frame.url.replace(/^.*\/(backend|shared)\//, "$1/")}:${frame.lineNumber + 1}`;
  /** The innermost three Studio frames of a sample's stack. */
  const stack = (id) => {
    const frames = [];
    for (let at = id; at !== undefined && frames.length < 3; at = parent.get(at)) {
      const frame = byId.get(at).callFrame;
      if (studio(frame)) frames.push(label(frame));
    }
    if (frames.length) return frames.join(" < ");
    // Outside Studio: the nearest frame with a source, such as a package's.
    for (let at = id; at !== undefined; at = parent.get(at)) {
      const frame = byId.get(at).callFrame;
      if (frame.url)
        return `${frame.functionName || "(anonymous)"} ${frame.url.replace(/^.*\/node_modules\//, "")}:${frame.lineNumber + 1}`;
    }
    return byId.get(id).callFrame.functionName || "(native)";
  };
  const runs = [];
  let run = null;
  for (const [index, id] of samples.entries()) {
    const ms = (timeDeltas[index + 1] ?? 0) / 1000;
    if (byId.get(id).callFrame.functionName === "(idle)") {
      if (run && run.ms > thresholdMs) runs.push(run);
      run = null;
      continue;
    }
    run ||= { ms: 0, stacks: new Map() };
    run.ms += ms;
    const key = stack(id);
    run.stacks.set(key, (run.stacks.get(key) || 0) + ms);
  }
  if (run && run.ms > thresholdMs) runs.push(run);
  return runs.map(({ ms, stacks }) => ({
    ms: Math.round(ms),
    top: [...stacks]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([key, spent]) => `${Math.round(spent)} ms ${key}`),
  }));
}

const steps = new AsyncLocalStorage();

/** Runs `run`, collecting the time each `step` within it takes into `record` (ms by label). */
export const timeSteps = (record, run) => steps.run(record, run);

/** Adds the time `run` takes to the enclosing timeSteps record under `label`. */
export async function step(label, run) {
  const record = steps.getStore();
  if (!record) return run();
  const started = performance.now();
  try {
    return await run();
  } finally {
    record[label] = (record[label] || 0) + Math.round(performance.now() - started);
  }
}
