import os from "node:os";
import path from "node:path";
import { projectRoot, readEnvFile } from "./data-root.js";

// Keep local setup plug-and-play without adding a runtime dependency. Explicit
// shell environment variables always win over values in .env, which Studio only
// reads (Settings saves to SQLite, deployment-settings.js).
// STUDIO_ENV_FILE points at another file (tests use one of their own). Under
// `node --test` (NODE_TEST_CONTEXT) the developer's own .env is never read: a
// test would otherwise see their ComfyUI.
const envPath = process.env.STUDIO_ENV_FILE
  ? path.resolve(process.env.STUDIO_ENV_FILE)
  : process.env.NODE_TEST_CONTEXT
    ? path.join(os.tmpdir(), `studio-test-env-${process.pid}`)
    : path.join(projectRoot, ".env");

/** Keys that came from .env rather than the shell. */
export const envFileKeys = new Set();

for (const [key, value] of Object.entries(readEnvFile(envPath))) {
  if (key in process.env) continue;
  process.env[key] = value;
  envFileKeys.add(key);
}
