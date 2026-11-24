import { notifications } from "@mantine/notifications";
import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { maxModifiers } from "../../../../shared/animate";
import { isCloudProfile } from "../../../../shared/profiles";
import type { StudioSession } from "../../../../shared/queue";
import { profileStartingSize } from "../../../../shared/resolution";
import { api, post } from "../../api";
import type { MediaItem, QueueJob, ReferenceAsset } from "../../types";
import type { Action } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import { useRemembered } from "../auth/useRemembered";
import {
  defaultProfile,
  initialInput,
  modelsQuery,
  useGenerationActions,
} from "../generation/GenerationProvider";
import { lengthChoices } from "../generation/length";
import { compatibleLoras, loraInfoQuery } from "../generation/LoraPicker";
import { useOpenComposer } from "../generation/openComposer";
import {
  backendLabel,
  generationCountLimit,
  generationInput,
  isProfile,
  profileForBackend,
  profileForLoras,
  profileName,
  takesReferences,
} from "../generation/payload";
import { assistantQuery } from "../generation/PromptAssistant";
import { queueJobQuery, queueQuery } from "../generation/Queue";
import { type VideoSide, animationInput, retainedAnimationProfile } from "./animateLength";
import { automaticEditProfile, enabledLoras } from "./editProfile";
import { useItemMutation } from "./useItemMutation";

type Operation = "image" | "refine" | "animate" | "extend";
interface AnimateChoice {
  profileId: string;
  label: string;
  cloud: boolean;
  size?: { width: number; height: number };
  /** Why it runs somewhere other than the account prefers. */
  note?: string;
}

/** The preferred animation length in seconds; unset keeps the selected profile's default. */
const useAnimateLength = () => useRemembered<number | null>("animate-length", null);

/** Animate's Review Prompt: templates write the prompt for editing before it runs; off until chosen. */
export const useAnimateReview = () => useRemembered<boolean>("animate-review", false);
/** A change's proposal fills the viewer's prompt before it runs when Review Prompt is on. */
export const useMediaReview = () => useRemembered<boolean | null>("viewer-review-first", null);
/** The prompt as typed, for the prompt field: Studio adds LoRA trigger words only to the run. */
export const typedPrompt = (item: MediaItem) =>
  typeof item.settings?.typedPrompt === "string" ? item.settings.typedPrompt : item.prompt || "";

/**
 * The video profile that animates this image where the account prefers videos to run
 * (backend/animate-profile.js), or why none can.
 */
export const animateProfileQuery = (
  item: Pick<MediaItem, "width" | "height">,
  profileId?: string,
) =>
  queryOptions({
    queryKey: ["animate-profile", item.width || 0, item.height || 0, profileId],
    queryFn: () =>
      api<AnimateChoice>(
        `/api/animate/profile?width=${item.width || 0}&height=${item.height || 0}${profileId ? `&profileId=${encodeURIComponent(profileId)}` : ""}`,
      ),
    staleTime: 5000,
  });

/** Where videos run: the side of Studio's default video model (Settings › Where Work Runs). */
function useVideosSide(): VideoSide | undefined {
  const models = useQuery(modelsQuery).data;
  const profile = models?.profiles.find((entry) => entry.id === models.defaults?.videoModel);
  return profile && (isCloudProfile(profile) ? "cloud" : "local");
}

/** The same per-account Length setting in every Animate menu. */
export function useAnimateLengthSetting(item?: MediaItem, profileId?: string): Action {
  const [seconds, setSeconds] = useAnimateLength();
  const videos = useVideosSide();
  const models = useQuery(modelsQuery);
  const retained =
    item && !profileId && retainedAnimationProfile(models.data?.profiles || [], item, videos);
  const choice = useQuery({
    ...animateProfileQuery(item || {}, profileId),
    enabled: Boolean(item && !retained),
  });
  const listed =
    retained || models.data?.profiles.find((profile) => isProfile(profile, choice.data?.profileId));
  const profile = profileForBackend(listed, undefined, true);
  const input = listed && animationInput({ ...initialInput, kind: "video" }, listed, seconds);
  const options =
    input &&
    profile &&
    lengthChoices(input, {
      ...profile,
      capabilities: { ...profile.capabilities, ...profile.imageModes?.reference?.capabilities },
    });
  const fps = options?.key === "duration" ? 1 : input?.fps;
  return {
    id: "animate-length",
    label: "Length",
    loading: models.isPending || (!retained && choice.isLoading),
    disabled: !item || !options || options.data.length < 2 || (!retained && choice.isLoading),
    choice: {
      value: options?.value || "fixed",
      options: options?.data || [{ value: "fixed", label: "Fixed Length" }],
      onChange: (value) => setSeconds(Number(value) / fps!),
    },
  };
}

