import fs from "node:fs";
import path from "node:path";
// Settings first (.env and the old HEISS_* names), so STUDIO_DATA_DIR is read as configured.
import "./env.js";
import { projectRoot } from "./data-root.js";

export { currentDataDir, projectRoot } from "./data-root.js";

/** Package version, read once; "" when package.json can't be read. */
export const appVersion = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")).version || ""; } catch { return ""; }
})();
