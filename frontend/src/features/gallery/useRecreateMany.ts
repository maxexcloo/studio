import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { recreationPrompt } from "../../../../shared/media";
import { post } from "../../api";
import type { MediaItem } from "../../types";
import { useDraft, useGeneration } from "../generation/GenerationProvider";
import { generationInput } from "../generation/payload";
import { queueQuery } from "../generation/Queue";
import { galleryKey } from "./queries";

/**
 * Recreate › Run Suggested Prompts queues each upload from its saved text on the composer's model,
 * as a version of the upload (backend/gallery/recreate.js).
 */
export function useRecreateMany() {
  const { input } = useDraft();
  const { profile } = useGeneration();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (items: MediaItem[]) => {
      if (!profile) throw new Error("Choose an available model first.");
      // The draft's negative prompt is read live; one copy keeps every recreation on the same draft.
      const base = { ...input };
      const ready = items.filter((item) => item.status === "done" && recreationPrompt(item));
      let waiting = items.length - ready.length;
      let queued = 0;
      const failed: { id: string; reason: string }[] = [];
      for (const item of ready) {
        try {
          const { sessionId, jobId, prompt } = await post<{
            sessionId: string;
            jobId: string;
            prompt: string;
          }>("/api/gallery/recreate", { galleryItemId: item.id, savedPromptOnly: true });
          await post(`/api/sessions/${sessionId}/generations`, {
            ...generationInput(
              {
                ...base,
                prompt,
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
          if (
            error instanceof Error &&
            (error.cause as { reason?: string } | undefined)?.reason === "no-saved-prompt"
          ) {
            waiting += 1;
            continue;
          }
          failed.push({
            id: item.id,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { queued, failed, waiting };
    },
    onSuccess: ({ queued, failed, waiting }) => {
      // Queued recreations show in the gallery; only what didn't queue needs saying.
      if (queued && !failed.length && !waiting) return;
      notifications.show({
        color: failed.length ? "red" : undefined,
        message: [
          queued
            ? `Queued ${queued} ${queued === 1 ? "recreation" : "recreations"}.`
            : "Nothing was queued.",
          waiting > 0 &&
            `${waiting} ${waiting === 1 ? "upload has" : "uploads have"} no saved prompt or caption yet.`,
          failed.length > 0 && `${failed.length} failed: ${failed[0].reason}`,
        ]
          .filter(Boolean)
          .join(" "),
      });
      for (const queryKey of [queueQuery.queryKey, galleryKey])
        void client.invalidateQueries({ queryKey });
    },
  });
}
