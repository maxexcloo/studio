import { post } from "../../api";
import type { MediaItem } from "../../types";
import type { Action } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import { useGenerationActions } from "../generation/GenerationProvider";
import { useOpenComposer } from "../generation/openComposer";
import { useItemMutation } from "./useItemMutation";

/**
 * Recreate › Recreate in Composer for an item made outside Studio (an upload): the composer opens
 * with the model it has for the item's kind on the prompt Studio recreates it from (an import's own,
 * a written suggestion or what it shows), and the run is one of the item's versions
 * (backend/gallery/recreate.js).
 */
export function useRecreateAction(item: MediaItem, onApplied: () => void): Action {
  const { setDraft, changeKind } = useGenerationActions();
  const openComposer = useOpenComposer();
  const recreate = useItemMutation(item.id, "recreate", {
    mutationFn: () =>
      post<{ sessionId: string; jobId: string; prompt: string }>("/api/gallery/recreate", {
        galleryItemId: item.id,
      }),
    onSuccess: ({ sessionId, jobId, prompt }) => {
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
          prompt,
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
    icon: icons.prompt,
    disabled: recreate.isPending,
    loading: recreate.isPending,
    onClick: () => recreate.mutate(),
  };
}
