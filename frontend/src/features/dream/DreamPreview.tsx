import { Badge, Group, Modal, SegmentedControl, Stack, Text, VisuallyHidden } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  Suspense,
  lazy,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { loraName } from "../../../../shared/profiles";
import type { MediaItem } from "../../types";
import { closeWhenTop } from "../../ui/popupClicks";
import { usePhone } from "../../ui/usePhone";
import { mediaSource } from "../gallery/mediaSource";
import { dragAxis, swipeDirection } from "../gallery/swipe";
import { ViewerChrome, viewerBadge } from "../gallery/ViewerChrome";
import { ViewerDetails } from "../gallery/ViewerDetails";
import { LoraRatings, loraInfoQuery } from "../generation/LoraPicker";
import type { Choice } from "./choices";
import type { DeckCard, MultiDeckCard } from "./deck";
import { DeckButtons, DeckUndo } from "./DeckButtons";
import { DeckMedia, MediaBackdrop } from "./DeckMedia";
import { covers, useBoxShape } from "./mediaFit";
import { sideLabel } from "./PairCard";
import type { DreamItem } from "./queries";
import { tapDistance } from "./SwipeCard";

import viewerClasses from "../gallery/MediaViewer.module.css";
import classes from "./DreamPage.module.css";

const ZoomImage = lazy(() =>
  import("../gallery/ZoomImage").then((module) => ({ default: module.ZoomImage })),
);

/** Why Dream made a result, its prompt and the LoRAs it tried, each rated here; `full` unclamped. */
function Caption({ item, full, title }: { item: DreamItem; full: boolean; title?: string }) {
  const info = useQuery(loraInfoQuery);
  // The LoRAs Dream tried, each rated here so a new one joins (or leaves) the account's Liked LoRAs.
  const loras = (Array.isArray(item.settings?.loras) ? item.settings.loras : [])
    .filter((lora) => lora?.name && lora.enabled !== false)
    .map((lora) => String(lora.name));
  return (
    <div className={classes.caption}>
      {(title || item.dream?.why) && (
        <Text fw={600} lineClamp={full ? undefined : 1}>
          {title || item.dream?.why}
        </Text>
      )}
      <Text size="sm" c="dimmed" lineClamp={full ? undefined : 2}>
        {item.prompt || item.dream?.prompt}
      </Text>
      {loras.map((file) => {
        const title = loraName(file, info.data?.loras[file]);
        return (
          <Group key={file} gap="xs" wrap="nowrap" justify="space-between">
            <Text size="xs" truncate>
              LoRA: {title}
            </Text>
            <LoraRatings file={file} title={title} />
          </Group>
        );
      })}
    </div>
  );
}

/** The deck's short caption over the media, or alongside it when held sideways. */
export function CardText({
  item,
  dreamt,
  title,
  full = false,
}: {
  item: MediaItem;
  dreamt: boolean;
  title?: string;
  full?: boolean;
}) {
  return (
    <div className={classes.overlay}>
      {dreamt ? (
        <Caption item={item as DreamItem} full={full} title={title} />
      ) : (
        <div className={classes.caption}>
          <Text size="sm" c="dimmed" lineClamp={full ? undefined : 2}>
            {item.prompt}
          </Text>
        </div>
      )}
    </div>
  );
}

/**
 * Media filling the preview: a picture zooms with pinch, double tap and wheel, resting filled where
 * little is cropped (`covers`) and otherwise whole over its backdrop; a video plays as on the card.
 */
function PreviewImage({ item }: { item: MediaItem }) {
  const source = mediaSource(item);
  const { ref, box } = useBoxShape<HTMLDivElement>();
  const cover = !!source.width && !!source.height && covers(source.width / source.height, box);
  return (
    <div ref={ref} className={classes.fit}>
      {!cover && <MediaBackdrop src={source.thumbnailUrl || source.displayUrl} />}
      <Suspense fallback={<DeckMedia item={item} />}>
        <ZoomImage
          mediaId={item.id}
          src={source.displayUrl}
          original={source.url}
          alt={item.prompt || "Dream image"}
          placeholder={source.thumbnailUrl}
          width={source.width}
          height={source.height}
          fill={cover}
        />
      </Suspense>
    </div>
  );
}

