import { logWarning } from "./crash-log.js";

/**
 * sharp, loaded on first use. Its native binary can be missing (antivirus
 * quarantined it, or an install skipped the win32 build); importing it eagerly
 * would then stop the whole server from starting, when all that is lost is
 * image resizing. Resolves to null in that case and says so once.
 */
let loading = null;

export function loadSharp() {
  loading ||= import("sharp").then(
    (module) => module.default,
    (error) => {
      logWarning(
        `Image resizing is off: sharp could not load (${error.message.split("\n")[0]}). Thumbnails show the full images and uploaded references stay unresized; run npm install --omit=dev in the Studio folder, then restart.`,
      );
      return null;
    },
  );
  return loading;
}
