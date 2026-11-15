import { notifications } from "@mantine/notifications";
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
  Scissors,
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
import { post } from "../../api";
import type { MediaItem, Profile } from "../../types";
import { type Action, type ActionGroups, ActionMenuItems } from "../../ui/ActionBar";
import { copyText } from "../../ui/clipboard";
import { icons } from "../../ui/icons";
import { useFlash } from "../../ui/useFlash";
import { useGroupFeature } from "../auth/AccountGate";
import { comparisonMembersQuery, comparisonOf } from "../compare/queries";
import { useStageComparison } from "../compare/variants";
import { assistMenu, useChangeSuggestions } from "../generation/AskChange";
import { defaultProfile, useGeneration } from "../generation/GenerationProvider";
import { useOpenComposer } from "../generation/openComposer";
import { profileForBackend, profileName } from "../generation/payload";
import { type AssistantOption, assistantQuery } from "../generation/PromptAssistant";
import { queueQuery, useQueueAction } from "../generation/Queue";
import { useGalleryReference } from "../generation/references";
import {
  type VideosPreference,
  showQueued,
  useVideosPreference,
} from "../settings/accountPreferences";
import {
  askMotionIdeas,
  askNextSteps,
  motionIdeasQuery,
  nextStepsQuery,
} from "../taste/suggestions";
import { videoExport } from "./download";
import { itemAction, itemActionGroups } from "./itemActions";
import { useSettingsText } from "./MediaDetails";
import type { MediaTransferActions } from "./mediaShare";
import { useUpscaleAction } from "./UpscaleControls";
import { useItemMutation } from "./useItemMutation";
import {
  type AnimateOffers,
  type AnimateRequest,
  type EditAsk,
  type Iteration,
  animateProfileQuery,
  useAnimateReview,
  useAnimateTemplates,
  useEditReview,
  useMediaAction,
  useMediaIteration,
} from "./useMediaAction";
import { useMediaRating } from "./useMediaRating";
import { useRecreateAction } from "./useRecreate";
import { useTryAgain } from "./useTryAgain";
import { type VideoEdit, useVideoEdit } from "./videoEdits";
import type { ViewerAsk } from "./ViewerPrompt";

/**
 * An action whose options come to one runs that option itself, so no submenu holds just one.
 * Animate stays a menu, as its templates load after it shows.
 */
function withoutLoneOption(action: Action): Action {
  const options = action.menu?.flat() ?? [];
  if (options.length !== 1 || action.note || action.id === "animate") return action;
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
function useRetryAction(item: MediaItem, onRetried?: (jobId: string) => void): Action | null {
  const failed = item.status === "failed" && Boolean(item.jobId);
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
      void cache.invalidateQueries({ queryKey: ["gallery"] });
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

/** Whether a run with references on `profile` takes them: any of a combined profile's backends may. */
function takesReferences(profile: Profile | undefined, backend?: string) {
  const run = profileForBackend(profile, backend, true);
  return Boolean(
    run && (run.mediaInputs?.length || run.capabilities.img2img || run.capabilities.imageInput),
  );
}

/**
 * Edit › Use as Reference: adds the image to the composer's references. Where the composer's model
 * takes none, it moves to one that does (the account's default first) and says so. A video gives
 * the frame showing in the viewer, or its last frame from elsewhere.
 */
function useReferenceAction(item: MediaItem, onApplied: () => void): Action | null {
  const { profile, profiles, models, input, selectProfile } = useGeneration();
  const reference = useGalleryReference();
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
      if (fallback) {
        selectProfile(fallback);
        notifications.show({
          message: `${profileName(profile)} takes no references, so the composer uses ${profileName(fallback)}.`,
        });
      }
      reference.mutate(
        { ...item, frame: video ? viewerFrame(item) : undefined },
        {
          onSuccess: () => {
            onApplied();
            if (["/images", "/video"].includes(location.pathname))
              openComposer(location.pathname === "/video" ? "video" : "image");
          },
        },
      );
    },
  };
}

/**
 * Edit › Use as Character, Use as Outfit and Use as Scene: each opens its Library section with a new
 * card started from the image, where the prompt assistant can describe it.
 */
