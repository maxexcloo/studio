import { useMutation } from "@tanstack/react-query";
import { failure, post } from "../../api";
import type { MediaItem, ReferenceAsset } from "../../types";
import { useGeneration } from "./GenerationProvider";
export const galleryReferenceType = "application/x-studio-gallery-item";
export function useGalleryReference(added?: () => void) {
  const { setDraft } = useGeneration();
  return useMutation({
    mutationFn: ({ id, type }: Pick<MediaItem, "id" | "type">) =>
      post<{ asset: ReferenceAsset }>("/api/reference-assets/from-gallery", {
        galleryItemId: id,
        ...(type === "video" ? { frame: "last" } : {}),
      }),
    onSuccess: ({ asset }) => {
      setDraft((previous) => ({
        ...previous,
        references: [
          ...previous.references.filter((reference) => reference.id !== asset.id),
          asset,
        ],
      }));
      added?.();
    },
    onError: failure,
  });
}
