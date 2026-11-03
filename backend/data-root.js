import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

/**
 * Where Studio runs from and keeps its state, with no side effects. The server
 * imports it through data-dir.js, which loads .env first (env.js).
 */

/** The checkout or image folder Studio runs from. */
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Where Studio keeps its own state: STUDIO_DATA_DIR, else data/ in the project. Read again on each call. */
export function currentDataDir(env = process.env) {
  return env.STUDIO_DATA_DIR ? path.resolve(env.STUDIO_DATA_DIR) : path.join(projectRoot, "data");
}

/** A .env file's values as they are on disk, without loading them. {} when there is none. */
export function readEnvFile(file) {
  try {
    return parseEnv(fs.readFileSync(file, "utf8"));
  } catch {
    // .env is optional.
    return {};
  }
}
