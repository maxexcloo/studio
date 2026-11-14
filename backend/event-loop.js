import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

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