function useCardActions(item: MediaItem, onApplied: () => void): Action[] {
  const characters = useGroupFeature("characters");
  const location = useLocation();
  const navigate = useNavigate();
  if (!characters || item.type !== "image") return [];
  const start = (kind: CardKind) => () => {
    onApplied();
    navigate(`/library#${kind}`, {
      state: {
        // The gallery under Library, without its viewer.
        backgroundLocation: location.state?.backgroundLocation || {
          ...location,
          search: location.search.replace(/[?&]item=[^&]*/, "").replace(/^&/, "?"),
        },
        cardFrom: item.id,
      },
    });
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
  /** How Edit asks for a change: the viewer's prompt. Without it, Edit's choices open the viewer. */
  edit?: EditAsk;
  /** Queues a new run; the viewer's joins its strip. Defaults to queueing it directly. */
  iterate?: (iteration: Iteration) => void;
  onApplied?: () => void;
  onCompare?: () => void;
  /** Opens Animate's dialog: Custom…, or any template or suggested motion under Review Prompt. */
  onAnimate: (choice: AnimateRequest) => void;
  onDelete: () => void;
  /** Opens Report's dialog. */
  onReport: () => void;
  onRetried?: (jobId: string) => void;
  onTrim: () => void;
  onVersionChange?: (id: string, active: boolean) => void;
}

/**
 * The one media action definition for the viewer bar and tile menus: labels, options and
 * availability, placed in a bar's or a menu's order (itemActions.ts).
 */
export function useMediaActions(
  item: MediaItem,
  {
    transfer,
    compare,
    edit,
    iterate,
    onApplied = () => {},
    onCompare,
    onAnimate,
    onDelete,
    onReport,
    onRetried,
    onTrim,
    onVersionChange,
  }: MediaActionOptions,
  layout: "bar" | "menu" = "bar",
): ActionGroups {
  const action = useMediaAction(item, onApplied);
  const iteration = useMediaIteration(item);
  const client = useQueryClient();
  // Outside the viewer, whose strip shows the run, nothing else may.
  const run =
    iterate ??
    ((next: Iteration) => iteration.mutate(next, { onSuccess: () => showQueued(client) }));
  // Runs from the item, also the viewer's own, share its pending state.
  const running = iteration.variables?.kind;
  const stage = useStageComparison();
  const variants = useItemMutation(item.id, "compare", {
    mutationFn: () => stage.fromItem(item).then(onApplied),
  });
  const comparison = comparisonOf(useQuery(comparisonMembersQuery).data, item);
  const settingsText = useSettingsText(item);
  const retry = useRetryAction(item, onRetried);
  const reference = useReferenceAction(item, onApplied);
  const cards = useCardActions(item, onApplied);
  const recreate = useRecreateAction(item, onApplied);
  // An upload has only its suggested prompt to recreate.
  const recreateAction = item.uploaded
    ? recreate
    : {
        id: "prompt-composer",
        label: "Recreate in Composer",
        icon: icons.prompt,
        disabled: action.isPending,
        onClick: () => action.mutate("image"),
      };
  const saveFrame = useSaveFrame(item);
  const videoEdit = useVideoEdit(item);
  // A video edit's menu stays open while it saves, then its item says so for a moment.
  const [edited, flashEdited] = useFlash<string>();
  const editAction = (
    id: string,
    label: string,
    icon: LucideIcon,
    kind: Exclude<VideoEdit["kind"], "trim">,
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
  const ready = item.status === "done" && Boolean(item.url);
  const gif = ready ? videoExport(item, "gif") : null;
  const loop = ready ? videoExport(item, "loop") : null;
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
  // The assistant writes new variations into the item's MCP result set, in the queue.
  const moreSet = useItemMutation(item.id, "more-like-set", {
    mutationFn: () => post("/api/result-sets/more", { itemId: item.id }),
    onSuccess: () =>
      void Promise.all(
        [queueQuery.queryKey, ["gallery"]].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
  const moreLikeSet: Action[] =
    ready && !item.uploaded && item.resultSet && assisted
      ? [
          {
            id: "more-like-set",
            label: "More Like This Set",
            icon: icons.suggestions,
            disabled: moreSet.isPending,
            onClick: () => moreSet.mutate(),
          },
        ]
      : [];
  // Animate says why no model can run before anything queues.
  const [videos, setVideos] = useVideosPreference();
  const [review, setReview] = useAnimateReview();
  // The menu keeps its choice while a switch loads.
  const animation = useQuery({
    ...animateProfileQuery(item),
    enabled: image || video,
    placeholderData: keepPreviousData,
  });
  // A refusal still says what is offered.
  const offers =
    animation.data?.offers ??
    (animation.error?.cause as { offers?: AnimateOffers } | undefined)?.offers;
  const offered = (["cloud", "fast", "quality"] as const).filter((value) => offers?.[value]);
  // Where the account prefers videos to run (also in Settings), where there is more than one place.
  // Unsaved or no longer offered, it shows Fast where the account has local video, else Cloud.
  const local = offers?.fast ? "fast" : offers?.quality ? "quality" : "cloud";
  const modelChoice =
    offered.length > 1
      ? [
          {
            id: "animate-model",
            label: "Cloud, Fast or Quality",
            icon: icons.animate,
            choice: {
              value: videos && offers?.[videos] ? videos : local,
              options: offered.map((value) => ({
                value,
                label: { cloud: "Cloud", fast: "Fast", quality: "Quality" }[value],
              })),
              onChange: (value: string) => setVideos(value as VideosPreference),
            },
          },
        ]
      : [];
  // Nothing can animate: say why.
  const refusal = animation.error?.message;
  // A video's templates continue the clip from its last frame at once; it keeps the clip's own
  // model unless videos run on Cloud.
  const animateDisabled = video ? action.isPending : !animation.data;
  const templates = useAnimateTemplates();
  const templateItem = (template: AssistantOption): Action => ({
    id: `animate-${template.id}`,
    label: `${template.label}${template.id === "custom" ? "…" : ""}`,
    icon: templateIcons[template.id] ?? icons.animate,
    disabled: animateDisabled,
    onClick:
      template.id === "custom" || review
        ? () => onAnimate({ theme: template.id })
        : () => run({ kind: "animate", theme: template.id }),
  });
  // Motions written for this image, asked for only once its Animate menu opens.
  const [motionsFor, setMotionsFor] = useState<string>();
  const motions = useChangeSuggestions({
    query: motionIdeasQuery(item.jobId ?? ""),
    fresh: () => askMotionIdeas(item.jobId!, true),
    enabled: motionsFor === item.id,
    disabled: !animation.data,
    onPick: (instruction) =>
      review
        ? onAnimate({ theme: "custom", instruction })
        : run({ kind: "animate", theme: "custom", instruction }),
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
  // Edit asks the assistant for a change: in the viewer's prompt, or elsewhere by opening the
  // viewer to ask there (GalleryPage's `item`, ViewerPrompt's `ask`).
  const openViewer = (ask: ViewerAsk) => {
    onApplied();
    const search = new URLSearchParams(location.search);
    search.set("item", item.id);
    navigate({ search: `?${search}` }, { state: { viewer: true, ask } });
  };
  const editAsk: EditAsk = edit ?? {
    pending: false,
    pick: (request) => openViewer({ request }),
    custom: () => openViewer({ custom: true }),
  };
  const [editReview, setEditReview] = useEditReview();
  const editAssisted = assisted && ready && Boolean(item.jobId);
  // The image's next steps load as the viewer opens it, elsewhere once Edit opens.
  const [stepsFor, setStepsFor] = useState<string>();
  const steps = useChangeSuggestions({
    query: nextStepsQuery(item.jobId ?? ""),
    fresh: () => askNextSteps(item.jobId!, true),
    enabled: editAssisted && image && (Boolean(edit) || stepsFor === item.id),
    disabled: editAsk.pending,
    onPick: editAsk.pick,
  });
  // The assistant and the animate offers decide every option, so they show together.
  const optionsLoading = assistant.isPending || animation.isPending;
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
          settings: [...modelChoice, ...reviewItems],
          suggestions: motionsOffered ? motions.group : [],
          templates: templates.filter((template) => template.id !== "custom").map(templateItem),
          custom: templates.filter((template) => template.id === "custom").map(templateItem),
          last: [
            video
              ? {
                  id: "extend",
                  label: "Extend in Composer",
                  icon: FastForward,
                  disabled: animateDisabled,
                  onClick: () => action.mutate("extend"),
                }
              : {
                  id: "animate-composer",
                  label: "Animate in Composer",
                  icon: icons.prompt,
                  disabled: animateDisabled,
                  onClick: () => action.mutate("animate"),
                },
          ],
        }),
      }),
    // Edit asks the assistant for a change, reuses the item elsewhere, or for a video saves an
    // edit as a new version, the original staying.
    ready &&
      itemAction("edit", {
        loading: videoEdit.isPending || editAsk.pending,
        onOpen: image && !edit ? () => setStepsFor(item.id) : undefined,
        menu: assistMenu({
          loading: assistant.isPending,
          settings: editAssisted
            ? [
                {
                  id: "review",
                  label: "Review Prompt",
                  icon: icons.review,
                  checked: editReview,
                  keepOpen: true,
                  onClick: () => setEditReview(!editReview),
                },
              ]
            : [],
          suggestions: editAssisted && image ? steps.group : [],
          // Library's fixed changes, asked for as a suggestion's request is.
          templates: editAssisted
            ? (assistant.data?.changes ?? []).map((change) => ({
                id: `change:${change.id}`,
                label: change.label,
                icon: icons.suggestions,
                disabled: editAsk.pending,
                onClick: () => editAsk.pick(change.instruction),
              }))
            : [],
          custom: editAssisted
            ? [
                {
                  id: "custom",
                  label: "Custom…",
                  icon: icons.custom,
                  disabled: editAsk.pending,
                  onClick: editAsk.custom,
                },
              ]
            : [],
          others: image
            ? [[...cards.slice(0, 2), ...(reference ? [reference] : []), ...cards.slice(2)]]
            : [
                [saveFrame, ...(reference ? [reference] : [])],
                [
                  editAction("back-and-forth", "Back & Forth", ArrowLeftRight, "loop"),
                  editAction("reverse", "Reverse", Rewind, "reverse"),
                  editAction("slow-motion", "Slow Motion", Snail, "slow"),
                  editAction("smooth-motion", "Smooth Motion", Waves, "smooth"),
                  { id: "trim", label: "Trim…", icon: Scissors, onClick: onTrim },
                ],
              ],
          last: image
            ? [
                {
                  id: "edit-image",
                  label: "Edit in Composer",
                  icon: icons.edit,
                  disabled: action.isPending,
                  onClick: () => action.mutate("refine"),
                },
              ]
            : [],
        }),
      }),
    // Recreate runs the item again from here, compares it or makes more of its set, then opens it
    // in the composer. An upload has only its suggested prompt; unfinished work opens its prompt.
    itemAction("recreate", {
      disabled: !ready && action.isPending,
      loading: running === "regenerate" || running === "repeat" || variants.isPending,
      onClick: ready ? undefined : () => action.mutate("image"),
      menu: ready
        ? [
            item.uploaded
              ? []
              : [
                  {
                    id: "new-seed",
                    label: "Run Again",
                    icon: Shuffle,
                    onClick: () => run({ kind: "regenerate" }),
                  },
                  {
                    id: "exact-repeat",
                    label: "Run Again, Same Seed",
                    icon: Repeat,
                    onClick: () => run({ kind: "repeat" }),
                  },
                ],
            [
              // Compare Models stages this image's prompt across models in the composer; Open
              // Comparison shows the side-by-side view it belongs to.
              ...(image
                ? [
                    {
                      id: "compare-models",
                      label: "Compare Models",
                      icon: icons.compare,
                      disabled: variants.isPending,
                      onClick: () => variants.mutate(),
                    },
                  ]
                : []),
              ...moreLikeSet,
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
            ],
            [recreateAction],
          ]
        : undefined,
    }),
    upscale,
    ready &&
      itemAction("like", {
        label: item.rating === "liked" ? "Unlike" : "Like",
        pressed: item.rating === "liked",
        disabled: rating.isPending,
        onClick: rating.like,
      }),
    // In the Disliked view, a disliked item's Dislike restores it.
    ready &&
      itemAction("dislike", {
        label: item.rating === "disliked" ? "Restore" : "Dislike",
        pressed: item.rating === "disliked",
        disabled: rating.isPending,
        onClick: rating.dislike,
      }),
    ready &&
      !item.uploaded &&
      item.jobId &&
      assisted &&
      itemAction("report", { onClick: onReport }),
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
          ...(ready
            ? [
                {
                  id: "download",
                  label: "Download",
                  icon: icons.download,
                  link: gif && loop ? undefined : transfer.download,
                  menu:
                    gif && loop
                      ? [
                          [
                            {
                              id: "download-video",
                              label: "Video",
                              icon: icons.download,
                              link: transfer.download,
                            },
                            { id: "download-gif", label: "GIF", icon: Film, link: gif },
                            {
                              id: "download-loop",
                              label: "Back & Forth",
                              icon: ArrowLeftRight,
                              link: loop,
                            },
                          ],
                        ]
                      : undefined,
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
    // The gallery ranked by likeness to this image (GalleryPage reads `similar`).
    image &&
      itemAction("similar", {
        onClick: () => {
          onApplied();
          navigate(`/images?${new URLSearchParams({ similar: item.id })}`);
        },
      }),
    itemAction("delete", { onClick: onDelete }),
  ];
  return itemActionGroups(
    actions.filter((entry): entry is Action => !!entry).map(withoutLoneOption),
    layout,
  );
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
  const groups = useMediaActions(item, options, "menu");
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
