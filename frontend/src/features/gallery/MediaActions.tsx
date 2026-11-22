import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Camera,
  Check,
  FastForward,
  Film,
  Flame,
  ImageDown,
  ImagePlus,
  ListChecks,
  Loader,
  type LucideIcon,
  MessagesSquare,
  Repeat,
  Rewind,
  Shuffle,
  Snail,
  SquareCheck,
  TextQuote,
  Waves,
  Wind,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";

import type { CardKind } from "../../../../shared/characters";
import { type VariationDirection, variationDirections } from "../../../../shared/suggestions";
import { post } from "../../api";
import type { MediaItem } from "../../types";
import { type Action, type ActionGroups, ActionMenuItems } from "../../ui/ActionBar";
import { copyText } from "../../ui/clipboard";
import { compareNames } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import { useFlash } from "../../ui/useFlash";
import { usePhone } from "../../ui/usePhone";
import { useGroupFeature } from "../auth/AccountGate";
import { useRemembered } from "../auth/useRemembered";
import { useStartCard } from "../characters/useCardFrom";
import { comparisonMembersQuery, comparisonOf } from "../compare/queries";
import { useStageComparison } from "../compare/variants";
import { assistMenu, changeTemplates, useChangeSuggestions } from "../generation/AskChange";
import { defaultProfile, useGeneration } from "../generation/GenerationProvider";
import { useOpenComposer } from "../generation/openComposer";
import {
  generationCountLimit,
  isProfile,
  profileForBackend,
  takesReferences,
} from "../generation/payload";
import { type AssistantOption, assistantQuery } from "../generation/PromptAssistant";
import { queueQuery, useQueueAction } from "../generation/Queue";
import { useGalleryReference } from "../generation/references";
import {
  askMotionIdeas,
  askNextSteps,
  motionIdeasQuery,
  nextStepsQuery,
} from "../taste/suggestions";
import { AnimateDialog } from "./AnimateDialog";
import { videoGif } from "./download";
import { itemAction, itemActionGroups } from "./itemActions";
import { useSettingsText } from "./MediaDetails";
import { automaticEditProfile, useActionProfile } from "./mediaProfiles";
import type { MediaTransferActions } from "./mediaShare";
import { galleryKey } from "./queries";
import { ReportIssueDialog, issues, useReportIssue } from "./ReportIssueDialog";
import { useUpscaleAction } from "./UpscaleControls";
import { useItemMutation } from "./useItemMutation";
import {
  type AnimateRequest,
  type Iteration,
  animateProfileQuery,
  typedPrompt,
  useAnimateLengthSetting,
  useAnimateReview,
  useAnimateTemplates,
  useMediaAction,
  useMediaIteration,
  useMediaReview,
} from "./useMediaAction";
import { useMediaRating } from "./useMediaRating";
import { useRecreateAction } from "./useRecreate";
import { useTryAgain } from "./useTryAgain";
import { VariationDialog } from "./VariationDialog";
import { directionLabels } from "./variationDraft";
import { type VideoEdit, useVideoEdit } from "./videoEdits";
import { type GalleryState, galleryKind, viewerPath } from "./viewerLink";
import type { ViewerAsk, ViewerChange, ViewerDraftActions } from "./ViewerPrompt";

/**
 * An action whose options come to one runs that option itself, so no submenu holds just one.
 * Animate stays a menu, as its templates load after it shows, and so does AI, which names no
 * action.
 */
function withoutLoneOption(action: Action): Action {
  const options = action.menu?.flat() ?? [];
  if (options.length !== 1 || action.note || ["ai", "animate"].includes(action.id)) return action;
  const [option] = options;
  return {
    ...action,
    menu: undefined,
    link: option.link,
    onClick: option.onClick,
    keepOpen: option.keepOpen,
    disabled: action.disabled || option.disabled,
    loading: action.loading || option.loading,
  };
}

// Seeded templates have their own icons; others share Animate's.
const templateIcons: Record<string, LucideIcon> = {
  cinematic: Camera,
  living: Wind,
  action: Zap,
  dialogue: MessagesSquare,
  spicy: Flame,
  custom: icons.custom,
};

