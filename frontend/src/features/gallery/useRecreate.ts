import { post } from "../../api";
import type { MediaItem } from "../../types";
import { useGenerationActions } from "../generation/GenerationProvider";
import { useOpenComposer } from "../generation/openComposer";
import { icons } from "../../ui/icons";
import type { Action } from "../../ui/ActionBar";
import { useItemMutation } from "./useItemMutation";

/**
 * Edit › Recreate for an item made outside Studio (an upload), once it has a prompt (an import's own
 * or a written suggestion): the composer opens on that prompt with the model it has for the item's kind, and the run
 * is one of the item's versions (backend/gallery/recreate.js).
 */
export function useRecreateAction(item: MediaItem, onApplied: () => void): Action {
  const { setDraft, changeKind } = useGenerationActions();
  const openComposer = useOpenComposer();
  const recreate = useItemMutation(item.id, "recreate", {
    mutationFn: () =>
      post<{ sessionId: string; jobId: string }>("/api/gallery/recreate", {
        galleryItemId: item.id,
      }),
    onSuccess: ({ sessionId, jobId }) => {
      changeKind(item.type);
      setDraft((previous) => ({
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
          prompt: item.prompt || item.suggestedPrompt || "",
          seed: "",
          referenceAssets: [],
          referenceDetails: [],
        },
      }));
      onApplied();
      openComposer(item.type);
    },
  });
  return {
    id: "prompt-composer",
    label: "Recreate in Composer",
    description: item.prompt
      ? "Open its prompt in the composer"
      : "Open its suggested prompt in the composer",
    icon: icons.prompt,
    disabled: !(item.prompt || item.suggestedPrompt) || recreate.isPending,
    loading: recreate.isPending,
    onClick: () => recreate.mutate(),
  };
}
