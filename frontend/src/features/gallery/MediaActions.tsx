import {
  ArrowLeftRight,
  Camera,
  Check,
  FastForward,
  Film,
  ImageDown,
  Flame,
  ImagePlus,
  ListChecks,
  MessagesSquare,
  Loader,
  PenLine,
  Repeat,
  Rewind,
  ScanText,
  Scissors,
  Shuffle,
  Snail,
  TextQuote,
  Waves,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { notifications } from "@mantine/notifications";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { useOpenComposer } from "../generation/openComposer";
import { post } from "../../api";
import type { MediaItem } from "../../types";
import { copyText } from "../../ui/clipboard";
import { icons } from "../../ui/icons";
import { useFlash } from "../../ui/useFlash";
import { useGroupFeature } from "../auth/AccountGate";
import { useCompare } from "../compare/CompareDialog";
import { useGeneration } from "../generation/GenerationProvider";
import { assistantQuery } from "../generation/PromptAssistant";
import { queueQuery, useQueue, useQueueAction } from "../generation/Queue";
import { useGalleryReference } from "../generation/references";
import { ActionMenuItems, type Action, type ActionGroups } from "../../ui/ActionBar";
import { videoExport } from "./download";
import { useSettingsText } from "./MediaDetails";
import type { MediaTransferActions } from "./mediaShare";
import { itemAction, itemActionGroups } from "./itemActions";
import { useStopUpscale, useUpscaleAction } from "./UpscaleControls";
import {
  animateProfileQuery,
  animateThemes,
  useAnimateReview,
  useMediaAction,
  useMediaIteration,
  type AnimateOffers,
  type AnimateTheme,
  type Iteration,
} from "./useMediaAction";
import { useItemMutation } from "./useItemMutation";
import { useMediaFavorite } from "./useMediaFavorite";
import { useRecreateAction } from "./useRecreate";
import {
  showQueued,
  useVideosPreference,
  type VideosPreference,
} from "../settings/accountPreferences";
import { useVideoEdit, type VideoEdit } from "./videoEdits";
import { useTryAgain } from "./useTryAgain";

/** An action whose options come to one runs that option itself, so no submenu holds just one. */
function withoutLoneOption(action: Action): Action {
  const options = action.menu?.flat() ?? [];
  if (options.length !== 1 || action.note) return action;
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

const themeIcons: Record<AnimateTheme, typeof Camera> = {
  cinematic: Camera,
  living: Wind,
  action: Zap,
  dialogue: MessagesSquare,
  spicy: Flame,
  custom: PenLine,
};

/** A failed item's Retry; the new pending tile replaces it (`onRetried` gets the new job). */
function useRetryAction(item: MediaItem, onRetried?: (jobId: string) => void): Action | null {
  const queue = useQueue();
  const retry = useQueueAction(item.jobId);
  const tryAgain = useTryAgain([item]);
  if (item.status !== "failed" || !item.jobId) return null;
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
    onError: (error) => notifications.show({ color: "red", message: error.message }),
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
 * Edit › Use as Reference: adds the image to the composer's references when its profile takes one.
 * A video gives the frame showing in the viewer, or its last frame from elsewhere.
 */
function useReferenceAction(item: MediaItem, onApplied: () => void): Action | null {
  const { profile } = useGeneration();
  const reference = useGalleryReference();
  const location = useLocation();
  const openComposer = useOpenComposer();
  if (
    !(
      profile?.mediaInputs?.length ||
      profile?.capabilities.img2img ||
      profile?.capabilities.imageInput
    )
  )
    return null;
  const video = item.type === "video";
  return {
    id: "use-reference",
    label: video ? "Use Frame as Reference" : "Use as Reference",
    icon: ImagePlus,
    disabled: reference.isPending,
    keepOpen: true,
    onClick: () => {
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
 * Edit › Use as Character: opens Library › Characters with a new card started from the image, where
 * the prompt assistant can describe it.
 */
function useCharacterAction(item: MediaItem, onApplied: () => void): Action | null {
  const characters = useGroupFeature("characters");
  const location = useLocation();
  const navigate = useNavigate();
  if (!characters || item.type !== "image") return null;
  return {
    id: "make-character",
    label: "Use as Character",
    icon: icons.character,
    onClick: () => {
      onApplied();
      navigate("/library#characters", {
        state: {
          backgroundLocation: location.state?.backgroundLocation || location,
          characterFrom: item.id,
        },
      });
    },
  };
}

interface MediaActionOptions {
  transfer: MediaTransferActions;
  /** Action and option IDs a surface leaves out. */
  omit?: string[];
  compare?: boolean;
  /** Queues a new run; the viewer's joins its strip. Defaults to queueing it directly. */
  iterate?: (iteration: Iteration) => void;
  onApplied?: () => void;
  onCompare?: () => void;
  /** Opens Animate's dialog for a theme: Custom Animation, or any theme under Review Prompt. */
  onAnimate: (theme: AnimateTheme) => void;
  onDelete: () => void;
  onRetried?: (jobId: string) => void;
  onTrim: () => void;
  onVersionChange?: (id: string, active: boolean) => void;
}

/**
 * The one media action definition for the viewer bar, tile and context menus: labels,
 * sections, order, options and availability.
 */
export function useMediaActions(
  item: MediaItem,
  {
    transfer,
    omit = [],
    compare,
    iterate,
    onApplied = () => {},
    onCompare,
    onAnimate,
    onDelete,
    onRetried,
    onTrim,
    onVersionChange,
  }: MediaActionOptions,
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
  const compareVariants = useCompare();
  const variants = useItemMutation(item.id, "compare", {
    mutationFn: () => compareVariants.openItem(item),
  });
  const settingsText = useSettingsText(item);
  const retry = useRetryAction(item, onRetried);
  const reference = useReferenceAction(item, onApplied);
  const character = useCharacterAction(item, onApplied);
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
  const navigate = useNavigate();
  const favorite = useMediaFavorite(item);
  const ready = item.status === "done" && Boolean(item.url);
  const gif = ready ? videoExport(item, "gif") : null;
  const loop = ready ? videoExport(item, "loop") : null;
  const image = ready && item.type === "image";
  const upscale = useUpscaleAction(item, {
    ready,
    compare,
    onCompare,
    onVersionChange,
  });
  const stopUpscale = useStopUpscale(item);
  const assistant = useQuery(assistantQuery);
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
  const moreLikeSet: Omit<Action, "id"> | null =
    ready && !item.uploaded && item.resultSet && assistant.data?.available
      ? {
          label: "More Like This Set",
          icon: icons.suggestions,
          disabled: moreSet.isPending,
          onClick: () => moreSet.mutate(),
        }
      : null;
  // Animate says why no model can run before anything queues.
  const [videos, setVideos] = useVideosPreference();
  const [review, setReview] = useAnimateReview();
  // The menu keeps its choice while a switch loads.
  const animation = useQuery({
    ...animateProfileQuery(item),
    enabled: image || (ready && item.type === "video"),
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
  const themes = (Object.keys(animateThemes) as AnimateTheme[]).filter(
    (theme) => theme !== "spicy" || assistant.data?.spicy,
  );
  const themeItems = (disabled: boolean) =>
    assistant.data?.available
      ? themes.map((theme) => ({
          id: `animate-${theme}`,
          label: `${animateThemes[theme]}${theme === "custom" ? "…" : ""}`,
          icon: themeIcons[theme],
          disabled,
          onClick:
            theme === "custom" || review
              ? () => onAnimate(theme)
              : () => run({ kind: "animate", theme }),
        }))
      : [];
  // Themes write the prompt into an editable review before anything queues.
  const reviewItems = assistant.data?.available
    ? [
        {
          id: "animate-review",
          label: "Review Prompt",
          icon: ScanText,
          checked: review,
          keepOpen: true,
          onClick: () => setReview(!review),
        },
      ]
    : [];
  const actions = [
    retry,
    stopUpscale &&
      itemAction("stop", {
        label: "Stop Upscale",
        loading: stopUpscale.isPending,
        disabled: stopUpscale.isPending,
        onClick: stopUpscale.stop,
      }),
    image &&
      itemAction("animate", {
        loading: running === "animate" || action.isPending,
        // When nothing can animate, the options stay disabled and the note says why.
        note: refusal,
        menu: [
          [...modelChoice, ...reviewItems],
          [...themeItems(!animation.data)],
          [
            {
              id: "animate-composer",
              label: "Animate in Composer",
              icon: icons.prompt,
              disabled: !animation.data,
              onClick: () => action.mutate("animate"),
            },
          ],
        ],
      }),
    ready &&
      item.type === "video" &&
      itemAction("animate", {
        label: "Extend",
        loading: running === "animate" || action.isPending,
        // A theme continues the clip from its last frame at once; the composer shows it first. It
        // keeps the clip's own model unless videos run on Cloud.
        note: refusal,
        menu: [
          [...modelChoice, ...reviewItems],
          [
            ...themeItems(action.isPending),
            {
              id: "extend",
              label: "Extend in Composer",
              icon: FastForward,
              disabled: action.isPending,
              onClick: () => action.mutate("extend"),
            },
          ],
          [...(reference ? [reference] : []), saveFrame],
        ],
      }),
    // Edit runs the item again from here first, then reuses it elsewhere, then changes the item
    // itself or recreates it in the composer. An upload has only its suggested prompt; unfinished
    // work opens its prompt.
    itemAction("edit", {
      disabled: !ready && action.isPending,
      loading: videoEdit.isPending || running === "regenerate" || running === "repeat",
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
            ...(image
              ? [
                  [...(character ? [character] : []), ...(reference ? [reference] : [])],
                  [
                    {
                      id: "edit-image",
                      label: "Edit Image",
                      icon: icons.edit,
                      disabled: action.isPending,
                      onClick: () => action.mutate("refine"),
                    },
                    recreateAction,
                  ],
                ]
              : // A video's edits each save a new version; the original stays.
                [
                  [
                    { id: "trim", label: "Trim…", icon: Scissors, onClick: onTrim },
                    editAction("reverse", "Reverse", Rewind, "reverse"),
                    editAction("back-and-forth", "Back & Forth", ArrowLeftRight, "loop"),
                  ],
                  // Interpolated edits, the slowest to make.
                  [
                    editAction("slow-motion", "Slow Motion", Snail, "slow"),
                    editAction("smooth-motion", "Smooth Motion", Waves, "smooth"),
                  ],
                  [recreateAction],
                ]),
          ]
        : undefined,
    }),
    image &&
      itemAction("compare", { disabled: variants.isPending, onClick: () => variants.mutate() }),
    // The gallery ranked by likeness to this image (GalleryPage reads `similar`), then new
    // variations of its MCP result set; a video in a set has only the latter.
    image
      ? itemAction("similar", {
          menu: [
            [
              {
                id: "similar-gallery",
                label: "Similar",
                icon: icons.similar,
                onClick: () => {
                  onApplied();
                  navigate(`/images?${new URLSearchParams({ similar: item.id })}`);
                },
              },
              ...(moreLikeSet ? [{ id: "more-like-set", ...moreLikeSet }] : []),
            ],
          ],
        })
      : moreLikeSet && itemAction("similar", moreLikeSet),
    upscale,
    // Its options sort alphabetically.
    itemAction("copy", {
      menu: [
        [
          {
            id: "copy-details",
            label: "Details",
            icon: ListChecks,
            onClick: () => void copyText(settingsText(), "Details"),
          },
          {
            id: "copy-prompt",
            label: "Prompt",
            icon: TextQuote,
            onClick: () => void copyText(item.prompt || "", "Prompt"),
          },
        ],
      ],
    }),
    // Phones that share natively share instead of downloading.
    ready &&
      (transfer.canShare
        ? itemAction("share", {
            label: `Share ${item.type === "video" ? "Video" : "Image"}`,
            disabled: transfer.sharing,
            loading: transfer.sharing,
            keepOpen: !transfer.shareReady,
            onClick: () => void transfer.share(),
          })
        : itemAction("download", {
            link: transfer.download,
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
          })),
    itemAction("delete", { onClick: onDelete }),
    ready &&
      itemAction("star", {
        label: item.favorite ? "Unstar" : "Star",
        pressed: Boolean(item.favorite),
        disabled: favorite.isPending,
        onClick: () => favorite.mutate(),
      }),
  ];
  const kept = (action: Action): Action =>
    action.menu
      ? {
          ...action,
          menu: action.menu.map((group) =>
            group.filter((option) => !omit.includes(option.id)).map(kept),
          ),
        }
      : action;
  return itemActionGroups(
    actions
      .filter((entry): entry is Action => !!entry && !omit.includes(entry.id))
      .map((entry) => withoutLoneOption(kept(entry))),
  );
}

/** The shared actions as menu items, mounted while a menu is open. */
export function MediaActionMenu({ item, ...options }: MediaActionOptions & { item: MediaItem }) {
  return <ActionMenuItems groups={useMediaActions(item, options)} />;
}