/** A failed item's Retry; the new pending tile replaces it (`onRetried` gets the new job). */
function useRetryAction(
  item: MediaItem,
  retryInStage: boolean,
  onRetried?: (jobId: string) => void,
): Action | null {
  const failed = !retryInStage && item.status === "failed" && Boolean(item.jobId);
  // Only a failed item reads the queue, so others don't re-render on each of its polls.
  const queue = useQuery({ ...queueQuery, subscribed: failed });
  const retry = useQueueAction(item.jobId);
  const tryAgain = useTryAgain([item]);
  if (!failed) return null;
  const job = queue.data?.jobs.find((job) => job.id === item.jobId);
  if (queue.error)
    return itemAction("retry", {
      label: "Reload Status",
      onClick: () => void queue.refetch(),
    });
  if (!job)
    return queue.isPending
      ? itemAction("retry", { label: "Loading Generation Status", icon: Loader, disabled: true })
      : null;
  if (job.status !== "failed") return null;
  return itemAction("retry", {
    disabled: retry.isPending,
    keepOpen: true,
    onClick: async () => {
      const replacement = (await tryAgain([job.id])).get(job.id);
      if (replacement) onRetried?.(replacement);
    },
  });
}

/** The milliseconds into a video the viewer is showing, or undefined (its last frame) elsewhere. */
function viewerFrame(item: MediaItem) {
  const player = document.querySelector<HTMLVideoElement>(
    `video[data-media-id="${CSS.escape(item.id)}"]`,
  );
  return player ? Math.round(player.currentTime * 1000) : undefined;
}

/** Save Frame as Image: the frame a video is showing (else its last) as an image under Uploads. */
function useSaveFrame(item: MediaItem): Action {
  const cache = useQueryClient();
  // Its confirmation, like its progress, shows only on the item saved from.
  const [saved, flash] = useFlash<string>();
  const save = useItemMutation(item.id, "save-frame", {
    mutationFn: () =>
      post("/api/gallery/frame", { galleryItemId: item.id, frame: viewerFrame(item) ?? "last" }),
    onSuccess: () => {
      flash(item.id);
      void cache.invalidateQueries({ queryKey: galleryKey });
    },
  });
  return {
    id: "save-frame",
    label: saved === item.id ? "Saved to Uploads" : "Save Frame as Image",
    icon: saved === item.id ? Check : ImageDown,
    disabled: save.isPending,
    loading: save.isPending,
    keepOpen: true,
    onClick: () => save.mutate(),
  };
}

/**
 * Edit › Use as Reference: adds the image to the composer's references. Where the composer's model
 * takes none, it moves to one that does (the account's default first) and says so. A video gives
 * the frame showing in the viewer, or its last frame from elsewhere.
 */
function useReferenceAction(item: MediaItem, onApplied: () => void): Action | null {
  const { profile, profiles, models, input, selectProfile } = useGeneration();
  const reference = useGalleryReference(item.id);
  const location = useLocation();
  const openComposer = useOpenComposer();
  if (!profile) return null;
  const takes = takesReferences(profile, input.profileBackend);
  const fallback = takes
    ? undefined
    : [defaultProfile(models.data, input.kind), ...profiles].find(
        (candidate) =>
          candidate?.kind === input.kind && candidate.ready !== false && takesReferences(candidate),
      );
  const video = item.type === "video";
  return {
    id: "use-reference",
    label: video ? "Use Frame as Reference" : "Use as Reference",
    icon: ImagePlus,
    disabled: !(takes || fallback) || reference.isPending,
    keepOpen: true,
    onClick: () => {
      if (fallback) selectProfile(fallback);
      reference.mutate(
        { ...item, frame: video ? viewerFrame(item) : undefined },
        {
          onSuccess: () => {
            onApplied();
            const kind = galleryKind(location.pathname);
            if (kind) openComposer(kind);
          },
        },
      );
    },
  };
}

/**
 * Edit › Use as Character, Use as Outfit and Use as Scene: each opens its Library section with a new
 * card started from the image and what its chat called it, where the prompt assistant can describe it.
 */
function useCardActions(item: MediaItem, onApplied: () => void): Action[] {
  const characters = useGroupFeature("characters");
  const startCard = useStartCard();
  if (!characters || item.type !== "image") return [];
  const start = (kind: CardKind) => () => {
    onApplied();
    startCard(kind, item);
  };
  return [
    {
      id: "make-character",
      label: "Use as Character",
      icon: icons.character,
      onClick: start("characters"),
    },
    { id: "make-outfit", label: "Use as Outfit", icon: icons.outfit, onClick: start("outfits") },
    { id: "make-scene", label: "Use as Scene", icon: icons.scene, onClick: start("scenes") },
  ];
}

