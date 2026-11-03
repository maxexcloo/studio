import { logCrash, logEvent, logRejection, logWarning } from "./crash-log.js";

let installed = false;

/** One explicit owner for normal stops, crashes and the final synchronous save. */
export function installShutdown({
  drain = async () => {},
  flush = () => {},
  graceMs = 30_000,
} = {}) {
  if (installed) return;
  installed = true;
  let stopping = false;
  process.on("uncaughtException", (error) => {
    logCrash(error);
    process.exit(1);
  });
  process.on("unhandledRejection", logRejection);
  process.on("exit", (code) => {
    flush();
    logEvent("Studio exited", { code });
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      logEvent(`Stopping on ${signal}`);
      const deadline = setTimeout(() => {
        logWarning("Shutdown timed out; accepted work remains recorded for recovery.");
        process.exit(1);
      }, graceMs);
      void Promise.resolve()
        .then(drain)
        .then(
          () => {
            clearTimeout(deadline);
            // Exit explicitly: container PID 1 can ignore a re-raised default signal.
            process.exit(0);
          },
          (error) => {
            clearTimeout(deadline);
            logWarning("Could not finish shutdown", { message: error.message });
            process.exit(1);
          },
        );
    });
  }
}
