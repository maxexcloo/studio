// Settings first (.env), so STUDIO_DATA_DIR is read as configured.
import "./env.js";
import { currentDataDir } from "./data-root.js";

export { currentDataDir, projectRoot } from "./data-root.js";

/** Studio's runtime data folder (STUDIO_DATA_DIR), as configured when Studio starts. */
export const dataDir = currentDataDir();

/** The short commit the image was built from (Dockerfile); "" outside an image. */
export const appVersion = (process.env.STUDIO_COMMIT ?? "").slice(0, 7);