interface MediaActionOptions {
  transfer: MediaTransferActions;
  compare?: boolean;
  /** The viewer's current draft and its editor. Else a prompt change opens the viewer first. */
  draft?: ViewerDraftActions;
  /** Queues a new run; the viewer's joins its strip. Defaults to queueing it directly. */
  iterate?: (iteration: Iteration) => void;
  onApplied?: () => void;
  onCompare?: () => void;
  /** Opens Animate's dialog: Custom…, or any template or suggested motion under Review Prompt. */
  onAnimate: (choice: AnimateRequest) => void;
  onVary: (
    direction: VariationDirection | "explore",
    prompt: string,
    onApplied: () => void,
  ) => void;
  onDelete: () => void;
  /** Opens Report's Custom… dialog. */
  onReport: () => void;
  onReportQueued?: (jobId: string) => void;
  onRetried?: (jobId: string) => void;
  onVersionChange?: (id: string, active: boolean) => void;
  retryInStage?: boolean;
}

/**
 * The one media action definition for the viewer bar and tile menus: labels, options and
 * availability, placed in their order (itemActions.ts).
 */
export function useMediaActions(
  item: MediaItem,
  {
    transfer,
    compare,
    draft,
    iterate,
    onApplied = () => {},
    onCompare,
    onAnimate,
    onVary,
    onDelete,
    onReport,
    onReportQueued,
    onRetried,
    onVersionChange,
    retryInStage = false,
  }: MediaActionOptions,
): ActionGroups {
  const phone = usePhone();
  const action = useMediaAction(item, onApplied);
  const iteration = useMediaIteration(item);
  const client = useQueryClient();
  const run = iterate ?? ((next: Iteration) => iteration.mutate(next));
  // Runs from the item, also the viewer's own, share its pending state.
  const running = iteration.variables?.kind;
  const stage = useStageComparison();
  const variants = useItemMutation(item.id, "compare", {
    mutationFn: () => stage.fromItem(item).then(onApplied),
  });
  const comparison = comparisonOf(useQuery(comparisonMembersQuery).data, item);
  const settingsText = useSettingsText(item);
  const retry = useRetryAction(item, retryInStage, onRetried);
  const reference = useReferenceAction(item, onApplied);
  const cards = useCardActions(item, onApplied);
  const recreate = useRecreateAction(item, onApplied);
  const changedPrompt = draft?.changedPrompt;
  const variationPrompt = changedPrompt ?? (typedPrompt(item) || item.prompt || "");
  // An upload has only its recorded or suggested prompt to recreate.
  const recreateAction = item.uploaded
    ? recreate
    : {
        id: "prompt-composer",
        label: "Recreate in Composer",
        icon: icons.prompt,
        disabled: action.isPending,
        onClick: () => action.mutate({ operation: "image", prompt: changedPrompt }),
      };
  const saveFrame = useSaveFrame(item);
  const videoEdit = useVideoEdit(item);
  // A video edit's menu stays open while it saves, then its item says so for a moment.
  const [edited, flashEdited] = useFlash<string>();
  const editAction = (
    id: string,
    label: string,
    icon: LucideIcon,
    kind: VideoEdit["kind"],
  ): Action => ({
    id,
    label: edited === `${item.id}:${kind}` ? "Saved as New Version" : label,
    icon: edited === `${item.id}:${kind}` ? Check : icon,
    disabled: videoEdit.isPending,
    keepOpen: true,
    onClick: () =>
      videoEdit.mutate({ kind }, { onSuccess: () => flashEdited(`${item.id}:${kind}`) }),
  });
  const location = useLocation();
  const navigate = useNavigate();
  const rating = useMediaRating(item);
  const report = useReportIssue(item, onReportQueued);
  const ready = item.status === "done" && Boolean(item.url);
  const gif = ready ? videoGif(item) : null;
  const image = ready && item.type === "image";
  const video = ready && item.type === "video";
  const upscale = useUpscaleAction(item, {
    ready,
    compare,
    onCompare,
    onVersionChange,
  });
  const assistant = useQuery(assistantQuery);
  const assisted = Boolean(assistant.data?.available);
  // The queue writes variations of this image or its set with the run's settings.
  const more = useItemMutation(item.id, "more-like", {
    mutationFn: (scope: "image" | "set") =>
      post("/api/result-sets/more", { itemId: item.id, scope }),
    onSuccess: () =>
      void Promise.all(
        [queueQuery.queryKey, galleryKey].map((queryKey) => client.invalidateQueries({ queryKey })),
      ),
  });
  const moreLike: Action[] =
    ready && !item.uploaded && item.jobId && assisted
      ? [
          ...(image && (item.prompt?.trim() || typedPrompt(item).trim())
            ? [
                {
                  id: "more-like-image",
                  label: "More Like This",
                  icon: icons.moreLikeThis,
                  disabled: more.isPending,
                  onClick: () => more.mutate("image"),
                },
              ]
            : []),
          ...(item.resultSet
            ? [
                {
                  id: "more-like-set",
                  label: "More Like This Set",
                  icon: icons.moreLikeThis,
                  disabled: more.isPending,
                  onClick: () => more.mutate("set"),
                },
              ]
            : []),
        ]
      : [];
  // Animate says why no model can run before anything queues.
  const [review, setReview] = useAnimateReview();
  const { menu: animateProfiles, profileId: animationProfileId } = useActionProfile("video");
  const { menu: editProfiles, profileId: selectedEdit, profiles } = useActionProfile("image");
  const [savedCount, setRecreateCount] = useRemembered("recreate-count", 1);
  const original = profiles?.find((profile) =>
    item.settings?.profileId
      ? isProfile(profile, item.settings.profileId)
      : profile.model === item.model,
  );
  const recreateProfile = profileForBackend(
    original,
    typeof item.settings?.profileBackend === "string" ? item.settings.profileBackend : undefined,
    Array.isArray(item.settings?.referenceAssets) && item.settings.referenceAssets.length > 0,
    Array.isArray(item.settings?.loras) && item.settings.loras.length > 0,
  );
  const countLimit = generationCountLimit(recreateProfile, item.type);
  const recreateCount = Math.min(savedCount, countLimit);
  const automaticEdit = image && automaticEditProfile(profiles || [], item);
  const editProfileId =
    selectedEdit ||
    (automaticEdit &&
    (item.settings?.profileId
      ? automaticEdit.id !== item.settings.profileId
      : automaticEdit.model !== item.model)
      ? automaticEdit.id
      : undefined);
  const length = useAnimateLengthSetting(item, animationProfileId);
  const animation = useQuery({
    ...animateProfileQuery(item, animationProfileId),
    enabled: image || video,
    placeholderData: keepPreviousData,
  });
  // Nothing can animate: say why.
  const refusal = animation.error?.message;
  // A video's templates continue the clip from its last frame at once; it keeps the clip's own
  // model unless videos run on Cloud.
  const animateDisabled =
    action.isPending ||
    length.loading ||
    ((!video || Boolean(animationProfileId)) && !animation.data);
  const templates = useAnimateTemplates();
  const templateItem = (template: AssistantOption): Action => ({
    id: `animate-${template.id}`,
    label: `${template.label}${template.id === "custom" ? "…" : ""}`,
    icon: templateIcons[template.id] ?? icons.animate,
    disabled: animateDisabled,
    onClick:
      template.id === "custom" || review
        ? () => onAnimate({ theme: template.id, profileId: animationProfileId })
        : () => run({ kind: "animate", theme: template.id, profileId: animationProfileId }),
  });
  // Load the image's saved motions when its Animate menu opens.
  const [motionsFor, setMotionsFor] = useState<string>();
  const motions = useChangeSuggestions({
    query: motionIdeasQuery(item.jobId ?? "", item.id),
    fresh: () => askMotionIdeas(item.jobId!, true, item.id),
    enabled: motionsFor === item.id,
    disabled: animateDisabled,
    onPick: (instruction) =>
      review
        ? onAnimate({ theme: "custom", instruction, profileId: animationProfileId })
        : run({ kind: "animate", theme: "custom", instruction, profileId: animationProfileId }),
  });
  const motionsOffered = image && Boolean(item.jobId && assisted);
  // Templates write the prompt into an editable review before anything queues.
  const reviewItems = assisted
    ? [
        {
          id: "animate-review",
          label: "Review Prompt",
          icon: icons.review,
          checked: review,
          keepOpen: true,
          onClick: () => setReview(!review),
        },
      ]
    : [];
  // A tile starts the same prompt change by opening the item's viewer.
  const openViewer = (mode: ViewerChange, change: ViewerAsk["change"], profileId?: string) => {
    onApplied();
    const { chat, set, show, similar, turn } = (location.state as GalleryState | null) || {};
    navigate(viewerPath(item), {
      state: {
        chat,
        set,
        show,
        similar,
        turn,
        viewer: true,
        ask: { itemId: item.id, action: mode, change, profileId } satisfies ViewerAsk,
      },
    });
  };
  const pick = (mode: ViewerChange, request: string) => {
    const profileId = mode === "edit" ? editProfileId : undefined;
    return draft ? draft.pick(mode, request, profileId) : openViewer(mode, { request }, profileId);
  };
  const custom = (mode: ViewerChange) => {
    const profileId = mode === "edit" ? editProfileId : undefined;
    return draft ? draft.custom(mode, profileId) : openViewer(mode, { custom: true }, profileId);
  };
  const [reviewChanges, setReviewChanges] = useMediaReview();
  const canChange = ready && !item.uploaded && Boolean(item.jobId);
  const assistedChanges = canChange && assisted;
  // Capture a viewer's draft only when its menu opens, so typing doesn't ask for new suggestions.
  const [suggestions, setSuggestions] = useState<{
    id: string;
    mode: ViewerChange;
    prompt?: string;
  }>();
  const suggestionPrompt = suggestions?.id === item.id ? suggestions.prompt : undefined;
  const steps = useChangeSuggestions({
    query: nextStepsQuery(item.jobId ?? "", suggestionPrompt, item.id),
    fresh: () => askNextSteps(item.jobId!, true, suggestionPrompt, item.id),
    enabled: assistedChanges && suggestions?.id === item.id,
    disabled: draft?.pending,
    onPick: (request) => {
      if (suggestions && !draft?.pending) pick(suggestions.mode, request);
    },
  });
  const openChanges = (mode: ViewerChange) => () =>
    setSuggestions({ id: item.id, mode, prompt: draft?.suggestionPrompt });
  const changeMenu = (mode: ViewerChange, others: ActionGroups, last: Action[]) =>
    assistMenu({
      expandable: phone,
      settings: [
        ...(mode === "edit" ? editProfiles : []),
        ...(mode === "recreate" && countLimit > 1
          ? [
              {
                id: "recreate-count",
                label: "Count",
                choice: {
                  label: "Count",
                  value: String(recreateCount),
                  options: Array.from({ length: countLimit }, (_, index) => {
                    const count = String(index + 1);
                    return { value: count, label: count };
                  }),
                  onChange: (value: string) => setRecreateCount(Number(value)),
                },
              },
            ]
          : []),
        ...(assistedChanges
          ? [
              {
                id: "review",
                label: "Review Prompt",
                icon: icons.review,
                checked: reviewChanges,
                keepOpen: true,
                onClick: () => setReviewChanges(!reviewChanges),
              },
            ]
          : []),
      ],
      suggestions: assistedChanges ? steps : undefined,
      ...(assistedChanges
        ? changeTemplates(
            assistant.data?.changes ?? [],
            (request) => pick(mode, request),
            () => custom(mode),
            draft?.pending,
          )
        : { templates: [] }),
      others,
      last,
    });
  // The assistant and the animate offers decide every option, so they show together.
  const optionsLoading = assistant.isPending || animation.isPending;
  // Discovery from this image, A–Z: More Like This, the gallery ranked by likeness to it
  // (GalleryPage reads `similar`), and its comparisons.
  const discovery: Action[] = [
    ...(image && assistedChanges && variationPrompt.trim()
      ? [
          {
            id: "keep-and-vary",
            label: "Keep & Vary",
            icon: icons.assistant,
            menu: [
              variationDirections.map((direction) => ({
                id: `vary-${direction}`,
                label: `Vary ${directionLabels[direction]}`,
                onClick: () => onVary(direction, variationPrompt, onApplied),
              })),
              [
                {
                  id: "explore-three-directions",
                  label: "Explore Three Directions",
                  icon: icons.compare,
                  onClick: () => onVary("explore", variationPrompt, onApplied),
                },
              ],
            ],
          },
        ]
      : []),
    ...moreLike,
    ...(image
      ? [
          {
            id: "similar",
            label: "Similar",
            icon: icons.similar,
            onClick: () => {
              onApplied();
              navigate("/images", { state: { similar: item.id } satisfies GalleryState });
            },
          },
        ]
      : []),
    ...(image && comparison
      ? [
          {
            id: "open-comparison",
            label: "Open Comparison",
            icon: icons.compareSideBySide,
            onClick: () => {
              onApplied();
              navigate(`/compare/${comparison}`);
            },
          },
        ]
      : []),
  ].sort((a, b) => compareNames(String(a.label), String(b.label)));
  const actions = [
    retry,
    (image || video) &&
      itemAction("animate", {
        loading: running === "animate" || action.isPending,
        // When nothing can animate, the options stay disabled and the note says why.
        note: refusal,
        onOpen: motionsOffered ? () => setMotionsFor(item.id) : undefined,
        menu: assistMenu({
          loading: optionsLoading,
          expandable: phone,
          settings: [length, ...animateProfiles, ...reviewItems],
          suggestions: motionsOffered ? motions : undefined,
          templates: templates.filter((template) => template.id !== "custom").map(templateItem),
          custom: templates.filter((template) => template.id === "custom").map(templateItem),
          last: [
            video
              ? {
                  id: "extend",
                  label: "Extend in Composer",
                  icon: FastForward,
                  disabled: animateDisabled,
                  onClick: () =>
                    action.mutate({ operation: "extend", profileId: animationProfileId }),
                }
              : {
                  id: "animate-composer",
                  label: "Animate in Composer",
                  icon: icons.prompt,
                  disabled: animateDisabled,
                  onClick: () =>
                    action.mutate({ operation: "animate", profileId: animationProfileId }),
                },
          ],
        }),
      }),
    // An image edit uses the result as its reference. A video's Edit saves a new version.
    ready &&
      itemAction("edit", {
        loading: videoEdit.isPending,
        onOpen: image && canChange ? openChanges("edit") : undefined,
        menu: image
          ? changeMenu(
              "edit",
              [[...cards.slice(0, 2), ...(reference ? [reference] : []), ...cards.slice(2)]],
              [
                {
                  id: "edit-image",
                  label: "Edit in Composer",
                  icon: icons.edit,
                  disabled: action.isPending,
                  onClick: () =>
                    action.mutate({
                      operation: "refine",
                      prompt: changedPrompt,
                      profileId: editProfileId,
                    }),
                },
              ],
            )
          : [
              [saveFrame, ...(reference ? [reference] : [])],
              [
                editAction("back-and-forth", "Back & Forth", ArrowLeftRight, "loop"),
                editAction("reverse", "Reverse", Rewind, "reverse"),
                editAction("slow-motion", "Slow Motion", Snail, "slow"),
                editAction("smooth-motion", "Smooth Motion", Waves, "smooth"),
              ],
            ],
      }),
    // Recreate uses the draft prompt with the recorded settings, preserving the original inputs.
    itemAction(ready ? "recreate" : "edit", {
      disabled: !ready && action.isPending,
      loading: running === "regenerate" || running === "repeat" || variants.isPending,
      onClick: ready
        ? undefined
        : () => action.mutate({ operation: "image", prompt: changedPrompt }),
      onOpen: canChange ? openChanges("recreate") : undefined,
      menu: !ready
        ? undefined
        : item.uploaded
          ? [[recreateAction]]
          : changeMenu(
              "recreate",
              [
                [
                  {
                    id: "new-seed",
                    label: "Run Again",
                    icon: Shuffle,
                    disabled: changedPrompt === "",
                    onClick: () =>
                      run({ kind: "regenerate", prompt: changedPrompt, count: recreateCount }),
                  },
                  {
                    id: "exact-repeat",
                    label: "Run Again, Same Seed",
                    icon: Repeat,
                    disabled: changedPrompt === "",
                    onClick: () => run({ kind: "repeat", prompt: changedPrompt }),
                  },
                ],
              ],
              [
                ...(image
                  ? [
                      {
                        id: "compare-models",
                        label: "Compare in Composer",
                        icon: icons.compare,
                        disabled: variants.isPending,
                        loading: variants.isPending,
                        onClick: () => variants.mutate(),
                      },
                    ]
                  : []),
                recreateAction,
              ],
            ),
    }),
    upscale,
    discovery.length > 0 && itemAction("ai", { menu: [discovery] }),
    ready &&
      itemAction("like", {
        pressed: item.rating === "liked",
        onClick: rating.like,
      }),
    // In the Disliked view, a disliked item's Dislike restores it.
    ready &&
      itemAction("dislike", {
        pressed: item.rating === "disliked",
        onClick: rating.dislike,
      }),
    ready &&
      !item.uploaded &&
      item.jobId &&
      assisted &&
      itemAction("report", {
        loading: report.isPending,
        menu: [
          issues.map((issue) => ({
            id: `report:${issue}`,
            label: issue,
            icon: icons.assistant,
            disabled: report.isPending,
            onClick: () => report.mutate(issue),
          })),
          [{ id: "report-custom", label: "Custom…", icon: icons.custom, onClick: onReport }],
        ],
      }),
    itemAction("share", {
      menu: [
        [
          {
            id: "copy-details",
            label: "Copy Details",
            icon: ListChecks,
            onClick: () => void copyText(settingsText(), "Details"),
          },
          {
            id: "copy-prompt",
            label: "Copy Prompt",
            icon: TextQuote,
            onClick: () => void copyText(item.prompt || "", "Prompt"),
          },
          // A video also downloads as a GIF, beside it rather than in a submenu.
          ...(gif ? [{ id: "download-gif", label: "Download GIF", icon: Film, link: gif }] : []),
          ...(ready
            ? [
                {
                  id: "download",
                  label: gif ? "Download Video" : "Download",
                  icon: icons.download,
                  link: transfer.download,
                },
              ]
            : []),
          // Phones that share natively also share it as a file.
          ...(ready && transfer.canShare
            ? [
                {
                  id: "share-file",
                  label: "Share",
                  icon: icons.share,
                  disabled: transfer.sharing,
                  loading: transfer.sharing,
                  keepOpen: !transfer.shareReady,
                  onClick: () => void transfer.share(),
                },
              ]
            : []),
        ],
      ],
    }),
    itemAction("delete", { onClick: onDelete }),
  ];
  return itemActionGroups(
    actions.filter((entry): entry is Action => !!entry).map(withoutLoneOption),
  );
}

