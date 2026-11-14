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
  TextQuote,
  Waves,
  Wind,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";

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
import { askMotionIdeas, motionIdeasQuery } from "../taste/suggestions";
import { videoExport } from "./download";
import { itemAction, itemActionGroups } from "./itemActions";
import { useSettingsText } from "./MediaDetails";
import type { MediaTransferActions } from "./mediaShare";
import {
  type SimilarStrictness,
  similarStrictnessOptions,
  useSimilarStrictness,
} from "./similarStrictness";
import { useStopUpscale, useUpscaleAction } from "./UpscaleControls";
import { useItemMutation } from "./useItemMutation";
import {
  type AnimateOffers,
  type AnimateRequest,
  type Iteration,
  animateProfileQuery,
  useAnimateReview,
  useAnimateThemes,
  useMediaAction,
  useMediaIteration,
} from "./useMediaAction";
import { useMediaFavorite } from "./useMediaFavorite";
import { useRecreateAction } from "./useRecreate";
import { useTryAgain } from "./useTryAgain";
import { type VideoEdit, useVideoEdit } from "./videoEdits";

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

// Seeded themes have their own icons; others share Animate's.
const themeIcons: Record<string, LucideIcon> = {
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
    description: takes
      ? undefined
      : fallback
        ? `Switches to ${profileName(fallback)}`
        : `${profileName(profile)} takes no references`,
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
          // The gallery under Library, without its viewer.
          backgroundLocation: location.state?.backgroundLocation || {
            ...location,
            search: location.search.replace(/[?&]item=[^&]*/, "").replace(/^&/, "?"),
          },
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
  /** Opens Animate's dialog: Custom Animation, or any theme or suggested motion under Review Prompt. */
  onAnimate: (choice: AnimateRequest) => void;
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
  const stage = useStageComparison();
  const variants = useItemMutation(item.id, "compare", {
    mutationFn: () => stage.fromItem(item).then(onApplied),
  });
  const comparison = comparisonOf(useQuery(comparisonMembersQuery).data, item);
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
  const [strictness, setStrictness] = useSimilarStrictness();
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
  const themes = useAnimateThemes();
  const themeItem = (theme: AssistantOption, disabled: boolean): Action => ({
    id: `animate-${theme.id}`,
    label: `${theme.label}${theme.id === "custom" ? "…" : ""}`,
    description: theme.description,
    icon: themeIcons[theme.id] ?? icons.animate,
    disabled,
    onClick:
      theme.id === "custom" || review
        ? () => onAnimate({ theme: theme.id })
        : () => run({ kind: "animate", theme: theme.id }),
  });
  const themeOptions = (disabled: boolean) => ({
    label: "Themes",
    options: themes
      .filter((theme) => theme.id !== "custom")
      .map((theme) => themeItem(theme, disabled)),
  });
  const customTheme = (disabled: boolean) =>
    themes.filter((theme) => theme.id === "custom").map((theme) => themeItem(theme, disabled));
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
  const motionsOffered = image && Boolean(item.jobId && assistant.data?.available);
  // Themes write the prompt into an editable review before anything queues.
  const reviewItems = assistant.data?.available
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
        onOpen: motionsOffered ? () => setMotionsFor(item.id) : undefined,
        menu: assistMenu({
          settings: [...modelChoice, ...reviewItems],
          fixed: themeOptions(!animation.data),
          suggestions: motionsOffered ? motions.group : [],
          last: [
            ...customTheme(!animation.data),
            {
              id: "animate-composer",
              label: "Animate in Composer",
              icon: icons.prompt,
              disabled: !animation.data,
              onClick: () => action.mutate("animate"),
            },
          ],
        }),
      }),
    ready &&
      item.type === "video" &&
      itemAction("animate", {
        label: "Extend",
        loading: running === "animate" || action.isPending,
        // A theme continues the clip from its last frame at once; the composer shows it first. It
        // keeps the clip's own model unless videos run on Cloud.
        note: refusal,
        menu: assistMenu({
          settings: [...modelChoice, ...reviewItems],
          fixed: themeOptions(action.isPending),
          others: [...(reference ? [reference] : []), saveFrame],
          last: [
            ...customTheme(action.isPending),
            {
              id: "extend",
              label: "Extend in Composer",
              icon: FastForward,
              disabled: action.isPending,
              onClick: () => action.mutate("extend"),
            },
          ],
        }),
      }),
    // Edit changes the item itself or reuses it elsewhere; a video's edits each save a new version
    // and the original stays.
    ready &&
      itemAction("edit", {
        loading: videoEdit.isPending,
        menu: image
          ? [
              [...(character ? [character] : []), ...(reference ? [reference] : [])],
              [
                {
                  id: "edit-image",
                  label: "Edit in Composer",
                  icon: icons.edit,
                  disabled: action.isPending,
                  onClick: () => action.mutate("refine"),
                },
              ],
            ]
          : [
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
            ],
      }),
    // Recreate runs the item again from here, then opens it in the composer. An upload has only its
    // suggested prompt; unfinished work opens its prompt.
    itemAction("recreate", {
      disabled: !ready && action.isPending,
      loading: running === "regenerate" || running === "repeat",
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
            [recreateAction],
          ]
        : undefined,
    }),
    // Compare Models stages this image's prompt across models in the composer; Open Comparison
    // shows the side-by-side view it belongs to.
    image &&
      itemAction("compare", {
        menu: [
          [
            {
              id: "compare-models",
              label: "Compare Models",
              icon: icons.compare,
              disabled: variants.isPending,
              onClick: () => variants.mutate(),
            },
            ...(comparison
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
        ],
      }),
    // How alike the gallery's results must be, then the gallery ranked by likeness to this image
    // (GalleryPage reads `similar`) and new variations of its MCP result set; a video in a set
    // has only the latter.
    image
      ? itemAction("similar", {
          menu: [
            [
              {
                id: "similar-strictness",
                label: "Strictness",
                icon: icons.similar,
                choice: {
                  value: strictness,
                  options: similarStrictnessOptions,
                  onChange: (value: string) => setStrictness(value as SimilarStrictness),
                },
              },
            ],
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
