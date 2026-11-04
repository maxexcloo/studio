import { useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import {
  ArrowLeftRight,
  Camera,
  Check,
  Eye,
  FastForward,
  Film,
  ImageDown,
  Flame,
  ImagePlus,
  ListChecks,
  Loader,
  PenLine,
  Repeat,
  Rewind,
  ScanFace,
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
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { useOpenComposer } from "../generation/openComposer";
import { post } from "../../api";
import type { MediaItem } from "../../types";
import { copyText } from "../../ui/clipboard";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { TextBox } from "../../ui/TextBox";
import { useFlash } from "../../ui/useFlash";
import { usePhone } from "../../ui/usePhone";
import { useGroupFeature } from "../auth/AccountGate";
import { useCompare } from "../compare/CompareDialog";
import { useGeneration, useGenerationActions } from "../generation/GenerationProvider";
import { assistantQuery } from "../generation/PromptAssistant";
import { useQueue, useQueueAction } from "../generation/Queue";
import { useGalleryReference } from "../generation/references";
import { useChatText } from "../sessions/ChatProvider";
import { ActionMenuItems, type Action, type ActionGroups } from "./ActionBar";
import { videoExport } from "./download";
import { useSettingsText } from "./MediaDetails";
import type { MediaTransferActions } from "./mediaShare";
import { upscaling, useQuickUpscale } from "./UpscaleControls";
import {
  animateProfileQuery,
  animateThemes,
  mediaDraft,
  useAnimateReview,
  useAnimateTier,
  useAnimateWriter,
  useMediaAction,
  useMediaIteration,
  type AnimateTheme,
  type Iteration,
} from "./useMediaAction";
import { useMediaFavorite } from "./useMediaFavorite";
import { useRecreateAction } from "./useRecreate";
import { useVideoEdit, type VideoEdit } from "./videoEdits";
import { useTryAgain } from "./useTryAgain";

const definitions = {
  chat: { label: "Continue in Chat", icon: icons.chat },
  recreate: { label: "Recreate", icon: icons.recreate },
  animate: { label: "Animate", icon: icons.animate },
  edit: { label: "Edit", icon: icons.edit },
  retry: { label: "Retry", icon: icons.retry },
  stop: { label: "Stop", icon: icons.stop },
  compare: { label: "Compare", icon: icons.compare },
  upscale: { label: "Upscale", icon: icons.upscale },
  copy: { label: "Copy", icon: icons.copy },
  download: { label: "Download", icon: icons.download },
  share: { label: "Share", icon: icons.share },
  delete: { label: "Delete", icon: icons.delete, color: "red" as const },
  star: { label: "Star", icon: icons.star },
};
export type ItemActionId = keyof typeof definitions;
/**
 * The sections and order everywhere: Animate, Edit, Recreate, Upscale | Compare, Continue in Chat |
 * Copy, Download | Star, Delete. Retry and Stop lead for unfinished work; Compare shows only in
 * menus and the selection bar; Share takes Download's place where phones share.
 */
const sections: ItemActionId[][] = [
  ["retry", "stop", "animate", "edit", "recreate", "upscale"],
  ["compare", "chat"],
  ["copy", "download", "share"],
  ["star", "delete"],
];

/** An item action with its shared label and icon. */
export const itemAction = (id: ItemActionId, action: Partial<Action> = {}): Action => ({
  id,
  ...definitions[id],
  ...action,
});
/** Places actions in the shared sections and order; absent ones are left out. */
export const itemActionGroups = (actions: (Action | null | false | undefined)[]): ActionGroups =>
  sections.map((ids) =>
    ids.flatMap((id) => actions.filter((action): action is Action => !!action && action.id === id)),
  );

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
  spicy: Flame,
  custom: PenLine,
};

/** A failed item's Retry; the new pending tile replaces it (`onRetried` gets the new job). */
function useRetryAction(item: MediaItem, onRetried?: (jobId: string) => void): Action | null {
  const queue = useQueue();
  const retry = useQueueAction(item.jobId);
  const tryAgain = useTryAgain([item]);
  if (item.status !== "error" || !item.jobId) return null;
  const job = queue.data?.jobs.find((job) => job.id === item.jobId);
  if (queue.error)
    return itemAction("retry", {
      label: "Reload Generation Status",
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
  const [saved, flash] = useFlash();
  const save = useMutation({
    mutationFn: () =>
      post("/api/gallery/frame", { galleryItemId: item.id, frame: viewerFrame(item) ?? "last" }),
    onSuccess: () => {
      flash(true);
      void cache.invalidateQueries({ queryKey: ["gallery"] });
    },
    onError: (error) => notifications.show({ color: "red", message: error.message }),
  });
  return {
    id: "save-frame",
    label: saved ? "Saved to Uploads" : "Save Frame as Image",
    icon: saved ? Check : ImageDown,
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
 * Continue in Chat: a new Chat about the result, with it attached as the reference and its settings
 * as the generation input, so the conversation can rework its prompt or edit the image. A `message`
 * (the change asked for in the viewer) starts the Chat's unsent message.
 */
export function useChatAction(item: MediaItem, onApplied: () => void) {
  const { setDraft, profiles } = useGenerationActions();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [, setText] = useChatText();
  return useMutation({
    mutationFn: async (message?: string) => {
      if (message) setText(message);
      // Without a model that takes the image, the Chat still starts from its settings.
      const { draft } = await mediaDraft(item, "refine", profiles, client).catch(() =>
        mediaDraft(item, "image", profiles, client),
      );
      setDraft(
        { ...draft, sessionId: "", parentJobId: undefined, parentItemId: undefined },
        "chat",
      );
      onApplied();
      navigate("/chat");
    },
  });
}

export interface MediaActionOptions {
  transfer: MediaTransferActions;
  sessionId?: string;
  /** Action IDs a surface leaves out. */
  omit?: string[];
  compare?: boolean;
  /** Queues a new run; the viewer's joins its strip. Defaults to queueing it directly. */
  iterate?: (iteration: Iteration) => void;
  iterating?: Iteration["kind"];
  onApplied?: () => void;
  onCompare?: () => void;
  /** Opens Animate's dialog for a theme: Custom Animation, or any theme under Review Prompt First. */
  onAnimate: (theme: AnimateTheme) => void;
  onDelete: () => void;
  onRetried?: (jobId: string) => void;
  onTrim: () => void;
  onUpscale?: () => void;
  onVersionChange?: (id: string, active: boolean) => void;
}

/**
 * The one media action definition for the viewer bar, tile, context and Chat result menus: labels,
 * sections, order, options and availability.
 */
export function useMediaActions(
  item: MediaItem,
  {
    transfer,
    sessionId,
    omit = [],
    compare,
    iterate,
    iterating,
    onApplied = () => {},
    onCompare,
    onAnimate,
    onDelete,
    onRetried,
    onTrim,
    onUpscale,
    onVersionChange,
  }: MediaActionOptions,
): ActionGroups {
  const action = useMediaAction(item, sessionId, onApplied);
  const iteration = useMediaIteration(item, sessionId);
  const run = iterate ?? ((next: Iteration) => iteration.mutate(next));
  const running = iterating ?? (iteration.isPending ? iteration.variables?.kind : undefined);
  const compareVariants = useCompare();
  const variants = useMutation({ mutationFn: () => compareVariants.openItem(item) });
  const settingsText = useSettingsText(item);
  const retry = useRetryAction(item, onRetried);
  const reference = useReferenceAction(item, onApplied);
  const recreate = useRecreateAction(item, onApplied);
  const saveFrame = useSaveFrame(item);
  const videoEdit = useVideoEdit(item);
  // A video edit's menu stays open while it saves, then its item says so for a moment.
  const [edited, flashEdited] = useFlash<VideoEdit["kind"]>();
  const editAction = (
    id: string,
    label: string,
    icon: LucideIcon,
    kind: Exclude<VideoEdit["kind"], "trim">,
  ): Action => ({
    id,
    label: edited === kind ? "Saved as New Version" : label,
    icon: edited === kind ? Check : icon,
    disabled: videoEdit.isPending,
    keepOpen: true,
    onClick: () => videoEdit.mutate({ kind }, { onSuccess: () => flashEdited(kind) }),
  });
  const chat = useChatAction(item, onApplied);
  const chatOn = useGroupFeature("chat");
  const favorite = useMediaFavorite(item);
  const ready = item.status === "done" && Boolean(item.url);
  const gif = ready ? videoExport(item, "gif") : null;
  const loop = ready ? videoExport(item, "loop") : null;
  const image = ready && item.type === "image";
  const assistant = useQuery(assistantQuery);
  // Animate says why no model can run before anything queues.
  const [tier, setTier] = useAnimateTier();
  const [review, setReview] = useAnimateReview();
  // The menu keeps its choice while a switch between Fast and Quality loads.
  const animation = useQuery({
    ...animateProfileQuery(item, tier),
    enabled: image,
    placeholderData: keepPreviousData,
  });
  const cache = useQueryClient();
  const version = useMutation({
    mutationFn: (active: boolean) =>
      post<{ upscaleActive: boolean }>("/api/upscale/toggle", { galleryItemId: item.id, active }),
    onSuccess: (result) => {
      onVersionChange?.(item.id, result.upscaleActive);
      void cache.invalidateQueries({ queryKey: ["gallery"] });
      void cache.invalidateQueries({ queryKey: ["session"] });
    },
  });
  const themes = (Object.keys(animateThemes) as AnimateTheme[]).filter(
    (theme) => theme !== "spicy" || assistant.data?.spicy,
  );
  const upscaled = Boolean(item.upscale?.url && !item.upscale.withRun);
  const quick = useQuickUpscale(item, ready);
  const upscaleBusy = upscaling(item) || quick.queue.isPending;
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
          label: "Review Prompt First",
          icon: ScanText,
          checked: review,
          keepOpen: true,
          onClick: () => setReview(!review),
        },
      ]
    : [];
  const actions = [
    retry,
    image &&
      itemAction("animate", {
        loading: running === "animate" || action.isPending,
        // When nothing can animate, the options stay disabled without an explanation.
        menu: [
          [
            // Fast or Quality picks the video model for the themes and the composer below.
            ...((animation.data?.tiers.length ?? 0) > 1
              ? [
                  {
                    id: "animate-tier",
                    label: "Fast or Quality",
                    icon: icons.animate,
                    choice: {
                      value: tier,
                      options: [
                        { value: "fast", label: "Fast" },
                        { value: "quality", label: "Quality" },
                      ],
                      onChange: (value: string) => setTier(value as typeof tier),
                    },
                  },
                ]
              : []),
            ...reviewItems,
          ],
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
        loading: running === "animate" || action.isPending,
        // A theme continues the clip from its last frame at once; the composer shows it first.
        menu: [
          reviewItems,
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
    image &&
      itemAction("edit", {
        disabled: action.isPending,
        onClick: () => action.mutate("refine"),
      }),
    // A video's edits each save a new version; the original stays.
    ready &&
      item.type === "video" &&
      itemAction("edit", {
        loading: videoEdit.isPending,
        menu: [
          [
            { id: "trim", label: "Trim…", icon: Scissors, onClick: onTrim },
            editAction("reverse", "Reverse", Rewind, "reverse"),
            editAction("back-and-forth", "Back and Forth", ArrowLeftRight, "loop"),
          ],
          // Interpolated edits, the slowest to make.
          [
            editAction("slow-motion", "Slow Motion", Snail, "slow"),
            editAction("smooth-motion", "Smooth Motion", Waves, "smooth"),
          ],
        ],
      }),
    ready &&
      chatOn &&
      itemAction("chat", {
        loading: chat.isPending,
        disabled: chat.isPending,
        onClick: () => chat.mutate(),
      }),
    // Recreate reuses the item's prompt and settings: Edit Prompt opens them in the composer (its
    // first option) and the others run it again from here. An upload has only its suggested prompt.
    itemAction("recreate", {
      disabled: action.isPending,
      loading: running === "regenerate" || running === "repeat",
      onClick: ready ? undefined : () => action.mutate("image"),
      menu: !ready
        ? undefined
        : item.uploaded
          ? [[recreate, ...(image && reference ? [reference] : [])]]
          : [
              [
                {
                  id: "prompt-composer",
                  label: "Edit Prompt",
                  icon: icons.prompt,
                  disabled: action.isPending,
                  onClick: () => action.mutate("image"),
                },
                ...(image && reference ? [reference] : []),
              ],
              [
                {
                  id: "new-seed",
                  label: "Run Again",
                  icon: Shuffle,
                  onClick: () => run({ kind: "regenerate" }),
                },
                {
                  id: "exact-repeat",
                  label: "Run Again (Same Seed)",
                  icon: Repeat,
                  onClick: () => run({ kind: "repeat" }),
                },
              ],
            ],
    }),
    image &&
      itemAction("compare", { disabled: variants.isPending, onClick: () => variants.mutate() }),
    ready &&
      itemAction("upscale", {
        // Laid out like Animate: with an upscale, switching between it and the original comes
        // first; then the remembered settings, then the runs. The usual click is the first run
        // option: Show Upscale, else Upscale at the chosen settings.
        label: upscaling(item) ? "Upscaling…" : "Upscale",
        pressed: upscaled && Boolean(item.upscaleActive),
        loading: upscaleBusy && !upscaled,
        disabled: upscaled ? version.isPending : upscaleBusy,
        menu: [
          upscaled
            ? [
                {
                  id: "show-upscale",
                  label: "Show Upscale",
                  icon: Eye,
                  checked: Boolean(item.upscaleActive),
                  disabled: version.isPending,
                  onClick: () => version.mutate(!item.upscaleActive),
                },
                ...(onCompare && image
                  ? [
                      {
                        id: "compare-upscale",
                        label: "Compare Upscale",
                        icon: icons.compareSideBySide,
                        checked: Boolean(compare),
                        onClick: onCompare,
                      },
                    ]
                  : []),
              ]
            : [],
          [
            {
              id: "upscale-quality",
              label: "Upscale Quality",
              icon: icons.upscale,
              choice: {
                value: quick.quality,
                options: [
                  { value: "fast", label: "Fast" },
                  { value: "balanced", label: "Balanced" },
                  { value: "high", label: "High" },
                ],
                onChange: (value: string) => quick.setQuality(value as typeof quick.quality),
              },
            },
            // Face Detail joins every run from here once checked; disabled where the worker can't.
            ...(image
              ? [
                  {
                    id: "upscale-face",
                    label: "Face Detail",
                    icon: ScanFace,
                    checked: quick.faceDetail,
                    disabled: !quick.faceAvailable,
                    keepOpen: true,
                    onClick: () => quick.setFaceDetail(!quick.faceDetail),
                  },
                ]
              : []),
            // The rest of the settings, under the quick ones.
            {
              id: "upscale-options",
              label: "Upscale Options…",
              icon: icons.settings,
              disabled: upscaleBusy,
              onClick: onUpscale,
            },
          ],
          [
            upscaled
              ? {
                  id: "upscale-again",
                  label: "Regenerate Upscale",
                  icon: icons.retry,
                  disabled: upscaleBusy,
                  onClick: quick.run,
                }
              : {
                  id: "upscale-run",
                  label: image ? "Upscale Image" : "Upscale Video",
                  icon: icons.upscale,
                  disabled: upscaleBusy,
                  onClick: quick.run,
                },
          ],
        ],
      }),
    itemAction("copy", {
      menu: [
        [
          {
            id: "copy-prompt",
            label: "Prompt",
            icon: TextQuote,
            onClick: () => void copyText(item.prompt || "", "Prompt"),
          },
          {
            id: "copy-details",
            label: "Details",
            icon: ListChecks,
            onClick: () => void copyText(settingsText(), "Details"),
          },
        ],
      ],
    }),
    // Phones that share natively share instead of downloading.
    ready &&
      (transfer.canShare
        ? itemAction("share", {
            label: transfer.shareReady
              ? `Share ${item.type === "video" ? "Video" : "Image"}`
              : "Prepare Share",
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
                        label: "Back and Forth",
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
  return itemActionGroups(
    actions
      .filter((entry): entry is Action => !!entry && !omit.includes(entry.id))
      .map(withoutLoneOption),
  );
}

/** The shared actions as menu items, mounted while a menu is open. */
export function MediaActionMenu({ item, ...options }: MediaActionOptions & { item: MediaItem }) {
  return <ActionMenuItems groups={useMediaActions(item, options)} />;
}

/**
 * Animate's dialog for a theme. Custom Animation first asks for the instruction; under Review
 * Prompt First the assistant then writes the motion prompt for editing (a full-screen sheet on
 * phones), and Run queues exactly the prompt shown. Otherwise the theme queues as the menu would.
 */
export function AnimateDialog({
  item,
  sessionId,
  iterate,
  theme,
  onClose,
}: {
  item: MediaItem;
  sessionId?: string;
  iterate?: (iteration: Iteration) => void;
  theme: AnimateTheme;
  onClose: () => void;
}) {
  const phone = usePhone();
  const iteration = useMediaIteration(item, sessionId);
  const run = iterate ?? iteration.mutate;
  const [review] = useAnimateReview();
  const writer = useAnimateWriter(item, sessionId);
  const [instruction, setInstruction] = useState("");
  const [prompt, setPrompt] = useState("");
  const writing = useRef<AbortController>(null);
  const asking = theme === "custom" && writer.isIdle;
  const write = () => {
    writing.current?.abort();
    writing.current = new AbortController();
    writer.mutate(
      { theme, instruction: instruction.trim() || undefined, signal: writing.current.signal },
      { onSuccess: (written) => setPrompt(written.prompt) },
    );
  };
  useEffect(() => {
    if (theme !== "custom") write();
    return () => writing.current?.abort();
  }, []);
  const written = writer.data;
  return (
    <Modal
      opened
      onClose={onClose}
      title={asking ? "Custom Animation" : "Review Prompt"}
      centered
      size={asking ? "sm" : "md"}
      fullScreen={phone}
    >
      {asking ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!instruction.trim()) return;
            if (review) return write();
            run({ kind: "animate", theme, instruction: instruction.trim() });
            onClose();
          }}
        >
          <Stack>
            <TextBox
              label="Instruction"
              placeholder="What should happen in the video?"
              autosize
              minRows={3}
              data-autofocus
              value={instruction}
              onChange={setInstruction}
            />
            <Group justify="flex-end">
              <Button type="submit" disabled={!instruction.trim()}>
                {review ? "Write Prompt" : "Animate"}
              </Button>
            </Group>
          </Stack>
        </form>
      ) : writer.isPending ? (
        <LoadingState label="Writing Prompt…" />
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!written || !prompt.trim()) return;
            run({
              kind: "animate",
              theme,
              instruction: instruction.trim() || undefined,
              written: { prompt: prompt.trim(), model: written.model, thinking: written.thinking },
            });
            onClose();
          }}
        >
          <Stack>
            {writer.error && (
              <Alert color="red" title="Couldn’t Write the Prompt">
                {writer.error.message}
              </Alert>
            )}
            {written && (
              <>
                <TextBox
                  label="Prompt"
                  autosize
                  minRows={4}
                  data-autofocus
                  value={prompt}
                  onChange={setPrompt}
                />
                <Text size="sm" c="dimmed">
                  {written.profileLabel}
                  {written.tier ? ` · ${written.tier === "fast" ? "Fast" : "Quality"}` : ""}
                </Text>
              </>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              {written ? (
                <Button type="submit" disabled={!prompt.trim()}>
                  Run
                </Button>
              ) : (
                <Button onClick={write}>Retry</Button>
              )}
            </Group>
          </Stack>
        </form>
      )}
    </Modal>
  );
}
