import {
  installCrashLog,
  logCrash,
  logEvent,
  logExit,
  logRejection,
  logWarning,
} from "./crash-log.js";
import { PORT_IN_USE_CODE, recordExit } from "./exit-record.js";

let installed = false;

/** One explicit owner for normal stops, crashes and the final synchronous save. */
export function installShutdown({
  drain = async () => {},
  flush = () => {},
  graceMs = 30_000,
} = {}) {
  if (installed) return;
  installed = true;
  installCrashLog();
  let stopping = false;
  let stopSignal = null;
  process.on("uncaughtException", (error) => {
    const { message, stack } = logCrash(error);
    recordExit({
      who: "server",
      reason: `The server crashed: ${message}`,
      code: 1,
      detail: stack || message,
    });
    process.exit(1);
  });
  process.on("unhandledRejection", logRejection);
  process.on("exit", (code) => {
    if (code === PORT_IN_USE_CODE) return;
    flush();
    logExit(code);
    recordExit({
      who: "server",
      clean: code === 0,
      code,
      signal: stopSignal,
      reason: code === 0 ? "Stopped" : `The server stopped with exit code ${code}`,
    });
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      stopSignal = signal;
      logEvent(`Stopping on ${signal}`);
      const deadline = setTimeout(() => {
        const reason = "Shutdown timed out; accepted work remains recorded for recovery.";
        logWarning(reason);
        recordExit({ who: "server", code: 1, signal, reason });
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
