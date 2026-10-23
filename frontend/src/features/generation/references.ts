import { useMutation } from "@tanstack/react-query";
import { failure, post } from "../../api";
import type { MediaItem, Profile, ReferenceAsset } from "../../types";
import { addReference, referenceDetails, referencePatch } from "./payload";
import { useGeneration } from "./GenerationProvider";
import { useReferenceUpload } from "./useReferenceUpload";
export const galleryReferenceType = "application/x-studio-gallery-item";
export function referenceLabel(asset: ReferenceAsset, index: number, profile?: Profile) {
  const role = profile?.mediaInputs?.find((input) => input.id === asset.slot)?.label;
  return `Reference ${index + 1}${role ? ` · ${role}` : ""}`;
}
function useAdoptReference() {
  const { setDraft, profile } = useGeneration();
  return (asset: ReferenceAsset) =>
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
}
export function useReferenceFiles() {
  const { form, profile } = useGeneration();
  const adopt = useAdoptReference();
  const { upload, uploading } = useReferenceUpload(adopt);
  async function uploadFiles(files: File[]) {
    const slot = profile?.mediaInputs?.[0];
    const limit = slot?.max || (slot ? 1 : 8);
    const current = form.getValues();
    const used = referenceDetails(current.references, current.input, profile).filter(
      (asset) => asset.slot === (slot?.id || "image"),
    ).length;
    const remaining = limit === 1 ? 1 : Math.max(0, limit - used);
    for (const file of files.filter((file) => file.type.startsWith("image/")).slice(0, remaining))
      await upload(file);
  }
  return { uploadFiles, uploading };
}
export function useGalleryReference(adopt?: (asset: ReferenceAsset) => void) {
  const add = useAdoptReference();
  return useMutation({
    mutationFn: ({ id, type }: Pick<MediaItem, "id" | "type">) =>
      post<{ asset: ReferenceAsset }>("/api/reference-assets/from-gallery", {
        galleryItemId: id,
        ...(type === "video" ? { frame: "last" } : {}),
      }),
    onSuccess: ({ asset }) => {
      if (adopt) adopt(asset);
      else add(asset);
    },
    onError: failure,
  });
}