/**
 * Animate's and Report's dialogs for an item's actions: spread the handlers into its
 * options and render `dialogs` where they outlive a closing menu.
 */
export function useMediaDialogs(
  item: MediaItem,
  iterate?: (iteration: Iteration) => void,
  onReportQueued?: (jobId: string) => void,
) {
  const [animating, setAnimating] = useState<AnimateRequest | null>(null);
  const [reporting, setReporting] = useState(false);
  const [varying, setVarying] = useState<{
    direction: VariationDirection | "explore";
    prompt: string;
    onApplied: () => void;
  }>();
  return {
    handlers: {
      onAnimate: setAnimating,
      onReport: () => setReporting(true),
      onVary: (direction: VariationDirection | "explore", prompt: string, onApplied: () => void) =>
        setVarying({ direction, prompt, onApplied }),
      onReportQueued,
    },
    dialogs: (
      <>
        {animating && (
          <AnimateDialog
            item={item}
            iterate={iterate}
            {...animating}
            onClose={() => setAnimating(null)}
          />
        )}
        {reporting && (
          <ReportIssueDialog
            item={item}
            onQueued={onReportQueued}
            onClose={() => setReporting(false)}
          />
        )}
        {varying && (
          <VariationDialog item={item} {...varying} onClose={() => setVarying(undefined)} />
        )}
      </>
    ),
  };
}

/**
 * The shared actions as menu items, mounted while a menu is open; a gallery tile's menu starts with
 * Select, alone, which starts selecting with its item selected.
 */
export function MediaActionMenu({
  item,
  onSelect,
  ...options
}: MediaActionOptions & { item: MediaItem; onSelect?: () => void }) {
  const groups = useMediaActions(item, options).flatMap((group) =>
    group.some(({ id }) => id === "ai" || id === "share")
      ? group.map((action) => action.menu?.flat() ?? [action])
      : [group],
  );
  return (
    <ActionMenuItems
      groups={
        onSelect
          ? [[{ id: "select", label: "Select", icon: SquareCheck, onClick: onSelect }], ...groups]
          : groups
      }
    />
  );
}
