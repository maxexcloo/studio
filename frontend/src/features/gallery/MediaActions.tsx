import {
  ClipboardCopy,
  Columns2,
  Columns3,
  Copy,
  ImagePlus,
  ImageUpscale,
  ListChecks,
  Loader,
  Pencil,
  Play,
  RotateCcw,
  RotateCw,
  Share,
  Trash2,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useLocation, useSearchParams } from "react-router";
import type { MediaItem } from "../../types";
import { copyText } from "../../ui/clipboard";
import { useCompare } from "../compare/CompareDialog";
import { useGeneration } from "../generation/GenerationProvider";
import { useQueue, useQueueAction } from "../generation/Queue";
import { useGalleryReference } from "../generation/references";
import { ActionMenuItems, type Action, type ActionGroups } from "./ActionBar";
import { useSettingsText } from "./MediaDetails";
import type { MediaTransferActions } from "./mediaShare";
import { upscaling } from "./UpscaleControls";
import { useMediaAction } from "./useMediaAction";
import { useTryAgain } from "./useTryAgain";

/** A failed item's Retry; the new pending tile replaces it (`onRetried` gets the new job). */
function useRetryAction(item: MediaItem, onRetried?: (jobId: string) => void): Action | null {
  const queue = useQueue();
  const retry = useQueueAction(item.jobId);
  const tryAgain = useTryAgain([item]);
  if (item.status !== "error" || !item.jobId) return null;
  const job = queue.data?.jobs.find((job) => job.id === item.jobId);
  if (queue.error)
    return {
      id: "retry",
      label: "Reload Generation Status",
      icon: RotateCw,
      onClick: () => void queue.refetch(),
    };
  if (!job)
    return queue.isPending
      ? { id: "retry", label: "Loading Generation Status", icon: Loader, disabled: true }
      : null;
  if (job.status !== "failed") return null;
  return {
    id: "retry",
    label: "Retry",
    icon: RotateCw,
    disabled: retry.isPending,
    keepOpen: true,
    onClick: async () => {
      const replacement = (await tryAgain([job.id])).get(job.id);
      if (replacement) onRetried?.(replacement);
    },
  };
}

/** Reference: adds the image to the composer's references when the selected profile takes one. */
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
    id: "reference",
    label: "Reference",
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

export interface MediaActionOptions {
  transfer: MediaTransferActions;
  sessionId?: string;
  /** Action IDs a surface already shows as its own buttons. */
  omit?: string[];
  compare?: boolean;
  onApplied?: () => void;
  onCompare?: () => void;
  onDelete: () => void;
  onRetried?: (jobId: string) => void;
  onUpscale?: () => void;
}

/**
 * The one media action definition for tile, context, Chat result and viewer surfaces: labels,
 * order, groups and availability. Menus render it as is; the viewer bar adds its extras.
 */
export function useMediaActions(
  item: MediaItem,
  {
    transfer,
    sessionId,
    omit = [],
    compare,
    onApplied = () => {},
    onCompare,
    onDelete,
    onRetried,
    onUpscale,
  }: MediaActionOptions,
): ActionGroups {
  const action = useMediaAction(item, sessionId, onApplied);
  const compareVariants = useCompare();
  const variants = useMutation({ mutationFn: () => compareVariants.openItem(item) });
  const settingsText = useSettingsText(item);
  const retry = useRetryAction(item, onRetried);
  const reference = useReferenceAction(item, onApplied);
  const ready = item.status === "done" && Boolean(item.url);
  const image = ready && item.type === "image";
  const groups: (Action | null | false)[][] = [
    [
      retry,
      image && {
        id: "animate",
        label: "Animate",
        icon: Play,
        disabled: action.isPending,
        onClick: () => action.mutate("animate"),
      },
      ready && {
        id: "edit",
        label: item.type === "video" ? "Extend" : "Edit",
        icon: Pencil,
        disabled: action.isPending,
        onClick: () => action.mutate(item.type === "video" ? "extend" : "refine"),
      },
      {
        id: "recreate",
        label: "Recreate",
        icon: RotateCcw,
        disabled: action.isPending,
        onClick: () => action.mutate("image"),
      },
      image && reference,
    ],
    [
      image && {
        id: "create-comparison",
        label: "Create Comparison",
        icon: Columns3,
        disabled: variants.isPending,
        onClick: () => variants.mutate(),
      },
      ready && {
        id: "upscale",
        label: upscaling(item) ? "Upscaling…" : "Upscale",
        icon: ImageUpscale,
        disabled: upscaling(item),
        onClick: onUpscale,
      },
      Boolean(onCompare && image && item.upscale?.url && !item.upscale.withRun) && {
        id: "compare",
        label: compare ? "Close Comparison" : "Compare",
        icon: Columns2,
        onClick: onCompare,
      },
    ],
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
        icon: Copy,
        onClick: () => void copyText(item.prompt || "", "Prompt"),
      },
      transfer.canCopy && {
        id: "copy-image",
        label: "Copy Image",
        icon: ClipboardCopy,
        disabled: transfer.copying,
        onClick: () => void transfer.copyImage(),
      },
      transfer.canShare && {
        id: "share",
        label: transfer.shareReady ? "Share" : "Prepare Share",
        icon: Share,
        disabled: transfer.sharing,
        loading: transfer.sharing,
        keepOpen: !transfer.shareReady,
        onClick: () => void transfer.share(),
      },
    ],
    [{ id: "delete", label: "Delete", icon: Trash2, color: "red", onClick: onDelete }],
  ];
  return groups.map((group) =>
    group.filter(
      (entry): entry is Action => entry !== null && entry !== false && !omit.includes(entry.id),
    ),
  );
}

/** The shared actions as menu items, mounted while a menu is open. */
export function MediaActionMenu({ item, ...options }: MediaActionOptions & { item: MediaItem }) {
  return <ActionMenuItems groups={useMediaActions(item, options)} />;
}
