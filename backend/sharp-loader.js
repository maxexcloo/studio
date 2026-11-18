import { logWarning } from "./crash-log.js";

/**
 * sharp, loaded as Studio starts. Its native binary can be missing (antivirus
 * quarantined it, or an install skipped the win32 build); a static import
 * would then stop the whole server from starting, when all that is lost is
 * image resizing. Resolves to null in that case and says so once.
 */
const loading = import("sharp").then(
  ({ default: sharp }) => {
    // libvips' operation cache keeps recent images for reuse Studio's one-off resizes never get.
    sharp.cache(false);
    return sharp;
  },
  (error) => {
    logWarning(
      `Image resizing is off: sharp could not load (${error.message.split("\n")[0]}). Thumbnails show the full images and uploaded references stay unresized; run npm install --omit=dev in the Studio folder, then restart.`,
    );
    return null;
  },
);

export const loadSharp = () => loading;