/** The draft that reruns, refines or animates a saved result with its recorded settings. */
export async function mediaDraft(
  item: MediaItem,
  operation: Operation,
  client: QueryClient,
  videos?: VideoSide,
  seconds?: number | null,
  profileId?: string,
  editBackend?: string,
) {
  // An action can run before the composer's models load.
  const models = await client.ensureQueryData(modelsQuery);
  const { profiles } = models;
  const targetKind = operation === "animate" || operation === "extend" ? "video" : item.type;
  const priorId = String(item.settings?.profileId || "");
  const compatible = profiles.filter(
    (profile) => profile.kind === targetKind && (operation === "image" || takesReferences(profile)),
  );
  const original = compatible.find((profile) =>
    priorId ? isProfile(profile, priorId) : Boolean(item.model) && profile.model === item.model,
  );
  const selected =
    profileId &&
    compatible.find(
      (profile) =>
        isProfile(profile, profileId) &&
        profileForBackend(profile, editBackend, true)?.ready !== false &&
        (!editBackend ||
          (profile.backendOptions?.some(({ id }) => id === editBackend) &&
            takesReferences(profile, editBackend))),
    );
  if (profileId && !selected) throw new Error("The selected model is unavailable for this action.");
  // A video continues on its own running model unless a profile or the Cloud route was chosen.
  const retained =
    targetKind === "video" && !selected
      ? retainedAnimationProfile(profiles, item, videos)
      : undefined;
  const choice =
    targetKind === "video" && !retained
      ? await client.fetchQuery(animateProfileQuery(item, profileId))
      : undefined;
  // A result made elsewhere, or on a model Studio no longer has, recreates on the account's default.
  const fallback =
    operation === "image" && !original ? defaultProfile(models, targetKind) : undefined;
  const profile =
    selected ||
    retained ||
    (choice && profiles.find((profile) => isProfile(profile, choice.profileId))) ||
    (operation === "refine" ? automaticEditProfile(profiles, item) : undefined) ||
    original ||
    fallback ||
    compatible.find((profile) => profile.ready !== false);
  if (!profile)
    throw new Error(
      operation === "image"
        ? `No ${targetKind} model is available.`
        : `No ${targetKind} model takes a reference.`,
    );
  // Its recorded settings belong to the original model.
  const foreign = profile === fallback;
  // A result without a run of its own (an upload or import) gets one, so the recreation is one of
  // its versions, with the prompt it recreates from: its own, else what it shows.
  const start =
    operation === "image" && !item.jobId
      ? await post<{ sessionId: string; jobId: string; prompt: string }>("/api/gallery/recreate", {
          galleryItemId: item.id,
        })
      : undefined;
  const queue = await client.fetchQuery(queueQuery);
  const source =
    queue.jobs.find((job) => job.id === item.jobId) ||
    (item.jobId
      ? await client.fetchQuery(queueJobQuery(item.jobId)).then(
          ({ job }) => job,
          () => undefined,
        )
      : undefined);
  const sourceSession = source?.sessionId || start?.sessionId || "";
  let asset: ReferenceAsset | undefined;
  if (operation !== "image")
    asset = (
      await post<{ asset: ReferenceAsset }>("/api/reference-assets/from-gallery", {
        galleryItemId: item.id,
        ...(item.type === "video" ? { frame: "last" } : {}),
      })
    ).asset;
  const saved = foreign ? {} : source?.input || item.settings || {};
  // The first reference slot of the backend a run with references uses.
  const firstSlot = profileForBackend(profile, editBackend, true)?.mediaInputs?.[0]?.id || "image";
  const recordedReferences = foreign
    ? undefined
    : (source?.input.referenceAssets ?? item.settings?.referenceAssets);
  const recordedDetails = Array.isArray(saved.referenceDetails) ? saved.referenceDetails : [];
  const restored = Array.isArray(recordedReferences)
    ? recordedReferences.map((reference) => ({ ...reference }))
    : recordedDetails.map((asset: ReferenceAsset) => ({
        assetId: asset.id,
        slot: asset.slot || firstSlot,
        strength: asset.strength,
      }));
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
              : await api<{ asset: ReferenceAsset }>(
                  `/api/reference-assets/${encodeURIComponent(reference.assetId)}`,
                ).then(
                  ({ asset }) => asset,
                  (error) => {
                    if (error?.status !== 404) throw error;
                    throw new Error(
                      item.type === "video"
                        ? "The original reference for this video is unavailable. Use Extend in Composer to continue from its last frame."
                        : "A saved reference is unavailable. To recreate this result, use its prompt in Generate with a replacement reference.",
                      { cause: error },
                    );
                  },
                );
            return {
              ...asset,
              slot: reference.slot,
              ...(reference.strength !== undefined ? { strength: reference.strength } : {}),
            };
          }),
        );
  const preparedReferences = asset ? [{ ...asset, slot: firstSlot }] : references;
  // A combined profile reruns on the backend that ran while the profile still has it; otherwise on
  // its current one, and the note says so.
  const ran = foreign ? "" : String(item.settings?.profileBackend || saved.profileBackend || "");
  const rerun = operation === "image" && profile.backend && ran;
  const profileBackend =
    editBackend ??
    (rerun && profile.backendOptions?.some((option) => option.id === ran) ? ran : undefined);
  const editProfile = editBackend ? profileForBackend(profile, editBackend, true)! : profile;
  const note =
    rerun && !profileBackend
      ? `${profileName(profile)} no longer runs on ${backendLabel(ran)}, so this run uses ${backendLabel(profile.backend!)}.`
      : undefined;
  const timing =
    operation === "animate" || operation === "extend"
      ? animationInput({ ...initialInput, kind: "video" }, profile, seconds)
      : undefined;
  // A reference run without a denoise of its own (an edit model's) records none.
  const run = profileForBackend(profile, profileBackend, true)!;
  const reference = run.imageModes?.reference;
  const takesDenoise =
    (reference?.capabilities ?? run.capabilities).denoise === true ||
    (reference?.defaults ?? run.defaults).denoise !== undefined;
  // An edit keeps the source's LoRAs where its editor runs them (a model of the same family).
  const sourceLoras = operation === "refine" ? enabledLoras(item.settings) : undefined;
  const loraRun = sourceLoras?.length ? profileForLoras(profile, profileBackend, true) : undefined;
  const loraInfo = loraRun?.capabilities.lora
    ? (await client.ensureQueryData(loraInfoQuery)).loras
    : undefined;
  const loras = loraInfo
    ? sourceLoras!.filter((lora) => compatibleLoras(loraRun, loraInfo).includes(lora.name))
    : [];
  const resolution =
    operation === "animate" && item.type === "image"
      ? profileStartingSize(editProfile).resolution
      : undefined;
  return {
    profile,
    choice,
    note,
    seed: (item.settings?.seed ?? saved.seed) as string | number | undefined,
    draft: {
      sessionId: sourceSession,
      operation: (operation === "extend" ? "animate" : operation) as "image" | "refine" | "animate",
      parentJobId: sourceSession ? (item.jobId ?? start?.jobId) : undefined,
      // Every run from the item records it, also outside its session, so its results stay versions.
      parentItemId: item.id,
      references: preparedReferences,
      input: {
        ...initialInput,
        ...editProfile.defaults,
        // An edit runs the profile's reference mode, so it takes that mode's settings (a partial
        // denoise) rather than text-to-image's, which would redraw the image from scratch.
        ...(operation !== "image"
          ? editProfile.imageModes?.reference?.defaults
          : foreign
            ? {}
            : { ...source?.input, ...item.settings }),
        ...(operation !== "image" && !takesDenoise && { denoise: undefined }),
        ...(operation === "refine" && { loras }),
        ...(timing ? { duration: timing.duration, frames: timing.frames, fps: timing.fps } : {}),
        ...(resolution && { resolution }),
        kind: targetKind,
        profileId: profile.id,
        model: editProfile.model,
        workflow: editProfile.workflow,
        // The profile's current checkpoint runs, not the file the original result loaded.
        modelName: undefined,
        // Reused drafts draw a new seed; only Run Again, Same Seed keeps the recorded one.
        seed: "",
        prompt: start?.prompt ?? typedPrompt(item),
        negative: item.negative || "",
        ...(choice?.size ??
          (item.width ? { width: item.width, height: item.height || item.width } : {})),
        referenceAssets: operation === "image" ? restored : [],
        referenceDetails: preparedReferences,
        profileBackend,
        // A reused prompt is the person's now; how the assistant wrote it stays with its result.
        writing: undefined,
        chat: undefined,
        resultSet: undefined,
      },
    },
  };
}

