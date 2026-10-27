// Settings first (.env), so STUDIO_DATA_DIR is read as configured.
import "./env.js";

export { currentDataDir, projectRoot } from "./data-root.js";

/** The short commit the image was built from (Dockerfile); "" outside an image. */
export const appVersion = (process.env.STUDIO_COMMIT ?? "").slice(0, 7);
