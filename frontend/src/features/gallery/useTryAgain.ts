import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import type { MediaItem } from "../../types";
import { useQueueAction } from "../generation/Queue";

/**
 * Retries failed jobs once each through the shared queue command. An accepted retry's new
 * pending tiles replace the job's failed tiles; failures are reported by the queue command and
 * their tiles remain. Returns the accepted job IDs.
 */
export function useTryAgain(items: MediaItem[]) {
  const retry = useQueueAction();
  const client = useQueryClient();
  return async (jobIds: string[]) => {
    const accepted = new Set<string>();
    for (const id of new Set(jobIds)) {
      try {
        if (await retry.mutateAsync({ id, action: "retry" })) accepted.add(id);
      } catch {
        // Reported by the queue command's default notification.
      }
    }
    await Promise.allSettled(
      items
        .filter((item) => item.status === "error" && accepted.has(item.jobId || ""))
        .map((item) => api(`/api/gallery/${encodeURIComponent(item.id)}`, { method: "DELETE" })),
    );
    if (accepted.size) await client.invalidateQueries({ queryKey: ["gallery"] });
    return accepted;
  };
}
