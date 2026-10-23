import { useMutation } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { api, failure, post } from "../../api";
import type { MediaItem, QueueJob, ReferenceAsset } from "../../types";
import { initialInput, useGeneration } from "../generation/GenerationProvider";
export function useMediaAction(item: MediaItem, sessionId?: string, prepared?: () => void) {
  const { setDraft, profiles } = useGeneration();
  const navigate = useNavigate();
  const location = useLocation();
  return useMutation({
    mutationFn: async (operation: "image" | "refine" | "animate" | "extend") => {
      const targetKind = operation === "animate" || operation === "extend" ? "video" : item.type;
      const priorId = String(item.settings?.profileId || "");
      const compatible = profiles.filter(
        (profile) =>
          profile.kind === targetKind &&
          (operation === "image" ||
            profile.mediaInputs?.length ||
            profile.capabilities.imageInput ||
            profile.capabilities.img2img),
      );
      const original = compatible.find((profile) =>
        priorId ? profile.id === priorId : profile.model === item.model,
      );
      const profile =
        original ||
        (operation !== "image" ? compatible.find((profile) => profile.ready !== false) : undefined);
      if (!profile)
        throw new Error(
          operation === "image"
            ? "The original profile is unavailable. Choose a model in generation controls."
            : `No ${targetKind} model with reference support is available.`,
        );
      const queue = await api<{ jobs: QueueJob[] }>("/api/queue");
      const source = queue.jobs.find((job) => job.id === item.jobId);
      const sourceSession = sessionId || source?.sessionId || "";
      let asset: ReferenceAsset | undefined;
      if (operation !== "image")
        asset = (
          await post<{ asset: ReferenceAsset }>("/api/reference-assets/from-gallery", {
            galleryItemId: item.id,
            ...(item.type === "video" ? { frame: "last" } : {}),
          })
        ).asset;
      setDraft({
        sessionId: sourceSession,
        operation: operation === "animate" || operation === "extend" ? "animate" : operation,
        parentJobId: sourceSession ? item.jobId : undefined,
        references: asset
          ? [asset]
          : operation === "image" && Array.isArray(source?.input.referenceDetails)
            ? source.input.referenceDetails
            : [],
        input: {
          ...initialInput,
          ...profile.defaults,
          ...(operation === "image" ? { ...source?.input, ...item.settings } : {}),
          kind: targetKind,
          profileId: profile.id,
          model: profile.model,
          workflow: profile.workflow,
          backendId:
            profile.provider === "cliproxyapi"
              ? undefined
              : typeof item.settings?.comfyBackend === "string"
                ? item.settings.comfyBackend
                : source?.backend || source?.input.backendId || profile.workerIds?.[0],
          prompt: item.prompt || "",
          negative: item.negative || "",
          ...(item.width ? { width: item.width, height: item.height || item.width } : {}),
          referenceAssets: operation === "image" ? source?.input.referenceAssets || [] : [],
        },
      });
      prepared?.();
      if (location.pathname !== "/")
        navigate(sourceSession ? `/sessions/${sourceSession}` : "/?compose=1");
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLTextAreaElement>("[data-composer-prompt]")
          ?.focus({ preventScroll: true }),
      );
    },
    onError: failure,
  });
}
