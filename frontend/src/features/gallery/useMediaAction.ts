import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { api, post } from "../../api";
import type { MediaItem, Profile, QueueJob, ReferenceAsset, Session } from "../../types";
import {
  initialInput,
  useGeneration,
  useGenerationActions,
} from "../generation/GenerationProvider";
import { generationInput } from "../generation/payload";
import { queueQuery } from "../generation/Queue";

type Operation = "image" | "refine" | "animate" | "extend";

/** The draft that reruns, refines or animates a saved result with its recorded settings. */
export async function mediaDraft(
  item: MediaItem,
  operation: Operation,
  profiles: Profile[],
  client: QueryClient,
  sessionId?: string,
) {
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
  const queue = await client.fetchQuery(queueQuery);
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
                asset.id === reference.assetId && (!asset.slot || asset.slot === reference.slot),
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
  return {
    profile,
    seed: (item.settings?.seed ?? saved.seed) as string | number | undefined,
    draft: {
      sessionId: sourceSession,
      operation: (operation === "extend" ? "animate" : operation) as "image" | "refine" | "animate",
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
        // Reused drafts draw a new seed; only Exact Repeat keeps the recorded one.
        seed: "",
        prompt: item.prompt || "",
        negative: item.negative || "",
        ...(item.width ? { width: item.width, height: item.height || item.width } : {}),
        ...(operation === "image" && legacyId ? { startImageId: legacyId } : {}),
        referenceAssets: operation === "image" ? restored : [],
        referenceDetails: preparedReferences,
      },
    },
  };
}

/** Prepares the composer (or a Chat card) to refine, animate or recreate a result. */
export function useMediaAction(item: MediaItem, sessionId?: string, prepared?: () => void) {
  const { setDraft, profiles, setStaged } = useGenerationActions();
  const navigate = useNavigate();
  const location = useLocation();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (operation: Operation) => {
      const { draft } = await mediaDraft(item, operation, profiles, client, sessionId);
      // Chat stages a card with its own input; the gallery loads the composer.
      if (location.pathname.startsWith("/chat")) setStaged(draft);
      else setDraft(draft);
      prepared?.();
      if (!["/images", "/video"].includes(location.pathname))
        navigate(draft.sessionId ? `/chat/${draft.sessionId}` : "/images?compose=1");
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLTextAreaElement>("[data-composer-prompt]")
          ?.focus({ preventScroll: true }),
      );
    },
  });
}

export const animateThemes = {
  cinematic: "Cinematic Camera",
  living: "Living Photo",
  action: "Action",
  spicy: "Spicy",
  custom: "Custom Instruction",
} as const;
export type AnimateTheme = keyof typeof animateThemes;
export type Iteration =
  | { kind: "variation"; prompt: string }
  | { kind: "regenerate" }
  | { kind: "repeat" }
  | { kind: "animate"; theme: AnimateTheme; instruction?: string };

/**
 * Queues a new run from a saved result without leaving the viewer: a variation with a new prompt
 * (the composer's Count), a new seed, an exact repeat, or an animation whose motion prompt the
 * assistant writes from a theme. Resolves to the new job's ID.
 */
export function useMediaIteration(item: MediaItem, sessionId?: string) {
  const { profiles, input: composer } = useGeneration();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (iteration: Iteration) => {
      const animate = iteration.kind === "animate";
      const { profile, seed, draft } = await mediaDraft(
        item,
        animate ? "animate" : "image",
        profiles,
        client,
        sessionId,
      );
      const prompt =
        iteration.kind === "variation"
          ? iteration.prompt
          : animate
            ? (
                await post<{ prompt: string }>("/api/assistant/animate", {
                  profileId: profile.id,
                  prompt: item.prompt,
                  theme: iteration.theme,
                  instruction: iteration.instruction,
                })
              ).prompt
            : draft.input.prompt;
      const repeat = iteration.kind === "repeat";
      const payload = {
        ...generationInput(
          {
            ...draft.input,
            prompt,
            seed: repeat ? (seed ?? "") : "",
            count: repeat || animate ? 1 : composer.count,
          },
          profile,
          draft.references,
        ),
        operation: draft.input.kind === "video" ? "animate" : "image",
        parentJobId: draft.parentJobId,
      };
      const session =
        draft.sessionId ||
        (
          await post<{ session: Session }>("/api/sessions", {
            title: prompt.slice(0, 80),
            inputs: payload,
          })
        ).session.id;
      const result = await post<{ jobId: string; job?: QueueJob }>(
        `/api/sessions/${session}/generations`,
        payload,
      );
      // The strip shows the new run at once; polling then follows its progress.
      if (result.job)
        client.setQueryData(queueQuery.queryKey, (queue) =>
          queue ? { jobs: [...queue.jobs, result.job!] } : queue,
        );
      void Promise.all(
        [queueQuery.queryKey, ["gallery"], ["sessions"], ["session", session]].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      );
      return result.jobId;
    },
  });
}
