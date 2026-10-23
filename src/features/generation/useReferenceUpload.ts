import { useState } from "react";
import { api, failure } from "../../api";
import type { ReferenceAsset } from "../../types";
import { useGeneration } from "./GenerationProvider";

export function useReferenceUpload() {
  const { setDraft } = useGeneration();
  const [uploading, setUploading] = useState(false);
  async function upload(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("image", file);
      const { asset } = await api<{ asset: ReferenceAsset }>("/api/reference-assets/upload", {
        method: "POST",
        body: form,
      });
      setDraft((previous) => ({ ...previous, references: [...previous.references, asset] }));
      return asset;
    } catch (error) {
      failure(error);
    } finally {
      setUploading(false);
    }
  }
  return { upload, uploading };
}