/** Prepares the composer to refine, animate or recreate a result. */
export function useMediaAction(item: MediaItem, prepared?: () => void) {
  const { setDraft } = useGenerationActions();
  const client = useQueryClient();
  const videos = useVideosSide();
  const [seconds] = useAnimateLength();
  const openComposer = useOpenComposer();
  return useItemMutation(item.id, "prepare", {
    mutationFn: async ({
      operation,
      prompt,
      profileId,
    }: {
      operation: Operation;
      prompt?: string;
      profileId?: string;
    }) => {
      const { profile, choice, draft, note } = await mediaDraft(
        item,
        operation,
        client,
        videos,
        seconds,
        profileId,
      );
      // The composer's profile chip doesn't say where a video runs, nor why it runs elsewhere.
      const cloud =
        draft.input.kind === "video" && isCloudProfile(profile)
          ? `This runs on ${profileName(profile)} · Cloud.`
          : undefined;
      const message = note || choice?.note || cloud;
      if (message) notifications.show({ message });
      setDraft(prompt === undefined ? draft : { ...draft, input: { ...draft.input, prompt } });
      prepared?.();
      // The gallery composer opens on the page for the draft's kind (an Animate draft lands in Videos).
      openComposer(draft.input.kind);
    },
  });
}

/** A theme to animate with, and for Custom an instruction already chosen (a suggested motion). */
export interface AnimateRequest {
  theme: string;
  instruction?: string;
  profileId?: string;
  /** Ticked Animate modifiers (`useAnimateModifiers`), run alongside the theme. */
  modifiers?: string[];
}
/** Animate's templates for the account (Library › Templates), Custom last; none without the assistant. */
export function useAnimateTemplates() {
  const assistant = useQuery(assistantQuery).data;
  return assistant?.available ? assistant.themes : [];
}
/** Which Animate modifiers are ticked, per account; pruned to those still offered and capped at three. */
const noModifiers: string[] = [];
const useRememberedModifiers = () => useRemembered("animate-modifiers", noModifiers);
/**
 * Animate's modifiers: the account's enabled ones (Library › Templates), with the remembered
 * ticked IDs pruned to those still offered and capped at `maxModifiers`. `toggle` flips one on or
 * off; a disabled (capped) modifier that isn't already ticked carries why.
 */
