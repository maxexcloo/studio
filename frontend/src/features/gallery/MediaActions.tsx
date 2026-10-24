import { Menu } from "@mantine/core";
import {
  ClipboardCopy,
  Columns2,
  Copy,
  Download,
  ImagePlus,
  ImageUpscale,
  Pencil,
  Play,
  RotateCcw,
  RotateCw,
  Share,
  SquareCheck,
  Star,
  Trash2,
} from "lucide-react";
import { useLocation, useSearchParams } from "react-router";
import type { MediaItem } from "../../types";
import { copyText } from "../../ui/clipboard";
import { useGeneration } from "../generation/GenerationProvider";
import { useQueue, useQueueAction } from "../generation/Queue";
import { useGalleryReference } from "../generation/references";
import type { MediaTransferActions } from "./mediaShare";
import { upscaling } from "./UpscaleControls";
import { useMediaAction } from "./useMediaAction";
import { useMediaFavorite } from "./useMediaFavorite";

/** Actions a surface already shows as its own buttons. */
export type PrimaryAction =
  | "refine"
  | "animate"
  | "upscale"
  | "download"
  | "share"
  | "copy"
  | "star";

function FailedRetry({ jobId }: { jobId: string }) {
  const queue = useQueue();
  const retry = useQueueAction(jobId);
  const job = queue.data?.jobs.find((job) => job.id === jobId);
  if (queue.error)
    return (
      <Menu.Item h={36} onClick={() => void queue.refetch()}>
        Reload Generation Status
      </Menu.Item>
    );
  if (!job)
    return queue.isPending ? (
      <Menu.Item h={36} disabled>
        Loading Generation Status
      </Menu.Item>
    ) : null;
  return job.status === "failed" ? (
    <Menu.Item
      h={36}
      leftSection={<RotateCw size={16} />}
      disabled={retry.isPending}
      closeMenuOnClick={false}
      onClick={() => retry.mutate({ id: job.id, action: "retry" })}
    >
      Retry
    </Menu.Item>
  ) : null;
}

function ReferenceItem({ item, onApplied }: { item: MediaItem; onApplied: () => void }) {
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
  return (
    <Menu.Item
      h={36}
      leftSection={<ImagePlus size={16} />}
      disabled={reference.isPending}
      closeMenuOnClick={false}
      onClick={() =>
        reference.mutate(item, {
          onSuccess: () => {
            onApplied();
            if (["/images", "/video"].includes(location.pathname)) {
              const next = new URLSearchParams(params);
              next.set("compose", "1");
              setParams(next, { replace: true });
            }
          },
        })
      }
    >
      Reference This Image
    </Menu.Item>
  );
}

/**
 * The one media action list for tile, context, viewer and Chat result menus. Render it inside a
 * `Menu.Dropdown`; the surface owns dialogs that must outlive the menu (Delete, Upscale).
 */
export function MediaActionItems({
  item,
  transfer,
  sessionId,
  omit = [],
  compare,
  onApplied = () => {},
  onCompare,
  onDelete,
  onSelect,
  onUpscale,
}: {
  item: MediaItem;
  transfer: MediaTransferActions;
  sessionId?: string;
  omit?: PrimaryAction[];
  compare?: boolean;
  onApplied?: () => void;
  onCompare?: () => void;
  onDelete: () => void;
  onSelect?: () => void;
  onUpscale?: () => void;
}) {
  const action = useMediaAction(item, sessionId, onApplied);
  const favorite = useMediaFavorite(item);
  const ready = item.status === "done" && Boolean(item.url);
  const shown = (id: PrimaryAction) => ready && !omit.includes(id);
  return (
    <>
      {item.status === "error" && item.jobId && <FailedRetry jobId={item.jobId} />}
      {shown("refine") && (
        <Menu.Item
          h={36}
          leftSection={<Pencil size={16} />}
          disabled={action.isPending}
          onClick={() => action.mutate(item.type === "video" ? "extend" : "refine")}
        >
          {item.type === "video" ? "Extend" : "Refine"}
        </Menu.Item>
      )}
      {shown("animate") && item.type === "image" && (
        <Menu.Item
          h={36}
          leftSection={<Play size={16} />}
          disabled={action.isPending}
          onClick={() => action.mutate("animate")}
        >
          Animate
        </Menu.Item>
      )}
      {ready && item.type === "image" && <ReferenceItem item={item} onApplied={onApplied} />}
      <Menu.Item
        h={36}
        leftSection={<RotateCcw size={16} />}
        disabled={action.isPending}
        onClick={() => action.mutate("image")}
      >
        Recreate
      </Menu.Item>
      {shown("upscale") && onUpscale && (
        <Menu.Item
          h={36}
          leftSection={<ImageUpscale size={16} />}
          disabled={upscaling(item)}
          onClick={onUpscale}
        >
          {upscaling(item) ? "Upscaling…" : "Upscale"}
        </Menu.Item>
      )}
      {onCompare && item.type === "image" && item.upscale?.url && !item.upscale.withRun && (
        <Menu.Item h={36} leftSection={<Columns2 size={16} />} onClick={onCompare}>
          {compare ? "Close Comparison" : "Compare"}
        </Menu.Item>
      )}
      {!omit.includes("copy") && (
        <Menu.Item
          h={36}
          leftSection={<Copy size={16} />}
          onClick={() => void copyText(item.prompt || "", "Prompt")}
        >
          Copy Prompt
        </Menu.Item>
      )}
      {transfer.canCopy && !omit.includes("copy") && (
        <Menu.Item
          h={36}
          leftSection={<ClipboardCopy size={16} />}
          disabled={transfer.copying}
          onClick={() => void transfer.copyImage()}
        >
          Copy Image
        </Menu.Item>
      )}
      {shown("download") && (
        <Menu.Item h={36} component="a" {...transfer.download} leftSection={<Download size={16} />}>
          Download
        </Menu.Item>
      )}
      {transfer.canShare && !omit.includes("share") && (
        <Menu.Item
          h={36}
          leftSection={<Share size={16} />}
          disabled={transfer.sharing}
          closeMenuOnClick={transfer.shareReady}
          onClick={() => void transfer.share()}
        >
          {transfer.shareReady ? "Share" : "Prepare Share"}
        </Menu.Item>
      )}
      {!omit.includes("star") && (
        <Menu.Item
          h={36}
          leftSection={<Star size={16} fill={item.favorite ? "currentColor" : "none"} />}
          disabled={favorite.isPending}
          onClick={() => favorite.mutate()}
        >
          {item.favorite ? "Unstar" : "Star"}
        </Menu.Item>
      )}
      {onSelect && (item.status === "done" || item.status === "error") && (
        <Menu.Item h={36} leftSection={<SquareCheck size={16} />} onClick={onSelect}>
          Select
        </Menu.Item>
      )}
      <Menu.Divider />
      <Menu.Item h={36} color="red" leftSection={<Trash2 size={16} />} onClick={onDelete}>
        Delete
      </Menu.Item>
    </>
  );
}