/** A preview fills its stage. A comparison's hidden side shows a still. */
export function PreviewFace({ item, active = true }: { item: MediaItem; active?: boolean }) {
  return (
    <div className={classes.media}>
      {item.type === "image" ? (
        <PreviewImage item={item} />
      ) : (
        <DeckMedia item={item} playing={active} />
      )}
    </div>
  );
}

/** Whether the press was on the stage's letterbox, outside the picture or video. */
export function isPreviewBackdrop(target: HTMLElement, x: number, y: number) {
  if (target.closest("button, a, [data-zoomed], [data-zoom-controls]")) return false;
  const fit = target.closest<HTMLElement>(`.${classes.fit}`);
  if (!fit) return false;
  const media = fit.querySelector<HTMLVideoElement | HTMLImageElement>(
    ":scope > video, :scope > img:not([aria-hidden])",
  );
  // ZoomImage's picture has its own footprint. An unzoomable video or still fills a contain box.
  if (!media) return true;
  if (fit.dataset.cover) return false;
  const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
  const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
  if (!width || !height) return false;
  const rect = media.getBoundingClientRect();
  const scale = Math.min(rect.width / width, rect.height / height);
  return (
    Math.abs(x - (rect.x + rect.width / 2)) > (width * scale) / 2 ||
    Math.abs(y - (rect.y + rect.height / 2)) > (height * scale) / 2
  );
}

/**
 * Comparison and set members follow sideways swipes at rest. Zoomed media pans.
 */
