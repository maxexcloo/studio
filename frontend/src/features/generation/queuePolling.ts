import type { QueueJob } from "../../types";

export function queuePollInterval(jobs: Pick<QueueJob, "status" | "progress">[] = []) {
  let interval = 3000;
  for (const { status, progress } of jobs) {
    if (status === "saving") return 350;
    if (status === "running") {
      const { phase, steps, value = 0, max = 0 } = progress ?? {};
      if (phase === "Decoding" || phase === "Saving" || (steps && max > 0 && value >= max - 1))
        return 350;
    }
    if (status === "running" || status === "starting" || status === "writing") interval = 1500;
    if (status === "queued" || status === "waiting") interval = Math.min(interval, 2000);
  }
  return interval;
}
