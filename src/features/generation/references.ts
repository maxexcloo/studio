import { useMutation } from "@tanstack/react-query";
import { failure, post } from "../../api";
import type { MediaItem, ReferenceAsset } from "../../types";
import { addReference, referenceDetails, referencePatch } from "./payload";
import { useGeneration } from "./GenerationProvider";
export const galleryReferenceType = "application/x-studio-gallery-item";
export function useGalleryReference(added?: () => void, adopt?: (asset: ReferenceAsset) => void) {
  const { setDraft, profile } = useGeneration();
  return useMutation({
    mutationFn: ({ id, type }: Pick<MediaItem, "id" | "type">) =>
      post<{ asset: ReferenceAsset }>("/api/reference-assets/from-gallery", {
        galleryItemId: id,
        ...(type === "video" ? { frame: "last" } : {}),
      }),
    onSuccess: ({ asset }) => {
      if (adopt) adopt(asset);
      else
        setDraft((previous) => {
          const references = addReference(
            referenceDetails(previous.references, previous.input, profile),
            asset,
            profile,
          );
          return {
            ...previous,
            references,
            input: {
              ...previous.input,
              ...referencePatch(previous.input, previous.references, references, profile),
            },
          };
        });
      added?.();
    },
    onError: failure,
  });
}
