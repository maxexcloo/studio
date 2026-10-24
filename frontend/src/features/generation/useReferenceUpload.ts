import { useMutation } from "@tanstack/react-query";
import { api } from "../../api";
import type { ReferenceAsset } from "../../types";

export function useReferenceUpload(adopt: (asset: ReferenceAsset) => void) {
  const mutation = useMutation({
    mutationKey: ["reference-upload"],
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("image", file);
      const { asset } = await api<{ asset: ReferenceAsset }>("/api/reference-assets/upload", {
        method: "POST",
        body: form,
      });
      return asset;
    },
    onSuccess: adopt,
  });
  async function upload(file: File | null) {
    if (file) return mutation.mutateAsync(file).catch(() => undefined);
  }
  return { upload, uploading: mutation.isPending };
}