export function useAnimateModifiers() {
  const assistant = useQuery(assistantQuery).data;
  const offered = assistant?.available ? (assistant.modifiers ?? []) : [];
  const [remembered, setRemembered] = useRememberedModifiers();
  const ticked = remembered
    .filter((id) => offered.some((item) => item.id === id))
    .slice(0, maxModifiers);
  const toggle = (id: string) =>
    setRemembered((current) => {
      const kept = current.filter((entry) => offered.some((item) => item.id === entry));
      return kept.includes(id)
        ? kept.filter((entry) => entry !== id)
        : kept.length < maxModifiers
          ? [...kept, id]
          : kept;
    });
  const options = offered.map((item) => ({
    ...item,
    checked: ticked.includes(item.id),
    disabled: !ticked.includes(item.id) && ticked.length >= maxModifiers,
  }));
  return {
    offered,
    ticked,
    options,
    toggle,
    settingsAction: (): Action => ({
      id: "animate-modifiers",
      label: "Modifiers",
      menu: [
        options.map((item) => ({
          id: `modifier:${item.id}`,
          label: item.label,
          description: item.description,
          marker: item.uncensored ? icons.uncensored : undefined,
          checked: item.checked,
          disabled: item.disabled,
          keepOpen: true,
          onClick: () => toggle(item.id),
        })),
      ],
    }),
  };
}
export type Iteration =
  | { kind: "regenerate"; prompt?: string; count?: number }
  | { kind: "repeat"; prompt?: string }
  | ({ kind: "animate"; written?: WrittenPrompt } & AnimateRequest)
  | {
      kind: "prompt";
      prompt: string;
      operation: PromptOperation;
      sameSeed?: boolean;
      profileId?: string;
      profileBackend?: string;
    };
/** A motion prompt the assistant wrote for review, as edited: it runs exactly as given. */
export interface WrittenPrompt {
  prompt: string;
  model?: string;
  thinking?: string;
  prepared?: Awaited<ReturnType<typeof mediaDraft>>;
}
/** How a given prompt runs: as Prompt › Edit would (a video animates again), an image edit or its animation. */
type PromptOperation = "image" | "refine" | "animate";

/**
 * Queues a new run from a saved result without leaving the viewer: a new seed (the composer's
 * Count), an exact repeat, an animation whose motion prompt the assistant writes from a theme
 * as the queue item's first stage, or a given prompt. Resolves to the new job's ID.
 */
export function useMediaIteration(item: MediaItem) {
  const iterate = useIterate();
  return useItemMutation(item.id, "iterate", {
    mutationFn: (iteration: Iteration) => iterate(item, iteration),
  });
}

