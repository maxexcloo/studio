import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { post } from "../../api";
import type { MediaItem } from "../../types";
import { useGeneration } from "../generation/GenerationProvider";
import { generationInput } from "../generation/payload";
import { queueQuery } from "../generation/Queue";

/**
 * Recreate for several uploads at once: each with a suggested prompt queues that prompt with the
 * composer's model and settings, as a version of the upload (backend/gallery/recreate.js), as
 * Prompt › Recreate would once run. The notice counts those still without a prompt.
 */
export function useRecreateMany() {
  const { input, profile } = useGeneration();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (items: MediaItem[]) => {
      if (!profile) throw new Error("Choose an available model first.");
      const ready = items.filter((item) => item.status === "done" && item.suggestedPrompt);
      let queued = 0;
      const failed: string[] = [];
      for (const item of ready) {
        try {
          const { sessionId, jobId } = await post<{ sessionId: string; jobId: string }>(
            "/api/gallery/recreate",
            { galleryItemId: item.id },
          );
          await post(`/api/sessions/${sessionId}/generations`, {
            ...generationInput(
              {
                ...input,
                prompt: item.suggestedPrompt || "",
                seed: "",
                referenceAssets: [],
                referenceDetails: [],
              },
              profile,
              [],
            ),
            operation: item.type === "video" ? "animate" : "image",
            parentJobId: jobId,
            parentItemId: item.id,
          });
          queued += 1;
        } catch (error) {
          failed.push(error instanceof Error ? error.message : String(error));
        }
      }
      return { queued, failed, waiting: items.length - ready.length };
    },
    onSuccess: ({ queued, failed, waiting }) => {
      notifications.show({
        color: failed.length ? "red" : undefined,
        message: [
          queued
            ? `Queued ${queued} ${queued === 1 ? "recreation" : "recreations"}.`
            : "Nothing was queued.",
          waiting > 0 &&
            `${waiting} ${waiting === 1 ? "upload has" : "uploads have"} no suggested prompt yet.`,
          failed.length > 0 && `${failed.length} failed: ${failed[0]}`,
        ]
          .filter(Boolean)
          .join(" "),
      });
      for (const queryKey of [queueQuery.queryKey, ["gallery"], ["sessions"]])
        void client.invalidateQueries({ queryKey });
    },
  });
}