export function PreviewSides({
  card,
  side,
  playing,
  setSide,
  onClose,
  onTap,
  onLike,
}: {
  card: MultiDeckCard;
  side: number;
  playing: boolean;
  setSide: (side: number) => void;
  onClose: () => void;
  onTap: (target: HTMLElement, x: number, y: number) => void;
  onLike?: () => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const press = useRef<{ id: number; x: number; y: number; drag?: "x" | "y" } | null>(null);
  const shown = useRef(side);
  const place = (dx: number, animate: boolean) => {
    const node = strip.current!;
    node.style.transition = animate ? "" : "none";
    node.style.transform = `translateX(calc(${-side * 100}% + ${dx}px))`;
  };
  // It opens on its side, and slides only when the side changes.
  useLayoutEffect(() => {
    place(0, shown.current !== side);
    shown.current = side;
  }, [side]);
  const release = (event: PointerEvent) => {
    const from = press.current;
    if (from?.id !== event.pointerId) return;
    press.current = null;
    const direction =
      event.type === "pointerup"
        ? swipeDirection(event.clientX - from.x, event.clientY - from.y)
        : undefined;
    if (direction === "down") return onClose();
    if (direction === "up" && onLike) return onLike();
    if (
      event.type === "pointerup" &&
      !from.drag &&
      Math.hypot(event.clientX - from.x, event.clientY - from.y) < tapDistance
    )
      return onTap(event.target as HTMLElement, from.x, from.y);
    const next = direction === "left" ? side + 1 : direction === "right" ? side - 1 : side;
    if (next !== side && next >= 0 && next < card.items.length) setSide(next);
    else place(0, true);
  };
  return (
    <div
      ref={strip}
      className={classes.previewSides}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // A second finger pinches.
        if (press.current) {
          press.current = null;
          return place(0, true);
        }
        const pressed = event.target as HTMLElement;
        if (pressed.closest("[data-zoomed], [data-scrolls], [data-zoom-controls]")) return;
        pressed.setPointerCapture(event.pointerId);
        press.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }}
      onPointerMove={(event) => {
        const from = press.current;
        if (from?.id !== event.pointerId) return;
        const dx = event.clientX - from.x;
        from.drag ??= dragAxis(dx, event.clientY - from.y);
        if (from.drag !== "x") return;
        // Past either end it resists.
        const open = dx < 0 ? side < card.items.length - 1 : side > 0;
        place(open ? dx : dx / 3, false);
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      {card.items.map((item, index) => (
        <section
          key={item.id}
          className={classes.previewSide}
          aria-label={card.kind === "pair" ? sideLabel(card, index) : `Result ${index + 1}`}
          aria-hidden={index !== side}
          inert={index !== side}
        >
          <PreviewFace item={item} active={playing && index === side} />
        </section>
      ))}
    </div>
  );
}

/** The deck's cards in the shared viewer chrome, with Dream's own verdicts and Undo. */
export function DreamPreview({
  card,
  side,
  setSide,
  canUndo,
  children,
  close,
  backdropTap,
  act,
  undo,
  suggest,
  onKeyDown,
}: {
  card: DeckCard;
  side: number;
  setSide: (side: number) => void;
  canUndo: boolean;
  children: ReactNode;
  close: () => void;
  backdropTap: RefObject<boolean>;
  act: (choice: Choice["choice"]) => void;
  undo: () => void;
  suggest?: ReactNode;
  onKeyDown: (event: KeyboardEvent) => void;
}) {
  const id = useId();
  const closeIfTop = closeWhenTop(id, close);
  const phone = usePhone();
  const [details, setDetails] = useState(false);
  const bottomBar = useRef<HTMLDivElement>(null);
  const picked = card.kind === "pair" || card.kind === "set" ? card.items[side] : card.item;
  const item = picked as DreamItem;
  return (
    <Modal
      id={id}
      opened
      onClose={closeIfTop}
      fullScreen
      withCloseButton={false}
      padding={0}
      title={<VisuallyHidden>Preview</VisuallyHidden>}
      removeScrollProps={{ allowPinchZoom: true }}
      classNames={{
        content: classes.previewContent,
        header: viewerClasses.header,
        body: viewerClasses.body,
      }}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (!event.currentTarget.contains(target) || target.closest("aside") || (phone && details))
          return;
        onKeyDown(event);
      }}
    >
      <div className={viewerClasses.layout}>
        <div className={`${viewerClasses.main} ${classes.previewMain}`}>
          <div
            className={classes.previewStage}
            onPointerDownCapture={() => {
              backdropTap.current = false;
            }}
            onClick={(event) => {
              if (!event.detail || !backdropTap.current) return;
              backdropTap.current = false;
              // Wait for the tap's click so it cannot take the returned focus away.
              closeIfTop();
            }}
          >
            {children}
          </div>
          <ViewerChrome
            item={item}
            label={
              card.kind === "pair" && (
                <Badge {...viewerBadge} aria-live="polite">
                  {sideLabel(card, side)}
                </Badge>
              )
            }
            details={{ phone, opened: details, toggle: () => setDetails((open) => !open) }}
            close={close}
            closeLabel="Close Preview"
            focusClose
          />
          <div ref={bottomBar} className={classes.previewButtons}>
            {card.kind === "set" && (
              <Group justify="center" mb="xs">
                <SegmentedControl
                  aria-label="Set Results"
                  size="sm"
                  value={String(side)}
                  onChange={(value) => setSide(Number(value))}
                  data={card.items.map((_, index) => ({
                    value: String(index),
                    label: String(index + 1),
                  }))}
                />
              </Group>
            )}
            <DeckButtons
              card={card}
              act={act}
              hidden={false}
              shown={card.kind === "pair" ? side : undefined}
              trailing={suggest}
              leading={<DeckUndo disabled={!canUndo} onClick={undo} />}
            />
          </div>
        </div>
        <ViewerDetails
          item={item}
          opened={details}
          phone={phone}
          close={() => setDetails(false)}
          bottomBar={bottomBar}
        >
          {item.dream && (
            <Stack gap={4}>
              <Text size="sm" fw={600}>
                Why Dream Made This
              </Text>
              {card.kind === "pair" && <Text size="sm">{card.question}</Text>}
              {item.dream.why && (
                <Text size="sm" c="dimmed">
                  {item.dream.why}
                </Text>
              )}
            </Stack>
          )}
        </ViewerDetails>
      </div>
    </Modal>
  );
}
