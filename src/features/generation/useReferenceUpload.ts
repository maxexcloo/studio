import { useState } from "react";
import { api, failure } from "../../api";
import type { ReferenceAsset } from "../../types";

export function useReferenceUpload(adopt: (asset: ReferenceAsset) => void) {
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
      adopt(asset);
      return asset;
    } catch (error) {
      failure(error);
    } finally {
      setUploading(false);
    }
  }
  return { upload, uploading };
}
