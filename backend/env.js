import os from "node:os";
import path from "node:path";

import { projectRoot } from "./data-root.js";

// The shell wins over .env, which Studio only reads (Settings saves to SQLite,
// deployment-settings.js). STUDIO_ENV_FILE points at another file (tests use one
// of their own). Under `node --test` (NODE_TEST_CONTEXT) the developer's own .env
// is never read: a test would otherwise see their ComfyUI.
const envPath = process.env.STUDIO_ENV_FILE
  ? path.resolve(process.env.STUDIO_ENV_FILE)
  : process.env.NODE_TEST_CONTEXT
    ? path.join(os.tmpdir(), `studio-test-env-${process.pid}`)
    : path.join(projectRoot, ".env");

try {
  process.loadEnvFile(envPath);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
