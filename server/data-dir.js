import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Settings first (.env and the old HEISS_* names), so STUDIO_DATA_DIR is read as configured.
import "./env.js";

/** The checkout or image folder Studio runs from. */
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Where Studio keeps its own state: STUDIO_DATA_DIR, else data/ in the project. Read again on each call. */
export function currentDataDir(env = process.env) {
  return env.STUDIO_DATA_DIR ? path.resolve(env.STUDIO_DATA_DIR) : path.join(projectRoot, "data");
}

/** Package version, read once; "" when package.json can't be read. */
export const appVersion = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")).version || ""; } catch { return ""; }
})();
