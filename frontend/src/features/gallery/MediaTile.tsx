import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Button, Checkbox, Loader, Progress, Text, UnstyledButton } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Layers, RotateCw, X } from "lucide-react";
import type { MediaItem } from "../../types";
import { useMotionDuration } from "../../ui/Appearance";
import {
  progressPercent,
  queueQuery,
  statusLabels,
  terminal,
  useQueueAction,
} from "../generation/Queue";
import { galleryReferenceType } from "../generation/references";
import { mediaSource } from "./mediaSource";
import { mediaTitle } from "./mediaLabels";
import type { GallerySelection } from "./useGallerySelection";
import type { useHoldToSelect } from "./useGalleryLayout";
import classes from "./MediaTile.module.css";

/** Saved, failed or cancelled; anything else is still generating. */
export const finished = (item: { status?: unknown }) =>
  ["done", "error", "canceled"].includes(String(item.status));
const titleCase = (text: string) => text.replace(/\b\p{Ll}/gu, (letter) => letter.toUpperCase());

function useItemJob(item: MediaItem) {
  return useQuery({
    ...queueQuery,
    select: (data) => data.jobs.find((job) => job.id === item.jobId),
    enabled: Boolean(item.jobId) && item.status !== "done",
  }).data;
}

/** Progress, phase and Cancel while generating; the reason and Try Again once failed. */
function TileStatus({
  item,
  onTryAgain,
}: {
  item: MediaItem;
  onTryAgain?: (item: MediaItem) => void;
}) {
  const job = useItemJob(item);
  const action = useQueueAction(job?.id);
  const motionDuration = useMotionDuration();
  const [retrying, setRetrying] = useState(false);
  const active = !finished(item);
  const failed = item.status === "error";
  const progress = job?.progress;
  const percent = active && progress?.max ? Math.round(progressPercent(progress)) : undefined;
  const label = active
    ? job?.status === "running" && progress?.phase
      ? titleCase(progress.phase)
      : statusLabels[job?.status || "queued"]
    : statusLabels[failed ? "failed" : "cancelled"];
  const reason = failed
    ? job?.reason || ("error" in item && typeof item.error === "string" ? item.error : "")
    : active && job?.status === "waiting"
      ? job.reason
      : "";
  // A multi-output run shows one Cancel, on its first unfinished placeholder.
  const owner = job?.items.find((entry) => !finished(entry));
  const cancellable =
    active && job && !terminal.has(job.status) && (!owner || owner.id === item.id);
  const retryable = failed && job?.status === "failed" && onTryAgain;
  return (
    <>
      <div className={classes.status} data-failed={failed || undefined}>
        {active ? (
          <Loader size="sm" color="gray" />
        ) : (
          <CircleAlert size={20} color={failed ? "var(--mantine-color-red-6)" : undefined} />
        )}
        <Text size="sm" fw={600} c={failed ? "red" : undefined}>
          {label}
          {percent !== undefined && ` · ${percent}%`}
        </Text>
        <Text size="xs" c="dimmed" lineClamp={2}>
          {reason || mediaTitle(item)}
        </Text>
      </div>
      {percent !== undefined && (
        <div className={classes.progress}>
          <Progress
            aria-hidden
            w="100%"
            size="xs"
            radius={0}
            value={percent}
            transitionDuration={motionDuration}
          />
        </div>
      )}
      {(cancellable || retryable) && (
        <div className={classes.statusAction}>
          {cancellable ? (
            <Button
              size="compact-sm"
              variant="default"
              radius="xl"
              leftSection={<X size={14} />}
              aria-label={`Cancel ${mediaTitle(item)}`}
              loading={action.isPending}
              onClick={() => action.mutate({ id: job.id, action: "cancel" })}
            >
              Cancel
            </Button>
          ) : (
            <Button
              size="compact-sm"
              variant="default"
              radius="xl"
              leftSection={<RotateCw size={14} />}
              aria-label={`Try Again: ${mediaTitle(item)}`}
              loading={retrying}
              onClick={async () => {
                setRetrying(true);
                try {
                  await onTryAgain!(item);
                } finally {
                  setRetrying(false);
                }
              }}
            >
              Try Again
            </Button>
          )}
        </div>
      )}
    </>
  );
}

