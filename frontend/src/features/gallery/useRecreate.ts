import { useMutation } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { post } from "../../api";
import type { MediaItem } from "../../types";
import { useGenerationActions } from "../generation/GenerationProvider";
import { useOpenComposer } from "../generation/openComposer";
import { icons } from "../../ui/icons";
import type { Action } from "./ActionBar";

/**
 * Recreate › Edit Prompt for an item made without a prompt (an upload), once its suggested prompt is
 * written: the composer opens on that prompt with the model it has for the item's kind, and the run
 * is one of the item's versions (backend/gallery/recreate.js).
 */
export function useRecreateAction(item: MediaItem, onApplied: () => void): Action {
  const { setDraft, changeKind } = useGenerationActions();
  const openComposer = useOpenComposer();
  const recreate = useMutation({
    mutationFn: () =>
      post<{ sessionId: string; jobId: string }>("/api/gallery/recreate", {
        galleryItemId: item.id,
      }),
    onSuccess: ({ sessionId, jobId }) => {
      changeKind(item.type, "gallery");
      setDraft(
        (previous) => ({
          ...previous,
          sessionId,
          operation: item.type === "video" ? "animate" : "image",
          parentJobId: jobId,
          parentItemId: item.id,
          presetId: undefined,
          presetTitle: undefined,
          references: [],
          input: {
            ...previous.input,
            prompt: item.suggestedPrompt || "",
            seed: "",
            referenceAssets: [],
            referenceDetails: [],
          },
        }),
        "gallery",
      );
      onApplied();
      openComposer(item.type);
    },
    onError: (error) => notifications.show({ color: "red", message: error.message }),
  });
  return {
    id: "recreate-upload",
    label: "Edit Prompt",
    icon: icons.prompt,
    disabled: !item.suggestedPrompt || recreate.isPending,
    loading: recreate.isPending,
    onClick: () => recreate.mutate(),
  };
}
