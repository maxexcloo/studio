import { useMutation } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { api, failure, post } from "../../api";
import type { MediaItem, QueueJob, ReferenceAsset } from "../../types";
import { initialInput, useGenerationActions } from "../generation/GenerationProvider";
export function useMediaAction(item: MediaItem, sessionId?: string, prepared?: () => void) {
  const { setDraft, profiles, setPrepared } = useGenerationActions();
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
      const saved = source?.input || item.settings || {};
      const recordedReferences = source?.input.referenceAssets ?? item.settings?.referenceAssets;
      const recordedDetails = Array.isArray(saved.referenceDetails) ? saved.referenceDetails : [];
      let restored = Array.isArray(recordedReferences)
        ? recordedReferences.map((reference) => ({ ...reference }))
        : recordedDetails.map((asset: ReferenceAsset) => ({
            assetId: asset.id,
            slot: asset.slot || profile.mediaInputs?.[0]?.id || "image",
          }));
      const legacyId = String(item.startImageId || item.referenceImage || saved.startImageId || "");
      if (operation === "image" && !restored.length && legacyId)
        restored = [{ assetId: legacyId, slot: profile.mediaInputs?.[0]?.id || "image" }];
      const references: ReferenceAsset[] =
        operation !== "image"
          ? []
          : await Promise.all(
              restored.map(async (reference) => {
                const detail = recordedDetails.find(
                  (asset: ReferenceAsset) =>
                    asset.id === reference.assetId &&
                    (!asset.slot || asset.slot === reference.slot),
                );
                const asset = detail?.thumbnailUrl
                  ? detail
                  : (
                      await api<{ asset: ReferenceAsset }>(
                        `/api/reference-assets/${encodeURIComponent(reference.assetId)}`,
                      )
                    ).asset;
                return { ...asset, slot: reference.slot };
              }),
            );
      const preparedReferences = asset
        ? [{ ...asset, slot: profile.mediaInputs?.[0]?.id || "image" }]
        : references;
      setDraft({
        sessionId: sourceSession,
        operation: operation === "animate" || operation === "extend" ? "animate" : operation,
        parentJobId: sourceSession ? item.jobId : undefined,
        references: preparedReferences,
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
          ...(operation === "image" && legacyId ? { startImageId: legacyId } : {}),
          referenceAssets: operation === "image" ? restored : [],
          referenceDetails: preparedReferences,
        },
      });
      prepared?.();
      if (location.pathname.startsWith("/chat")) setPrepared(true);
      if (!["/images", "/video"].includes(location.pathname))
        navigate(sourceSession ? `/chat/${sourceSession}` : "/images?compose=1");
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLTextAreaElement>("[data-composer-prompt]")
          ?.focus({ preventScroll: true }),
      );
    },
    onError: failure,
  });
}