/** The version count, or the shown version's place while flipping through them. */
function VersionBadge({ count, current }: { count: number; current?: number }) {
  return (
    <div className={classes.versions} aria-hidden>
      {current === undefined ? (
        <>
          <Layers size={12} />
          {count}
        </>
      ) : count <= 8 ? (
        Array.from({ length: count }, (_, index) => (
          <span key={index} className={classes.dot} data-current={index === current || undefined} />
        ))
      ) : (
        `${current + 1} / ${count}`
      )}
    </div>
  );
}

/**
 * One gallery tile for Grid and Runs: the media or its generation status, the hover caption, the
 * selection check and the tile's actions. Controls sit beside the button, never inside it. A tile
 * with `versions` flips through them as the pointer crosses it, or with a sideways swipe on phones.
 */
export function MediaTile({
  item,
  group = [item],
  label,
  expanded,
  selection,
  hold,
  caption,
  detail,
  actions,
  layers,
  className,
  style,
  onOpen,
  onMenu,
  onSelectionMenu,
  onTryAgain,
  onKeyDown,
  versions,
  version,
  onVersion,
}: {
  item: MediaItem;
  /** The items this tile selects together; a run's stack selects the whole run. */
  group?: MediaItem[];
  label?: string;
  expanded?: boolean;
  selection?: GallerySelection;
  hold: ReturnType<typeof useHoldToSelect>;
  /** Hover captions, captions always shown, or none (phones without Tile Captions). */
  caption: "hover" | "pinned" | "none";
  detail?: string;
  actions?: ReactNode;
  layers?: ReactNode;
  className?: string;
  style?: CSSProperties;
  onOpen: () => void;
  onMenu?: () => void;
  onSelectionMenu?: (x: number, y: number) => void;
  onTryAgain?: (item: MediaItem) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** The tile's versions, oldest first; `version` is the one shown while flipping. */
  versions?: MediaItem[];
  version?: number;
  onVersion?: (index?: number) => void;
}) {
  const selecting = Boolean(selection?.selecting);
  const count = group.filter((entry) => selection?.selected.has(entry.id)).length;
  const selected = selecting && count === group.length;
  const media = mediaSource(item);
  const source = media.thumbnailUrl || item.preview || media.url;
  const title = mediaTitle(item);
  const [entering] = useState(
    () => !finished(item) && Date.now() - Date.parse(item.createdAt || "") < 10_000,
  );
  const flips = Boolean(versions && versions.length > 1 && onVersion && !selecting);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  function openMenu(x: number, y: number) {
    if (selecting) {
      if (!onSelectionMenu) return false;
      if (!selected) selection!.toggle(group);
      onSelectionMenu(x, y);
      return true;
    }
    if (!onMenu) return false;
    onMenu();
    return true;
  }
  return (
    <div
      className={`${classes.tile} ${className || ""}`}
      style={style}
      data-entering={entering || undefined}
      data-selected={selected || undefined}
      data-expanded={expanded || undefined}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse")
          void event.currentTarget
            .querySelector("video")
            ?.play()
            .catch(() => {});
        if (!flips || event.pointerType !== "mouse") return;
        // Thumbnails load before the pointer reaches them, so flipping never shows an empty tile.
        for (const version of versions!) {
          const thumbnail = mediaSource(version).thumbnailUrl;
          if (thumbnail) new Image().src = thumbnail;
        }
      }}
      onPointerMove={(event) => {
        if (!flips || event.pointerType !== "mouse") return;
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = Math.min(0.999, Math.max(0, (event.clientX - rect.left) / rect.width));
        const index = Math.floor(ratio * versions!.length);
        if (index !== version) onVersion!(index);
      }}
      onPointerLeave={(event) => {
        event.currentTarget.querySelector("video")?.load();
        if (flips && event.pointerType === "mouse") onVersion!(undefined);
      }}
      onPointerDown={(event) => {
        swipe.current =
          flips && event.pointerType === "touch" ? { x: event.clientX, y: event.clientY } : null;
      }}
      onPointerUp={(event) => {
        const start = swipe.current;
        swipe.current = null;
        if (!start) return;
        const dx = event.clientX - start.x;
        if (Math.abs(dx) < 32 || Math.abs(dx) < 2 * Math.abs(event.clientY - start.y)) return;
        swiped.current = true;
        const shown = version ?? 0;
        onVersion!(Math.min(versions!.length - 1, Math.max(0, shown + (dx < 0 ? 1 : -1))));
      }}
      onContextMenu={(event) => {
        if (hold.held.current === item.id || openMenu(event.clientX, event.clientY))
          event.preventDefault();
      }}
    >
      {layers}
      <UnstyledButton
        className={classes.button}
        data-media-id={item.id}
        data-media-group={group.length > 1 ? group.map((entry) => entry.id).join(" ") : undefined}
        aria-label={
          label ||
          `${selecting ? "Select" : "Open"} ${item.type}: ${title}${
            versions && versions.length > 1 && !selecting
              ? `, Version ${(version ?? 0) + 1} of ${versions.length}`
              : ""
          }`
        }
        aria-pressed={selecting ? selected : undefined}
        aria-expanded={selecting ? undefined : expanded}
        draggable={item.status === "done"}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            const rect = event.currentTarget.getBoundingClientRect();
            if (openMenu(rect.left + 16, rect.top + 16)) event.preventDefault();
            return;
          }
          onKeyDown?.(event);
        }}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData(
            galleryReferenceType,
            JSON.stringify({ id: item.id, type: item.type }),
          );
        }}
        onClick={(event) => {
          if (hold.consumeHold(item.id) || swiped.current) {
            swiped.current = false;
            event.preventDefault();
            return;
          }
          if (selection?.click(group, event)) return;
          event.currentTarget.focus({ preventScroll: true });
          onOpen();
        }}
      >
        {source && item.type === "video" ? (
          <video
            className={classes.media}
            data-loaded
            // A mouse over the tile plays Studio's short preview; leaving returns to the poster.
            src={media.url?.replace("/comfy/view?", "/comfy/video-preview?") || undefined}
            poster={media.thumbnailUrl}
            preload="none"
            muted
            loop
            playsInline
            aria-hidden
          />
        ) : source ? (
          <img
            key={source}
            ref={(element) => {
              // Cached images are complete before paint, so they never fade in again.
              if (element?.complete && element.naturalWidth) element.dataset.loaded = "";
            }}
            className={classes.media}
            src={source}
            alt=""
            width={media.width || 1024}
            height={media.height || 1024}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={(event) => {
              event.currentTarget.dataset.loaded = "";
            }}
            onError={(event) => {
              event.currentTarget.dataset.failed = "";
            }}
          />
        ) : null}
        {item.status === "done"
          ? caption !== "none" && (
              <div className={classes.caption} data-pinned={caption === "pinned" || undefined}>
                <Text size="sm" fw={500} lineClamp={2}>
                  {title}
                </Text>
                {detail && (
                  <Text size="xs" opacity={0.8} lineClamp={1}>
                    {detail}
                  </Text>
                )}
              </div>
            )
          : null}
      </UnstyledButton>
      {item.status !== "done" && <TileStatus item={item} onTryAgain={onTryAgain} />}
      {versions && versions.length > 1 && !selecting && (
        <VersionBadge count={versions.length} current={version} />
      )}
      {!selecting && actions}
      {selecting && (
        <Checkbox
          className={classes.check}
          checked={selected}
          indeterminate={count > 0 && !selected}
          aria-label={`Select ${title}`}
          onChange={() => selection!.toggle(group)}
        />
      )}
    </div>
  );
}