/** `useMediaIteration`'s run for any item, so a selection can iterate each of its items. */
export function useIterate() {
  const client = useQueryClient();
  const videos = useVideosSide();
  const [seconds] = useAnimateLength();
  return async (item: MediaItem, iteration: Iteration) => {
    const animate = iteration.kind === "animate";
    const written = animate ? iteration.written : undefined;
    const modifiers = animate && iteration.modifiers?.length ? iteration.modifiers : undefined;
    const given = iteration.kind === "prompt" ? iteration : undefined;
    const { profile, choice, seed, draft, note } =
      written?.prepared ??
      (await mediaDraft(
        item,
        given?.operation ?? (animate ? "animate" : "image"),
        client,
        videos,
        animate || given?.operation === "animate" ? seconds : undefined,
        animate ? iteration.profileId : given?.profileId,
        given?.profileBackend,
      ));
    // An animation that can't run where the account prefers says where it runs instead.
    if (note || choice?.note) notifications.show({ message: note || choice?.note });
    const prompt = animate ? (written?.prompt ?? "") : (iteration.prompt ?? draft.input.prompt);
    const repeat = iteration.kind === "repeat";
    const sameSeed = repeat || Boolean(given?.sameSeed);
    let count = animate || (given && given.operation !== "image") ? 1 : draft.input.count;
    if (iteration.kind === "regenerate" && iteration.count !== undefined) {
      const run = profileForBackend(
        profile,
        draft.input.profileBackend,
        Boolean(draft.references.length || draft.input.referenceAssets?.length),
        Boolean(draft.input.loras?.length),
      );
      count = Math.min(iteration.count, generationCountLimit(run, draft.input.kind));
    }
    const payload = {
      ...generationInput(
        { ...draft.input, prompt, seed: sameSeed ? (seed ?? "") : "", count },
        profile,
        draft.references,
      ),
      // The queue item writes the motion prompt first (backend/prompt-stage.js), then animates; a
      // reviewed prompt was written already and keeps its record.
      ...(written
        ? {
            writing: {
              kind: "animate",
              prompt: written.prompt,
              model: written.model,
              thinking: written.thinking,
              modifiers,
            },
          }
        : animate
          ? {
              writing: {
                kind: "animate",
                theme: iteration.theme,
                instruction: iteration.instruction,
                modifiers,
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
      draft.sessionId || (await post<{ session: StudioSession }>("/api/sessions")).session.id;
    const result = await post<{ jobId: string; job?: QueueJob }>(
      `/api/sessions/${session}/generations`,
      payload,
    );
    // The strip shows the new run at once; polling then follows its progress.
    if (result.job)
      client.setQueryData(queueQuery.queryKey, (queue) =>
        queue ? { ...queue, jobs: [...queue.jobs, result.job!] } : queue,
      );
    // The gallery reads its first page when the queue changes.
    void client.invalidateQueries({ queryKey: queueQuery.queryKey });
    return result.jobId;
  };
}

/** The prompt Review Prompt shows, with the video model that will run it and whether on Cloud. */
interface AnimateReview extends WrittenPrompt {
  profileLabel: string;
  cloud: boolean;
}

/**
 * Writes Animate's motion prompt without queuing it, for Review Prompt: the same writer as the
 * queue's writing stage (backend/prompt-animate.js), from the same frame and video model.
 */
export function useAnimateWriter(item: MediaItem) {
  const client = useQueryClient();
  const videos = useVideosSide();
  const [seconds] = useAnimateLength();
  return useMutation({
    // Its failure shows in the dialog.
    meta: { inlineError: true },
    mutationFn: async ({
      theme,
      instruction,
      profileId,
      modifiers,
      signal,
    }: AnimateRequest & {
      signal: AbortSignal;
    }): Promise<AnimateReview> => {
      const prepared = await mediaDraft(item, "animate", client, videos, seconds, profileId);
      const { profile, draft } = prepared;
      // The clip's length paces the beats, as in the queue stage: the run's input as it would queue.
      const { duration, frames, fps } = generationInput(
        draft.input,
        profile,
        draft.references,
      ) as Record<string, unknown>;
      const written = await api<WrittenPrompt>("/api/assistant/animate", {
        method: "POST",
        body: JSON.stringify({
          profileId: profile.id,
          theme,
          instruction,
          modifiers,
          source: item.prompt || "",
          extend: item.type === "video",
          assetId: draft.references[0]?.id,
          duration,
          frames,
          fps,
        }),
        signal,
      });
      return {
        prepared,
        prompt: written.prompt,
        model: written.model,
        thinking: written.thinking,
        profileLabel: profileName(profile),
        cloud: isCloudProfile(profile),
      };
    },
  });
}
