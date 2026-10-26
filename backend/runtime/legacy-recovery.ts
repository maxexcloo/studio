import { RuntimeUnavailable } from "./controller.ts";
import type { Workload } from "./controller.ts";

interface RecoveryState {
  backendUrl?: string;
  settled: boolean;
}

/** Only IDs recorded by this runtime before the durable queue existed are protected. */
export function legacyRecoverySwitchGuard({
  ids,
  recover,
  inspect,
  save,
}: {
  ids: Iterable<string>;
  recover: () => Promise<void>;
  inspect: (id: string) => RecoveryState;
  save: (ids: string[], workload: Workload) => Promise<void>;
}) {
  const unresolved = new Set(ids);
  return async (workload: Workload) => {
    if (workload.kind === "text" || !unresolved.size) return;
    await recover();
    const relevant = [...unresolved].filter((id) => {
      const state = inspect(id);
      return (
        !state.backendUrl || state.backendUrl.replace(/\/$/, "") === workload.url.replace(/\/$/, "")
      );
    });
    if (relevant.some((id) => !inspect(id).settled))
      throw new RuntimeUnavailable(
        "Waiting for recorded legacy generations to recover and save their outputs before switching this worker.",
      );
    if (relevant.length) {
      await save(relevant, workload);
      for (const id of relevant) unresolved.delete(id);
    }
  };
}
