import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvFile } from "./lan.js";

/**
 * Why HEISS UI stopped last time, so a studio that "just exited" has a reason
 * on its next start (and in a toast, /api/health previousExit).
 *
 * - The server notes when its run starts and, every minute, that it's alive
 *   (data/logs/session.json).
 * - Whoever sees the stop writes it down (data/logs/last-exit.json): the
 *   server for its own crash or a clean stop, the launcher (scripts/dev.mjs,
 *   scripts/start.mjs) for a child that died, with the last lines it printed.
 *   The first word on a run that went wrong is the one kept: a clean stop
 *   afterwards (the launcher stopping the rest) doesn't paper over it.
 * - No word at all after a run started means it was ended from outside: the
 *   process was killed, or the computer shut down (told apart by the boot
 *   time, and not reported, since that's not something going wrong).
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function dataDir() {
  // The launchers don't load .env (the server does), so its data folder is read from it here.
  const configured = process.env.HEISS_DATA_DIR || process.env.JAI_DATA_DIR || (() => {
    try { const values = readEnvFile(root).values; return values.HEISS_DATA_DIR || values.JAI_DATA_DIR || ""; } catch { return ""; }
  })();
  return configured ? path.resolve(configured) : path.join(root, "data");
}
const logDir = () => path.join(dataDir(), "logs");
const sessionFile = () => path.join(logDir(), "session.json");
const exitFile = () => path.join(logDir(), "last-exit.json");

function read(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function writeSync(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Synchronous: this runs on the way out, where nothing async finishes.
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  } catch { /* writing down a stop must never be what fails */ }
}

/**
 * Writes down a stop. `clean` is a stop someone meant (Ctrl+C, closing the
 * window, Restart, the launcher's stop); anything else is reported next start.
 */
export function recordExit({ who, reason, code = null, signal = null, clean = false, detail = "" }) {
  const session = read(sessionFile());
  const existing = read(exitFile());
  const sameRun = existing && session && existing.at >= session.startedAt;
  if (sameRun && !existing.clean) return existing;
  const record = { at: Date.now(), who, reason, code, signal, clean, ...(detail ? { detail: String(detail).slice(-4000) } : {}) };
  writeSync(exitFile(), record);
  return record;
}

/** The server's run begins: returns how the last one ended when that's worth saying, and starts a new record. */
export function startSession({ pid = process.pid, now = Date.now(), bootedAt = now - os.uptime() * 1000 } = {}) {
  const previous = read(sessionFile());
  const exit = read(exitFile());
  // Read once: this run's stop is written afresh, so last run's can't pass for it.
  try { fs.rmSync(exitFile(), { force: true }); } catch { /* nothing to clear */ }
  writeSync(sessionFile(), { pid, startedAt: now, lastSeen: now });
  if (!previous) return null;
  const lastSeen = previous.lastSeen || previous.startedAt;
  if (exit && exit.at >= previous.startedAt) return exit.clean ? null : { ...exit, lastSeen };
  // Nothing written since it started. A computer that booted since was shut down or restarted with it running.
  if (bootedAt > lastSeen) return null;
  return {
    at: lastSeen,
    who: "unknown",
    reason: "HEISS UI was ended from outside, without a crash of its own: the process was closed, or the window it ran in.",
    code: null,
    signal: null,
    clean: false,
    lastSeen
  };
}

/** Once a minute while running, so an unexplained stop can say when HEISS was last alive. */
export function noteAlive(now = Date.now()) {
  const session = read(sessionFile());
  if (session && session.pid === process.pid) writeSync(sessionFile(), { ...session, lastSeen: now });
}

/** The last lines a child printed to stderr, kept so its stop can say why. */
export function tailKeeper(limit = 30) {
  const lines = [];
  let partial = "";
  return {
    push(chunk) {
      const text = partial + String(chunk);
      const parts = text.split(/\r?\n/);
      partial = parts.pop() || "";
      for (const line of parts) {
        // Colour codes out: the record is read as plain text.
        const plain = line.replace(/\u001b\[[0-9;]*m/g, "").trimEnd();
        if (plain) lines.push(plain);
      }
      while (lines.length > limit) lines.shift();
    },
    text() { return [...lines, partial].filter(Boolean).join("\n"); }
  };
}
