import { useMutation } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { WandSparkles } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { post } from "../../api";
import type { MediaItem } from "../../types";
import { useGenerationActions } from "../generation/GenerationProvider";
import type { Action } from "./ActionBar";

/**
 * Prompt › Recreate, for an item made without a prompt (an upload) once its suggested prompt is
 * written: the composer opens on that prompt with the model it has for the item's kind, and the run
 * is one of the item's versions (backend/gallery/recreate.js).
 */
export function useRecreateAction(item: MediaItem, onApplied: () => void): Action | null {
  const { setDraft, changeKind } = useGenerationActions();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
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
      const page = item.type === "video" ? "/video" : "/images";
      if (location.pathname !== page) navigate(`${page}?compose=1`);
      else {
        const next = new URLSearchParams(params);
        next.set("compose", "1");
        setParams(next, { replace: true });
      }
    },
    onError: (error) => notifications.show({ color: "red", message: error.message }),
  });
  if (item.status !== "done" || !item.suggestedPrompt) return null;
  return {
    id: "recreate",
    label: "Recreate",
    icon: WandSparkles,
    disabled: recreate.isPending,
    loading: recreate.isPending,
    onClick: () => recreate.mutate(),
  };
}
