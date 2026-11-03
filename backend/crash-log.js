/**
 * What Studio logs when something goes wrong, one line per event on stdout and
 * stderr, which the container runtime keeps.
 *
 * - A crash (an uncaught exception) is logged with its stack before the process exits.
 * - A promise rejection nobody handled is logged and the server keeps going:
 *   Node would otherwise stop the whole studio for one failed side task.
 * - ComfyUI going away and coming back is logged, so it can be told apart from
 *   Studio itself going down.
 *
 * Nothing about prompts, images or file names goes in: only what happened.
 */

function write(level, message, extra) {
  const line = `${new Date().toISOString()} ${level.padEnd(5)} ${message}${extra ? ` ${JSON.stringify(extra)}` : ""}`;
  if (level === "info") console.log(line);
  else console.error(line);
  return line;
}

/** Something worth knowing later; `extra` is a small object of numbers and flags. */
export function logEvent(message, extra) {
  return write("info", message, extra);
}
export function logWarning(message, extra) {
  return write("warn", message, extra);
}

function describe(error) {
  if (error instanceof Error)
    return {
      name: error.name,
      message: error.message,
      // ECONNREFUSED (nothing listening) versus ETIMEDOUT/EHOSTUNREACH (the host is gone).
      ...(error.code || error.cause?.code ? { code: error.code || error.cause.code } : {}),
      stack: String(error.stack || "")
        .split("\n")
        .slice(0, 12)
        .join(" | "),
    };
  return { message: String(error) };
}

export function logCrash(error) {
  write("fatal", "Crashed: uncaught exception", describe(error));
}

export function logRejection(reason) {
  write("error", "Unhandled promise rejection (kept running)", describe(reason));
}

let comfyDown = false;
let comfyDownSince = 0;
/**
 * Called whenever a request to ComfyUI succeeds or fails: only changes are logged. `since` is when it
 * really stopped answering (a silent ComfyUI counts from its first unanswered check, not the grace's end).
 */
export function noteComfyState(reachable, error, since = Date.now()) {
  if (!reachable && !comfyDown) {
    comfyDown = true;
    comfyDownSince = since;
    write("warn", "ComfyUI stopped answering", describe(error));
  } else if (reachable && comfyDown) {
    comfyDown = false;
    write("warn", "ComfyUI answering again", {
      downForS: Math.round((Date.now() - comfyDownSince) / 1000),
    });
  }
}
