import { Button, Checkbox, Loader, Paper, Stack, Text, UnstyledButton } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { type CSSProperties, type KeyboardEvent, type ReactNode, useState } from "react";

import { finishedItemStatuses, terminalStatuses } from "../../../../shared/queue";
import type { MediaItem } from "../../types";
import { icons } from "../../ui/icons";
import { useTouch } from "../../ui/usePhone";
import { JobProgressBar, jobReason, jobStatus, statusLabels } from "../generation/JobProgress";
import { queueQuery, useQueueAction, withQueuePosition } from "../generation/Queue";
import { galleryReferenceType } from "../generation/references";
import { comparisonVariant, mediaTimestamp, mediaTitle } from "./mediaLabels";
import { mediaOriginBadge } from "./mediaOriginBadge";
import { mediaSource } from "./mediaSource";
import { upscaling, useStopUpscale } from "./UpscaleControls";
import type { useHoldToSelect } from "./useGalleryLayout";
import type { SelectionActions } from "./useGallerySelection";

import classes from "./MediaTile.module.css";

/** Saved, failed or cancelled; anything else is still generating. */
export const finished = (item: { status?: unknown }) =>
  finishedItemStatuses.has(String(item.status));

function useQueueJob(jobId: string | undefined, enabled: boolean) {
  return useQuery({
    ...queueQuery,
    select: (data) => {
      const job = data.jobs.find((job) => job.id === jobId);
      return job && withQueuePosition(job, data.queuePositions);
    },
    enabled: Boolean(jobId) && enabled,
  }).data;
}

/** Progress, phase and Stop while generating; the reason and Retry once failed. */
function TileStatus({
  item,
  onTryAgain,
}: {
  item: MediaItem;
  onTryAgain?: (item: MediaItem) => void;
}) {
  const job = useQueueJob(item.jobId, item.status !== "done");
  const action = useQueueAction(job?.id);
  const [retrying, setRetrying] = useState(false);
  const active = !finished(item);
  const failed = item.status === "failed";
  const label = active
    ? jobStatus(job ?? { status: "queued" })
    : statusLabels[failed ? "failed" : "cancelled"];
  const reason = failed
    ? job?.reason || ("error" in item && typeof item.error === "string" ? item.error : "")
    : active
      ? jobReason(job ?? { status: "queued" })
      : "";
  // A multi-output run shows one Cancel, on its first unfinished placeholder.
  const owner = job?.items.find((entry) => !finished(entry));
  const cancellable =
    active &&
    job &&
    !job.cancelling &&
    !terminalStatuses.has(job.status) &&
    (!owner || owner.id === item.id);
  const retryable = failed && job?.status === "failed" && onTryAgain;
  return (
    <>
      <div className={classes.status} data-failed={failed || undefined}>
        {active ? (
          <Loader size="sm" color="gray" />
        ) : (
          <CircleAlert size={20} color={failed ? "var(--mantine-color-red-6)" : undefined} />
        )}
        <Text size="sm" fw={600} c={failed ? "red" : undefined} lineClamp={3} title={label}>
          {label}
        </Text>
        <Text size="xs" c="dimmed" lineClamp={2} title={reason || undefined}>
          {reason || mediaTitle(item)}
        </Text>
      </div>
      {active && job && (
        <div className={classes.progress}>
          <JobProgressBar job={job} />
        </div>
      )}
      {(cancellable || retryable) && (
        <div className={classes.statusAction}>
          {cancellable ? (
            <Button
              size="compact-sm"
              variant="default"
              radius="xl"
              leftSection={<icons.stop size={14} />}
              aria-label={`Stop ${mediaTitle(item)}`}
              loading={action.isPending}
              onClick={() => action.mutate({ id: job.id, action: "cancel" })}
            >
              Stop
            </Button>
          ) : (
            <Button
              size="compact-sm"
              variant="default"
              radius="xl"
              leftSection={<icons.retry size={14} />}
              aria-label={`Retry ${mediaTitle(item)}`}
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
              Retry
            </Button>
          )}
        </div>
      )}
    </>
  );
}

