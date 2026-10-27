import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { currentDataDir, projectRoot, readEnvFile } from "./data-root.js";
import { removeJsonFile, writeJsonFile } from "./json-store.js";

/**
 * Why Studio stopped last time, so a studio that "just exited" has a reason
 * on its next start.
 *
 * - The server notes when its run starts and, every minute, that it's alive
 *   (data/logs/session.json).
 * - Whoever sees the stop writes it down (data/logs/last-exit.json): the
 *   server for its own crash or a clean stop, the dev launcher
 *   (dev.mjs) for a child that died, with the last lines it printed.
 *   The first word on a run that went wrong is the one kept: a clean stop
 *   afterwards (the launcher stopping the rest) doesn't paper over it.
 * - No word at all after a run started means it was ended from outside: the
 *   process was killed, or the computer shut down (told apart by the boot
 *   time, and not reported, since that's not something going wrong).
 */

/** The server's exit code when its port is taken: that start never ran, so it leaves the record alone. */
export const PORT_IN_USE_CODE = 78;

/**
 * The data folder, as the server finds it (data-root.js). The launchers don't
 * load .env (the server does), so its values fill in what the shell left unset.
 */
export function exitRecordDataDir(env = process.env, fileValues = null) {
  const shell = Object.fromEntries(Object.entries(env).filter(([, value]) => value));
  const file = fileValues || readEnvFile(path.join(projectRoot, ".env"));
  return currentDataDir({ ...file, ...shell });
}
const logDir = () => path.join(exitRecordDataDir(), "logs");
const sessionFile = () => path.join(logDir(), "session.json");
const exitFile = () => path.join(logDir(), "last-exit.json");

// Plain reads, never the .bak copy: a record removed on purpose must stay gone.
function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function writeSync(file, value) {
  // Synchronous: this runs on the way out, where nothing async finishes.
  try {
    writeJsonFile(file, value);
  } catch {
    /* writing down a stop must never be what fails */
  }
}

/**
 * Writes down a stop. `clean` is a stop someone meant (Ctrl+C, closing the
 * window, the launcher's stop); anything else is reported next start.
 */
export function recordExit({
  who,
  reason,
  code = null,
  signal = null,
  clean = false,
  detail = "",
}) {
  const session = read(sessionFile());
  const existing = read(exitFile());
  const sameRun = existing && session && existing.at >= session.startedAt;
  if (sameRun && !existing.clean) return existing;
  const record = {
    at: Date.now(),
    who,
    reason,
    code,
    signal,
    clean,
    ...(detail ? { detail: String(detail).slice(-4000) } : {}),
  };
  writeSync(exitFile(), record);
  return record;
}

/** The server's run begins: returns how the last one ended when that's worth saying, and starts a new record. */
export function startSession({
  pid = process.pid,
  now = Date.now(),
  bootedAt = now - os.uptime() * 1000,
} = {}) {
  const previous = read(sessionFile());
  const exit = read(exitFile());
  // Read once: this run's stop is written afresh, so last run's can't pass for it.
  try {
    removeJsonFile(exitFile());
  } catch {
    /* nothing to clear */
  }
  writeSync(sessionFile(), { pid, startedAt: now, lastSeen: now });
  if (!previous) return null;
  const lastSeen = previous.lastSeen || previous.startedAt;
  if (exit && exit.at >= previous.startedAt) return exit.clean ? null : { ...exit, lastSeen };
  // Nothing written since it started. A computer that booted since was shut down or restarted with it running.
  if (bootedAt > lastSeen) return null;
  return {
    at: lastSeen,
    who: "unknown",
    reason:
      "Studio was ended from outside, without a crash of its own: the process was closed, or the window it ran in.",
    code: null,
    signal: null,
    clean: false,
    lastSeen,
  };
}

/** Once a minute while running, so an unexplained stop can say when Studio was last alive. */
export function noteAlive(now = Date.now()) {
  const session = read(sessionFile());
  if (session && session.pid === process.pid)
    writeSync(sessionFile(), { ...session, lastSeen: now });
}
