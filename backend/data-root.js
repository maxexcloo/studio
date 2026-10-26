import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where Studio runs from and keeps its state, with no side effects: the dev
 * launcher reads it too (exit-record.js), and must not load .env into its own
 * environment. The server imports it through data-dir.js, which loads .env first (env.js).
 */

/** The checkout or image folder Studio runs from. */
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Where Studio keeps its own state: STUDIO_DATA_DIR, else data/ in the project. Read again on each call. */
export function currentDataDir(env = process.env) {
  return env.STUDIO_DATA_DIR ? path.resolve(env.STUDIO_DATA_DIR) : path.join(projectRoot, "data");
}

/** A .env file's values as they are on disk, without loading them; the first line for a key wins. {} when there is none. */
export function readEnvFile(file) {
  const values = {};
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && !(match[1] in values))
        values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch {
    // .env is optional.
  }
  return values;
}