/** A finished item's upscale while it is queued or running: its progress and Stop. */
function TileUpscale({ item }: { item: MediaItem }) {
  const stop = useStopUpscale(item);
  const job = useQueueJob(item.upscale?.jobId, true);
  if (!stop) return null;
  const reason = job && jobReason(job);
  return (
    <>
      {job && (
        <div className={classes.progress}>
          <JobProgressBar job={job} />
        </div>
      )}
      <div className={classes.statusAction}>
        <Stack align="center" gap={4} miw={0} px="xs">
          {job && (
            <Paper className={classes.upscaleStatus} px="xs" py={4} withBorder>
              <Text size="xs" lineClamp={2}>
                {jobStatus(job)}
              </Text>
              {reason && (
                <Text size="xs" c="dimmed" lineClamp={2} title={reason}>
                  {reason}
                </Text>
              )}
            </Paper>
          )}
          <Button
            size="compact-sm"
            variant="default"
            radius="xl"
            leftSection={<icons.stop size={14} />}
            aria-label={`Stop Upscale of ${mediaTitle(item)}`}
            loading={stop.isPending}
            onClick={stop.stop}
          >
            Stop Upscale
          </Button>
        </Stack>
      </div>
    </>
  );
}

/** One result tile, with media, status and actions. */
export function MediaTile({
  item,
  label,
  selecting = false,
  selected = false,
  select,
  hold,
  caption,
  galleryTile,
  inComparison = false,
  detail,
  actions,
  className,
  style,
  onOpen,
  onMenu,
  onSelectionMenu,
  onTryAgain,
  onKeyDown,
  eager,
  large,
}: {
  item: MediaItem;
  label?: string;
  selecting?: boolean;
  selected?: boolean;
  /** The gallery selection's actions. */
  select?: SelectionActions;
  hold: ReturnType<typeof useHoldToSelect>;
  /** Hover captions, captions always shown, or none (phones without Tile Captions). */
  caption: "hover" | "pinned" | "none";
  galleryTile?: boolean;
  inComparison?: boolean;
  detail?: string;
  actions?: ReactNode;
  className?: string;
  style?: CSSProperties;
  onOpen: () => void;
  onMenu?: () => void;
  onSelectionMenu?: (x: number, y: number) => void;
  onTryAgain?: (item: MediaItem) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** In view now: its thumbnail loads ahead of those placed just outside the view. */
  eager?: boolean;
  /** Wider than the thumbnail covers: a picture shows its display copy. */
  large?: boolean;
}) {
  // Touch holds use Studio's menu or selection instead of a native drag lift.
  const touch = useTouch();
  // Its Stop takes the caption's place at the foot of the tile.
  const upscaleShown = item.status === "done" && upscaling(item) && !selecting;
  const media = mediaSource(item);
  const video = item.type === "video";
  const source =
    (large && !video && media.displayUrl !== media.url ? media.displayUrl : media.thumbnailUrl) ||
    item.preview ||
    (video ? undefined : media.url);
  // A failed load (Studio restarting, say) tries again a few times, waiting longer each time.
  const [retry, setRetry] = useState({ source, count: 0 });
  const attempt = retry.source === source ? retry.count : 0;
  const title = mediaTitle(item);
  const markOrigin = galleryTile && item.status === "done";
  const timestamp = markOrigin ? mediaTimestamp(item) : undefined;
  const badge = markOrigin ? mediaOriginBadge(item, inComparison) : undefined;
  const drifted = !selecting && item.identity?.drifted;
  const faceMark = "Face Check: Face Differs";
  const description = [badge?.label, drifted ? faceMark : undefined].filter(Boolean).join(". ");
  const subtitle = item.resultSet?.caption || detail || comparisonVariant(item);
  const [entering] = useState(
    () => !finished(item) && Date.now() - Date.parse(item.createdAt || "") < 10_000,
  );
  // The rating sits small at the right of the caption's line, where the caption is.
  const rated =
    !galleryTile && item.status === "done" && !upscaleShown && !selecting && Boolean(item.rating);
  const RatingIcon = item.rating === "disliked" ? icons.dislike : icons.like;
  function openMenu(x: number, y: number) {
    if (selecting) {
      if (!onSelectionMenu) return false;
      if (!selected) select!.toggle([item]);
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
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse")
          void event.currentTarget
            .querySelector("video")
            ?.play()
            .catch(() => {});
      }}
      onPointerLeave={(event) => {
        const preview = event.currentTarget.querySelector("video");
        if (!preview) return;
        preview.pause();
        delete preview.dataset.previewing;
      }}
      onContextMenu={(event) => {
        if (hold.held.current === item.id || openMenu(event.clientX, event.clientY))
          event.preventDefault();
      }}
    >
      <UnstyledButton
        className={classes.button}
        data-media-id={item.id}
        aria-label={label || `${selecting ? "Select" : "Open"} ${item.type}: ${title}`}
        aria-description={description || undefined}
        aria-pressed={selecting ? selected : undefined}
        draggable={item.status === "done" && !touch}
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
          if (hold.consumeHold(item.id)) {
            event.preventDefault();
            return;
          }
          if (select?.click([item], event)) return;
          event.currentTarget.focus({ preventScroll: true });
          onOpen();
        }}
      >
        {video && media.url && (
          <video
            className={`${classes.media} ${classes.videoPreview}`}
            data-loaded
            // A mouse over the tile plays Studio's short preview; leaving returns to the poster.
            src={media.url.replace("/comfy/view?", "/comfy/video-preview?")}
            preload="none"
            muted
            loop
            playsInline
            aria-hidden
            onPlaying={(event) => {
              event.currentTarget.dataset.previewing = "";
            }}
          />
        )}
        {source && (
          <img
            key={`${source}#${attempt}`}
            ref={(element) => {
              // Cached images are complete before paint, so they never fade in again.
              if (element?.complete && element.naturalWidth) element.dataset.loaded = "";
            }}
            className={classes.media}
            src={source}
            alt=""
            width={media.width || 1024}
            height={media.height || 1024}
            loading={eager ? "eager" : "lazy"}
            fetchPriority={eager ? "high" : undefined}
            decoding="async"
            draggable={false}
            onLoad={(event) => {
              event.currentTarget.dataset.loaded = "";
            }}
            onError={(event) => {
              if (attempt < 5)
                setTimeout(() => setRetry({ source, count: attempt + 1 }), 1000 * 2 ** attempt);
              else event.currentTarget.dataset.failed = "";
            }}
          />
        )}
        {item.status === "done" && !upscaleShown
          ? caption !== "none" && (
              <div className={classes.caption} data-pinned={caption === "pinned" || undefined}>
                {/* A pinned (phone) caption keeps to two lines in all. */}
                <Text size="sm" fw={500} lineClamp={caption === "pinned" && subtitle ? 1 : 2}>
                  {title}
                </Text>
                {subtitle && (
                  <Text size="xs" opacity={0.8} lineClamp={1}>
                    {subtitle}
                  </Text>
                )}
              </div>
            )
          : null}
        {(timestamp || badge || drifted) && (
          <span className={classes.marks}>
            {(timestamp || badge) && (
              <span className={classes.metadata}>
                {badge && (
                  <span className={classes.sourceBadge} title={badge.label} aria-hidden>
                    <badge.icon size={12} />
                  </span>
                )}
                {timestamp && (
                  <time className={classes.timestamp} dateTime={timestamp.value}>
                    {timestamp.time}
                    <span className={classes.timestampDate}>, {timestamp.day}</span>
                  </time>
                )}
              </span>
            )}
            {drifted && (
              <span className={classes.drift} role="img" aria-label={faceMark}>
                <icons.character size={12} />
                Face
              </span>
            )}
          </span>
        )}
      </UnstyledButton>
      {item.status !== "done" && <TileStatus item={item} onTryAgain={onTryAgain} />}
      {upscaleShown && <TileUpscale item={item} />}
      {rated && (
        <div
          className={classes.rating}
          role="img"
          aria-label={item.rating === "liked" ? "Liked" : "Disliked"}
        >
          <RatingIcon size={14} fill="currentColor" />
        </div>
      )}
      {!selecting && actions}
      {selecting && (
        <Checkbox
          className={classes.check}
          checked={selected}
          aria-label={`Select ${title}`}
          onChange={() => select!.toggle([item])}
        />
      )}
    </div>
  );
}
