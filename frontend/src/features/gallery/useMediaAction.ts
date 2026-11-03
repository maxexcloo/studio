import { queryOptions, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { useLocation, useNavigate } from "react-router";
import { api, post } from "../../api";
import type { MediaItem, Profile, QueueJob, ReferenceAsset, Session } from "../../types";
import { useRemembered } from "../auth/useRemembered";
import {
  initialInput,
  useGeneration,
  useGenerationActions,
} from "../generation/GenerationProvider";
import { backendLabel, generationInput, isProfile } from "../generation/payload";
import { queueQuery } from "../generation/Queue";

type Operation = "image" | "refine" | "animate" | "extend";
export type AnimateTier = "fast" | "quality";

interface AnimateChoice {
  profileId: string;
  label: string;
  cloud: boolean;
  size?: { width: number; height: number };
  /** Fast and Quality when they run different profiles, so Animate offers the choice. */
  tiers: AnimateTier[];
}

/** Animate's Fast or Quality choice, shared by every Animate menu; Fast until Quality is picked. */
export const useAnimateTier = () => useRemembered<AnimateTier>("animate-tier", "fast");
/** The prompt as typed, for the prompt field: Studio adds LoRA trigger words only to the run. */
export const typedPrompt = (item: MediaItem) =>
  typeof item.settings?.typedPrompt === "string" ? item.settings.typedPrompt : item.prompt || "";

/** The video profile that animates this image (backend/animate-profile.js), or why none can. */
export const animateProfileQuery = (
  item: Pick<MediaItem, "width" | "height">,
  tier: AnimateTier = "fast",
) =>
  queryOptions({
    queryKey: ["animate-profile", item.width || 0, item.height || 0, tier],
    queryFn: () =>
      api<AnimateChoice>(
        `/api/animate/profile?width=${item.width || 0}&height=${item.height || 0}&tier=${tier}`,
      ),
    staleTime: 5000,
    retry: false,
  });

/** The draft that reruns, refines or animates a saved result with its recorded settings. */
export async function mediaDraft(
  item: MediaItem,
  operation: Operation,
  profiles: Profile[],
  client: QueryClient,
  sessionId?: string,
  tier?: AnimateTier,
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
    priorId ? isProfile(profile, priorId) : profile.model === item.model,
  );
  // Animating an image takes Animate's own pick, so the composer shows the model that will run; a
  // video continues on its own model unless that is unavailable or stopped.
  const choice =
    targetKind === "video" && (item.type === "image" || original?.ready === false || !original)
      ? await client.fetchQuery(animateProfileQuery(item, tier))
      : undefined;
  const profile =
    (choice && profiles.find((profile) => isProfile(profile, choice.profileId))) ||
    original ||
    (operation !== "image" ? compatible.find((profile) => profile.ready !== false) : undefined);
  if (!profile)
    throw new Error(
      operation === "image"
        ? "The original profile is unavailable. Choose another model."
        : `No ${targetKind} model takes a reference.`,
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
  // A combined profile reruns on the backend that ran (an old per-backend id names its own) while
  // the profile still has it; otherwise on its current one, and the note says so.
  const ran = String(
    item.settings?.profileBackend || saved.profileBackend || profile.aliasBackends?.[priorId] || "",
  );
  const rerun = operation === "image" && profile.backend && ran;
  const profileBackend =
    rerun && profile.backendOptions?.some((option) => option.id === ran) ? ran : undefined;
  const note =
    rerun && !profileBackend
      ? `${profile.displayName || profile.label} no longer runs on ${backendLabel(ran)}, so this run uses ${backendLabel(profile.backend!)}.`
      : undefined;
  return {
    profile,
    note,
    seed: (item.settings?.seed ?? saved.seed) as string | number | undefined,
    draft: {
      sessionId: sourceSession,
      operation: (operation === "extend" ? "animate" : operation) as "image" | "refine" | "animate",
      parentJobId: sourceSession ? item.jobId : undefined,
      parentItemId: sourceSession ? item.id : undefined,
      references: preparedReferences,
      input: {
        ...initialInput,
        ...profile.defaults,
        // An edit runs the profile's reference mode, so it takes that mode's settings (a partial
        // denoise) rather than text-to-image's, which would redraw the image from scratch.
        ...(operation === "image"
          ? { ...source?.input, ...item.settings }
          : profile.imageModes?.reference?.defaults),
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
        prompt: typedPrompt(item),
        negative: item.negative || "",
        ...(choice?.size ??
          (item.width ? { width: item.width, height: item.height || item.width } : {})),
        referenceAssets: operation === "image" ? restored : [],
        referenceDetails: preparedReferences,
        profileBackend,
        // A reused prompt is the person's now; how the assistant wrote it stays with its result.
        writing: undefined,
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
  const [tier] = useAnimateTier();
  return useMutation({
    mutationFn: async (operation: Operation) => {
      const { draft, note } = await mediaDraft(item, operation, profiles, client, sessionId, tier);
      if (note) notifications.show({ message: note });
      // Chat stages a card with its own input; the gallery loads the composer.
      if (location.pathname.startsWith("/chat")) setStaged(draft);
      else setDraft(draft);
      prepared?.();
      // The gallery composer opens on the page for the draft's kind (an Animate draft lands in
      // Videos); elsewhere a Chat result returns to its Chat.
      const page = draft.input.kind === "video" ? "/video" : "/images";
      const gallery = ["/images", "/video"].includes(location.pathname);
      if (gallery || !draft.sessionId) {
        if (location.pathname !== page) navigate(`${page}?compose=1`);
      } else if (location.pathname !== `/chat/${draft.sessionId}`)
        navigate(`/chat/${draft.sessionId}`);
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
  custom: "Custom Animation",
} as const;
export type AnimateTheme = keyof typeof animateThemes;
export type Iteration =
  | { kind: "regenerate" }
  | { kind: "repeat" }
  | { kind: "animate"; theme: AnimateTheme; instruction?: string }
  | { kind: "prompt"; prompt: string; operation: PromptOperation };
/** How a given prompt runs: as Prompt › Edit would (a video animates again), an image edit or its animation. */
export type PromptOperation = "image" | "refine" | "animate";

/**
 * Queues a new run from a saved result without leaving the viewer: a new seed (the composer's
 * Count), an exact repeat, an animation whose motion prompt the assistant writes from a theme
 * as the queue item's first stage, or a given prompt. Resolves to the new job's ID.
 */
export function useMediaIteration(item: MediaItem, sessionId?: string) {
  const { profiles, input: composer } = useGeneration();
  const client = useQueryClient();
  const [tier] = useAnimateTier();
  return useMutation({
    mutationFn: async (iteration: Iteration) => {
      const animate = iteration.kind === "animate";
      const given = iteration.kind === "prompt" ? iteration : undefined;
      const { profile, seed, draft, note } = await mediaDraft(
        item,
        given?.operation ?? (animate ? "animate" : "image"),
        profiles,
        client,
        sessionId,
        tier,
      );
      if (note) notifications.show({ message: note });
      const prompt = given?.prompt ?? (animate ? "" : draft.input.prompt);
      const repeat = iteration.kind === "repeat";
      // A given prompt keeps the item's Count, as the composer would; an edit or animation runs once.
      const count = given
        ? given.operation === "image"
          ? draft.input.count
          : 1
        : repeat || animate
          ? 1
          : composer.count;
      const payload = {
        ...generationInput(
          { ...draft.input, prompt, seed: repeat ? (seed ?? "") : "", count },
          profile,
          draft.references,
        ),
        // The queue item writes the motion prompt first (backend/prompt-stage.js), then animates.
        ...(animate
          ? {
              writing: {
                kind: "animate",
                theme: iteration.theme,
                instruction: iteration.instruction,
                source: item.prompt || "",
                // A video's theme continues it from its last frame, so the writer moves the action on.
                ...(item.type === "video" ? { extend: true } : {}),
              },
            }
          : {}),
        operation: draft.input.kind === "video" ? "animate" : draft.operation,
        parentJobId: draft.parentJobId,
        parentItemId: draft.parentItemId,
      };
      const session =
        draft.sessionId ||
        (await post<{ session: Session }>("/api/sessions", { inputs: payload })).session.id;
      const result = await post<{ jobId: string; job?: QueueJob }>(
        `/api/sessions/${session}/generations`,
        payload,
      );
      // The strip shows the new run at once; polling then follows its progress.
      if (result.job)
        client.setQueryData(queueQuery.queryKey, (queue) =>
          queue ? { ...queue, jobs: [...queue.jobs, result.job!] } : queue,
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
