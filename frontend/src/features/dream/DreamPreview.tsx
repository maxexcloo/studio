import { Badge, Button, CloseButton, Group, Modal, Text, VisuallyHidden } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  Suspense,
  lazy,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { loraName } from "../../../../shared/profiles";
import type { MediaItem } from "../../types";
import { icons } from "../../ui/icons";
import { mediaSource } from "../gallery/mediaSource";
import { dragAxis, swipeDirection } from "../gallery/swipe";
import { LoraRatings, loraInfoQuery } from "../generation/LoraPicker";
import type { Choice } from "./choices";
import type { DeckCard, PairDeckCard } from "./deck";
import { DeckButtons } from "./DeckButtons";
import { DeckMedia, MediaBackdrop } from "./DeckMedia";
import { covers, useBoxShape } from "./mediaFit";
import { sideLabel } from "./PairCard";
import type { DreamItem } from "./queries";

import classes from "./DreamPage.module.css";

const ZoomImage = lazy(() =>
  import("../gallery/ZoomImage").then((module) => ({ default: module.ZoomImage })),
);

/** Why Dream made a result, its prompt and the LoRAs it tried, each rated here; `full` unclamped. */
export function Caption({
  item,
  full = false,
  readOnly = false,
}: {
  item: DreamItem;
  full?: boolean;
  readOnly?: boolean;
}) {
  const info = useQuery(loraInfoQuery);
  // The LoRAs Dream tried, each rated here so a new one joins (or leaves) the account's Liked LoRAs.
  const loras = (Array.isArray(item.settings?.loras) ? item.settings.loras : [])
    .filter((lora) => lora?.name && lora.enabled !== false)
    .map((lora) => String(lora.name));
  return (
    <div className={classes.caption}>
      {item.dream?.why && (
        <Text fw={600} lineClamp={full ? undefined : 1}>
          {item.dream.why}
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
            {!readOnly && <LoraRatings file={file} title={title} />}
          </Group>
        );
      })}
    </div>
  );
}

/**
 * A card's text over the bottom of its media on a dark scrim: a Dream result's caption, or a
 * gallery image's prompt alone. With `expand` a tap shows it all, scrolling within the scrim.
 */
export function CardText({
  item,
  dreamt,
  readOnly = false,
  expand = false,
  full = false,
}: {
  item: MediaItem;
  dreamt: boolean;
  readOnly?: boolean;
  expand?: boolean;
  /** All of it from the start, as in a sideways phone's text column. */
  full?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = dreamt ? (
    <Caption item={item as DreamItem} full={full || expanded} readOnly={readOnly} />
  ) : (
    <div className={classes.caption}>
      <Text size="sm" c="dimmed" lineClamp={full || expanded ? undefined : 2}>
        {item.prompt}
      </Text>
    </div>
  );
  return (
    <div className={classes.overlay}>
      {expand ? (
        <div
          className={classes.overlayText}
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-label={expanded ? "Show Less" : "Show More"}
          // Expanded, the text scrolls rather than swiping the card.
          data-scrolls={expanded || undefined}
          onClick={() => setExpanded(!expanded)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            setExpanded(!expanded);
          }}
        >
          {text}
        </div>
      ) : (
        text
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

/** One result's face in the preview: its media edge to edge, its text over the bottom. */
export function PreviewFace({
  item,
  dreamt,
  active = true,
}: {
  item: MediaItem;
  dreamt: boolean;
  /** A comparison's hidden side shows its still. */
  active?: boolean;
}) {
  return (
    <>
      <div className={classes.media}>
        {item.type === "image" ? (
          <PreviewImage item={item} />
        ) : (
          <DeckMedia item={item} playing={active} />
        )}
      </div>
      <CardText item={item} dreamt={dreamt} readOnly expand />
    </>
  );
}

/**
 * A comparison's sides in the preview, one at a time: a sideways swipe over media at rest follows
 * the finger to the other side, while zoomed media pans instead.
 */
export function PreviewSides({
  card,
  side,
  setSide,
  onLike,
}: {
  card: PairDeckCard;
  side: number;
  setSide: (side: number) => void;
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
    if (direction === "up" && onLike) return onLike();
    const next = direction === "left" ? side + 1 : direction === "right" ? side - 1 : side;
    if (next !== side && next >= 0 && next < card.items.length) setSide(next);
    else place(0, true);
  };
  return (
    <div
      ref={strip}
      className={classes.previewSides}
      onPointerDown={(event) => {
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
          aria-label={sideLabel(card, index)}
          aria-hidden={index !== side}
          inert={index !== side}
        >
          <PreviewFace item={item} dreamt={!!card.pairId} active={index === side} />
        </section>
      ))}
    </div>
  );
}

/**
 * The top card full screen, with the next waiting behind (`children`, the deck's own swipe cards):
 * its media edge to edge with its text over the bottom, and the deck's answers, Undo and Close
 * floating over it. Answers and swipes judge here, and Undo steps back, as on the deck.
 */
export function DreamPreview({
  card,
  side,
  canUndo,
  children,
  close,
  act,
  undo,
  onKeyDown,
}: {
  card: DeckCard;
  side: number;
  canUndo: boolean;
  children: ReactNode;
  close: () => void;
  act: (choice: Choice["choice"]) => void;
  undo: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
}) {
  return (
    <Modal
      opened
      onClose={close}
      fullScreen
      withCloseButton={false}
      padding={0}
      title={<VisuallyHidden>Preview</VisuallyHidden>}
      removeScrollProps={{ allowPinchZoom: true }}
      classNames={{
        content: classes.previewContent,
        header: classes.previewHeader,
        body: classes.preview,
      }}
      onKeyDown={onKeyDown}
    >
      <div className={classes.previewStage}>{children}</div>
      <Group className={classes.previewTop} justify="space-between" wrap="nowrap">
        {card.kind === "pair" ? (
          <Badge variant="default" size="lg" radius="xl" fw={500} aria-live="polite">
            {sideLabel(card, side)}
          </Badge>
        ) : (
          <span />
        )}
        <Group gap="xs" wrap="nowrap">
          <Button
            size="compact-sm"
            variant="default"
            radius="xl"
            leftSection={<icons.undo size={14} />}
            disabled={!canUndo}
            onClick={undo}
          >
            Undo
          </Button>
          <CloseButton
            className={classes.previewClose}
            radius="xl"
            aria-label="Close Preview"
            data-autofocus
            onClick={close}
          />
        </Group>
      </Group>
      <div className={classes.previewButtons}>
        <DeckButtons
          card={card}
          act={act}
          hidden={false}
          shown={card.kind === "pair" ? side : undefined}
        />
      </div>
    </Modal>
  );
}
