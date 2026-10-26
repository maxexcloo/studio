import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where Studio runs from and keeps its state, with no side effects: the dev
 * launcher reads it too (exit-record.js), and must not load .env into its own
 * environment. The server imports it through data-dir.js, which loads .env first.
 */

/** The checkout or image folder Studio runs from. */
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Where Studio keeps its own state: STUDIO_DATA_DIR, else data/ in the project. Read again on each call. */
export function currentDataDir(env = process.env) {
  return env.STUDIO_DATA_DIR ? path.resolve(env.STUDIO_DATA_DIR) : path.join(projectRoot, "data");
}
