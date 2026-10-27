import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectRoot, readEnvFile } from "./data-root.js";

// Keep local setup plug-and-play without adding a runtime dependency. Explicit
// shell environment variables always win over values in .env.
// STUDIO_ENV_FILE points at another file (tests use one of their own). Under
// `node --test` (NODE_TEST_CONTEXT) the developer's own .env is never read or
// written: a test would otherwise see their ComfyUI, or save over their settings.
const envPath = process.env.STUDIO_ENV_FILE
  ? path.resolve(process.env.STUDIO_ENV_FILE)
  : process.env.NODE_TEST_CONTEXT
    ? path.join(os.tmpdir(), `studio-test-env-${process.pid}`)
    : path.join(projectRoot, ".env");

/** Keys that came from .env rather than the shell, so a setting knows it may rewrite them. */
export const envFileKeys = new Set();

for (const [key, value] of Object.entries(readEnvFile(envPath))) {
  if (key in process.env) continue;
  process.env[key] = value;
  envFileKeys.add(key);
}

function keyMatcher(key) {
  return new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
}

function writeLines(lines) {
  fs.writeFileSync(
    envPath,
    `${lines.filter((line, index, all) => line || index < all.length - 1).join("\n")}\n`,
    { mode: 0o600 },
  );
}

function readLines() {
  try {
    return fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  } catch {
    return null;
  }
}

function checkedKey(key) {
  const safeKey = String(key || "").trim();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(safeKey)) throw new Error("Invalid local setting.");
  return safeKey;
}

/**
 * Takes a setting out of .env altogether. What the process has is left alone
 * unless it came from .env, so a value set in the shell still applies.
 */
export function removeLocalEnvValue(key) {
  const safeKey = checkedKey(key);
  const lines = readLines();
  if (!lines) return false;
  const matcher = keyMatcher(safeKey);
  const kept = lines.filter((line) => !matcher.test(line));
  if (kept.length !== lines.length) writeLines(kept);
  if (envFileKeys.has(safeKey)) {
    delete process.env[safeKey];
    envFileKeys.delete(safeKey);
  }
  return kept.length !== lines.length;
}

export function writeLocalEnvValue(key, value) {
  const safeKey = checkedKey(key);
  const safeValue = String(value || "").trim();
  if (/[\r\n]/.test(safeValue)) throw new Error("Invalid local setting.");
  const matcher = keyMatcher(safeKey);
  let replaced = false;
  const lines = (readLines() || []).map((line) => {
    if (!matcher.test(line)) return line;
    replaced = true;
    return `${safeKey}=${safeValue}`;
  });
  if (!replaced) lines.push(`${safeKey}=${safeValue}`);
  writeLines(lines);
  // Saved here, it now comes from .env, unless the environment set it first (that still wins at the next start).
  const fromEnvironment = safeKey in process.env && !envFileKeys.has(safeKey);
  process.env[safeKey] = safeValue;
  if (!fromEnvironment) envFileKeys.add(safeKey);
}
