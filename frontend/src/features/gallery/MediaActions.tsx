import { useState } from "react";
import { Button, Group, Modal, Stack } from "@mantine/core";
import {
  Camera,
  Columns2,
  Columns3,
  Copy,
  Download,
  Eye,
  FastForward,
  Flame,
  ImagePlus,
  ImageUpscale,
  ListChecks,
  Loader,
  MessageCircle,
  Pencil,
  PenLine,
  Play,
  Repeat,
  RotateCw,
  ScanFace,
  Share,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Square,
  Star,
  TextQuote,
  Trash2,
  Zap,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { post } from "../../api";
import type { MediaItem } from "../../types";
import { copyText } from "../../ui/clipboard";
import { TextBox } from "../../ui/TextBox";
import { useMayUpscale } from "../auth/AccountGate";
import { useCompare } from "../compare/CompareDialog";
import { useGeneration, useGenerationActions } from "../generation/GenerationProvider";
import { assistantQuery } from "../generation/PromptAssistant";
import { useQueue, useQueueAction } from "../generation/Queue";
import { useGalleryReference } from "../generation/references";
import { ActionMenuItems, type Action, type ActionGroups } from "./ActionBar";
import { useSettingsText } from "./MediaDetails";
import type { MediaTransferActions } from "./mediaShare";
import { upscaling, useQuickUpscale } from "./UpscaleControls";
import {
  animateProfileQuery,
  animateThemes,
  mediaDraft,
  useMediaAction,
  useMediaIteration,
  type AnimateTheme,
  type Iteration,
} from "./useMediaAction";
import { useMediaFavorite } from "./useMediaFavorite";
import { useTryAgain } from "./useTryAgain";

const definitions = {
  chat: { label: "Chat", icon: MessageCircle },
  prompt: { label: "Prompt", icon: SlidersHorizontal },
  animate: { label: "Animate", icon: Play },
  edit: { label: "Edit", icon: Pencil },
  retry: { label: "Retry", icon: RotateCw },
  stop: { label: "Stop", icon: Square },
  compare: { label: "Compare", icon: Columns3 },
  upscale: { label: "Upscale", icon: ImageUpscale },
  copy: { label: "Copy", icon: Copy },
  download: { label: "Download", icon: Download },
  share: { label: "Share", icon: Share },
  delete: { label: "Delete", icon: Trash2, color: "red" as const },
  star: { label: "Star", icon: Star },
};
export type ItemActionId = keyof typeof definitions;
/**
 * The sections: Chat and Prompt first, the rest alphabetical within each. Compare shows only in
 * menus and the selection bar; Share takes Download's place where phones share.
 */
const sections: ItemActionId[][] = [
  ["chat", "prompt"],
  ["animate", "edit", "retry", "stop"],
  ["compare", "upscale"],
  ["copy", "download", "share"],
  ["delete", "star"],
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

const themeIcons: Record<AnimateTheme, typeof Camera> = {
  cinematic: Camera,
  living: Sparkles,
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

/** Edit › Use as Reference: adds the image to the composer's references when its profile takes one. */
function useReferenceAction(item: MediaItem, onApplied: () => void): Action | null {
  const { profile } = useGeneration();
  const reference = useGalleryReference();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  if (
    !(
      profile?.mediaInputs?.length ||
      profile?.capabilities.img2img ||
      profile?.capabilities.imageInput
    )
  )
    return null;
  return {
    id: "use-reference",
    label: "Use as Reference",
    icon: ImagePlus,
    disabled: reference.isPending,
    keepOpen: true,
    onClick: () =>
      reference.mutate(item, {
        onSuccess: () => {
          onApplied();
          if (["/images", "/video"].includes(location.pathname)) {
            const next = new URLSearchParams(params);
            next.set("compose", "1");
            setParams(next, { replace: true });
          }
        },
      }),
  };
}

/**
 * Chat: a new Chat about the result, with it attached as the reference and its settings as the
 * generation input, so the conversation can rework its prompt or edit the image.
 */
function useChatAction(item: MediaItem, onApplied: () => void) {
  const { setDraft, profiles } = useGenerationActions();
  const client = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async () => {
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
  onCustomAnimation: () => void;
  onDelete: () => void;
  onRetried?: (jobId: string) => void;
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
    onCustomAnimation,
    onDelete,
    onRetried,
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
  const chat = useChatAction(item, onApplied);
  const favorite = useMediaFavorite(item);
  const ready = item.status === "done" && Boolean(item.url);
  const mayUpscale = useMayUpscale();
  const image = ready && item.type === "image";
  const assistant = useQuery(assistantQuery);
  // Animate names the model that will run, or why none can, before anything queues.
  const animation = useQuery({ ...animateProfileQuery(item), enabled: image });
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
  const animateNote = [
    animation.error
      ? animation.error.message
      : animation.data
        ? animation.data.note || `Runs on ${animation.data.label}.`
        : "Choosing a video model…",
    assistant.data && !assistant.data.available ? "Motion themes need the prompt assistant." : "",
  ]
    .filter(Boolean)
    .join(" ");
  const upscaled = Boolean(item.upscale?.url && !item.upscale.withRun);
  const quick = useQuickUpscale(item, ready && mayUpscale);
  const upscaleBusy = upscaling(item) || quick.queue.isPending;
  const queueUpscale = (quality: "fast" | "balanced" | "high", faceDetail = false) =>
    quick.queue.mutate({ quality, faceDetail });
  const copyDetails = () => void copyText(settingsText(), "Details");
  const actions = [
    retry,
    image &&
      itemAction("animate", {
        loading: running === "animate" || action.isPending,
        note: animateNote,
        menu: [
          assistant.data?.available
            ? themes.map((theme) => ({
                id: `animate-${theme}`,
                label: `${animateThemes[theme]}${theme === "custom" ? "…" : ""}`,
                icon: themeIcons[theme],
                disabled: !animation.data,
                onClick:
                  theme === "custom" ? onCustomAnimation : () => run({ kind: "animate", theme }),
              }))
            : [],
          [
            {
              id: "animate-composer",
              label: "Animate in Composer",
              icon: SlidersHorizontal,
              disabled: !animation.data,
              onClick: () => action.mutate("animate"),
            },
          ],
        ],
      }),
    ready &&
      item.type === "video" &&
      itemAction("animate", {
        loading: action.isPending,
        menu: [
          [
            {
              id: "extend",
              label: "Extend",
              icon: FastForward,
              disabled: action.isPending,
              onClick: () => action.mutate("extend"),
            },
          ],
        ],
      }),
    image &&
      itemAction("edit", {
        disabled: action.isPending,
        onClick: () => action.mutate("refine"),
        menu: reference
          ? [
              [
                {
                  id: "edit-image",
                  label: "Edit Image",
                  icon: Pencil,
                  disabled: action.isPending,
                  onClick: () => action.mutate("refine"),
                },
              ],
              [reference],
            ]
          : undefined,
      }),
    ready &&
      itemAction("chat", {
        loading: chat.isPending,
        disabled: chat.isPending,
        onClick: () => chat.mutate(),
      }),
    // Prompt opens the result in the composer; its options run it again from here.
    itemAction("prompt", {
      disabled: action.isPending,
      loading: running === "regenerate" || running === "repeat",
      onClick: () => action.mutate("image"),
      menu: ready
        ? [
            [
              {
                id: "prompt-composer",
                label: "Open in Composer",
                icon: SlidersHorizontal,
                disabled: action.isPending,
                onClick: () => action.mutate("image"),
              },
            ],
            [
              {
                id: "new-seed",
                label: "Run Again (New Seed)",
                icon: Shuffle,
                onClick: () => run({ kind: "regenerate" }),
              },
              {
                id: "exact-repeat",
                label: "Exact Repeat",
                icon: Repeat,
                onClick: () => run({ kind: "repeat" }),
              },
            ],
          ]
        : undefined,
    }),
    image &&
      itemAction("compare", { disabled: variants.isPending, onClick: () => variants.mutate() }),
    ready &&
      mayUpscale &&
      itemAction("upscale", {
        // With an upscale, the click switches between it and the original; otherwise it runs Balanced.
        label: upscaling(item) ? "Upscaling…" : "Upscale",
        pressed: upscaled && Boolean(item.upscaleActive),
        loading: upscaleBusy && !upscaled,
        disabled: upscaled ? version.isPending : upscaleBusy,
        onClick: upscaled
          ? () => version.mutate(!item.upscaleActive)
          : () => queueUpscale("balanced"),
        note: quick.faceNote || undefined,
        menu: [
          [
            ...(upscaled
              ? [
                  {
                    id: "upscale-again",
                    label: "Regenerate Upscale",
                    icon: RotateCw,
                    disabled: upscaleBusy,
                    onClick: () => queueUpscale("balanced"),
                  },
                ]
              : (["fast", "balanced", "high"] as const).map((quality) => ({
                  id: `upscale-${quality}`,
                  label: quality[0].toUpperCase() + quality.slice(1),
                  icon: ImageUpscale,
                  disabled: upscaleBusy,
                  onClick: () => queueUpscale(quality),
                }))),
            ...(image
              ? [
                  {
                    id: "upscale-face",
                    label: upscaled ? "Regenerate with Face Detail" : "Balanced with Face Detail",
                    icon: ScanFace,
                    disabled: upscaleBusy || !quick.faceDetail,
                    onClick: () => queueUpscale("balanced", true),
                  },
                ]
              : []),
            {
              id: "upscale-options",
              label: "Upscale Options…",
              icon: SlidersHorizontal,
              disabled: upscaleBusy,
              onClick: onUpscale,
            },
          ],
          upscaled
            ? [
                {
                  id: "show-upscale",
                  label: "Show Upscale",
                  icon: Eye,
                  checked: Boolean(item.upscaleActive),
                  disabled: version.isPending,
                  keepOpen: true,
                  onClick: () => version.mutate(!item.upscaleActive),
                },
                ...(onCompare && image
                  ? [
                      {
                        id: "compare-upscale",
                        label: "Compare Upscale",
                        icon: Columns2,
                        checked: Boolean(compare),
                        onClick: onCompare,
                      },
                    ]
                  : []),
              ]
            : [],
        ],
      }),
    itemAction("copy", {
      onClick: copyDetails,
      menu: [
        [
          { id: "copy-details", label: "Details", icon: ListChecks, onClick: copyDetails },
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
            label: transfer.shareReady
              ? `Share ${item.type === "video" ? "Video" : "Image"}`
              : "Prepare Share",
            disabled: transfer.sharing,
            loading: transfer.sharing,
            keepOpen: !transfer.shareReady,
            onClick: () => void transfer.share(),
          })
        : itemAction("download", { link: transfer.download })),
    itemAction("delete", { onClick: onDelete }),
    ready &&
      itemAction("star", {
        label: item.favorite ? "Unstar" : "Star",
        pressed: Boolean(item.favorite),
        disabled: favorite.isPending,
        onClick: () => favorite.mutate(),
      }),
  ];
  return itemActionGroups(actions.filter((entry) => entry && !omit.includes(entry.id)));
}

/** The shared actions as menu items, mounted while a menu is open. */
export function MediaActionMenu({ item, ...options }: MediaActionOptions & { item: MediaItem }) {
  return <ActionMenuItems groups={useMediaActions(item, options)} />;
}

/** Animate › Custom Animation: the instruction the assistant writes the motion prompt from. */
export function CustomAnimationDialog({
  item,
  sessionId,
  iterate,
  opened,
  onClose,
}: {
  item: MediaItem;
  sessionId?: string;
  iterate?: (iteration: Iteration) => void;
  opened: boolean;
  onClose: () => void;
}) {
  const iteration = useMediaIteration(item, sessionId);
  const [instruction, setInstruction] = useState("");
  return (
    <Modal opened={opened} onClose={onClose} title="Custom Animation" centered size="sm">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!instruction.trim()) return;
          (iterate ?? iteration.mutate)({
            kind: "animate",
            theme: "custom",
            instruction: instruction.trim(),
          });
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
              Animate
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
