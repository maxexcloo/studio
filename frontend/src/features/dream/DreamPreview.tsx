import {
  ActionIcon,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import { useMergedRef } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import {
  type KeyboardEvent,
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
import { icons } from "../../ui/icons";
import { closeWhenTop, layerAbove } from "../../ui/popupClicks";
import { usePhone } from "../../ui/usePhone";
import { mediaSource } from "../gallery/mediaSource";
import type { SwipeDirection, SwipeGesture } from "../gallery/swipe";
import { VideoPlayButton } from "../gallery/VideoPlayButton";
import { ViewerChrome } from "../gallery/ViewerChrome";
import { ViewerDetails } from "../gallery/ViewerDetails";
import { Neighbour, useStrip, useTouchSwipe } from "../gallery/ViewerMediaStrip";
import { LoraRatings, loraInfoQuery } from "../generation/LoraPicker";
import type { Choice } from "./choices";
import type { DeckCard } from "./deck";
import { DeckButtons, DeckUndo } from "./DeckButtons";
import { DeckMedia, MediaBackdrop, useDreamPlayback } from "./DeckMedia";
import { DreamSuggestions } from "./DreamSuggestions";
import { sideLabel } from "./PairCard";
import type { DreamItem, SetOverride, SetOverrides } from "./queries";
import { type Fly, SwipeCard } from "./SwipeCard";

import viewerClasses from "../gallery/MediaViewer.module.css";
import classes from "./DreamPage.module.css";

const ZoomImage = lazy(() =>
  import("../gallery/ZoomImage").then((module) => ({ default: module.ZoomImage })),
);

/** Why Dream made a result and the LoRAs it tried, each rated here. */
function Caption({ item, full, title }: { item: DreamItem; full: boolean; title?: string }) {
  const info = useQuery(loraInfoQuery);
  const why = item.dream?.why || "";
  const [direction, ...details] = why.split(" · ");
  const heading = title || direction || item.resultSet?.variation || item.title;
  const reason = title ? why : details.join(" · ");
  // The LoRAs Dream tried, each rated here so a new one joins (or leaves) the account's Liked LoRAs.
  const loras = (Array.isArray(item.settings?.loras) ? item.settings.loras : [])
    .filter((lora) => lora?.name && lora.enabled !== false)
    .map((lora) => String(lora.name));
  return (
    <div className={classes.caption}>
      {heading && (
        <Text fw={600} lineClamp={full ? undefined : 1}>
          {heading}
        </Text>
      )}
      {reason && (
        <Text size="sm" c="dimmed" lineClamp={full ? undefined : 2}>
          {reason}
        </Text>
      )}
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

function PreviewImage({ item, swipe }: { item: MediaItem; swipe: SwipeGesture }) {
  const source = mediaSource(item);
  return (
    <div className={classes.fit}>
      <MediaBackdrop src={source.thumbnailUrl || source.displayUrl} />
      <Suspense fallback={<DeckMedia item={item} />}>
        <ZoomImage
          mediaId={item.id}
          src={source.displayUrl}
          original={source.url}
          alt={item.prompt || "Dream image"}
          placeholder={source.thumbnailUrl}
          width={source.width}
          height={source.height}
          swipe={swipe}
        />
      </Suspense>
    </div>
  );
}

function PreviewFace({ item, swipe }: { item: MediaItem; swipe: SwipeGesture }) {
  const videoSwipe = useTouchSwipe(swipe);
  const dragged = useRef(false);
  return (
    <div
      className={classes.media}
      {...(item.type === "video" && {
        ...videoSwipe,
        onPointerDown(event: React.PointerEvent) {
          dragged.current = false;
          videoSwipe.onPointerDown(event);
        },
        onPointerUp(event: React.PointerEvent) {
          dragged.current = event.pointerType === "touch" && !videoSwipe.onPointerUp(event);
        },
        onClick(event: React.MouseEvent) {
          if (dragged.current) event.stopPropagation();
        },
      })}
    >
      {item.type === "image" ? (
        <PreviewImage item={item} swipe={swipe} />
      ) : (
        <DeckMedia key={item.id} item={item} playing />
      )}
    </div>
  );
}

/** Whether the press was on the stage's letterbox, outside the picture or video. */
function isPreviewBackdrop(target: HTMLElement, x: number, y: number) {
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

const previewKeys: Partial<Record<string, SwipeDirection>> = {
  ArrowLeft: "right",
  ArrowRight: "left",
  ArrowUp: "up",
  ArrowDown: "down",
};

/** The deck's cards in the shared viewer chrome, with Dream's own verdicts and Undo. */
export function DreamPreview({
  card,
  side,
  setSide,
  overrides,
  toggleOverride,
  canUndo,
  label,
  fly,
  close,
  act,
  askPass,
  undo,
  quickRating,
}: {
  card: DeckCard;
  side: number;
  setSide: (side: number) => void;
  overrides?: SetOverrides;
  toggleOverride: (id: string, value: SetOverride) => void;
  canUndo: boolean;
  label: string;
  fly: RefObject<Fly | null>;
  close: () => void;
  act: (choice: Choice["choice"]) => void;
  askPass: () => void;
  undo: () => void;
  quickRating?: boolean;
}) {
  const id = useId();
  const closeIfTop = closeWhenTop(id, close);
  const phone = usePhone();
  const [details, setDetails] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const [playbackRoot, setPlaybackRoot] = useState<HTMLDivElement | null>(null);
  const stageRef = useMergedRef(stage, setPlaybackRoot);
  const items = card.kind === "pair" || card.kind === "set" ? card.items : undefined;
  const item = (
    card.kind === "pair" || card.kind === "set" ? card.items[side] : card.item
  ) as DreamItem;
  const { play, sound } = useDreamPlayback(stage, !!playbackRoot && item.type === "video", item.id);
  const previous = items?.[side - 1];
  const next = items?.[side + 1];
  function swipe(direction: SwipeDirection) {
    if (layerAbove(stage.current) || (phone && details)) return false;
    if (direction === "down") closeIfTop();
    else if (direction === "up") setDetails(true);
    else if (direction === "left" ? next : previous) {
      setSide(side + (direction === "left" ? 1 : -1));
      return true;
    }
    return false;
  }
  const strip = useStrip({ previous: Boolean(previous), next: Boolean(next) }, swipe);
  useLayoutEffect(() => strip.arrived(), [item.id]);
  function onKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (
      !event.currentTarget.contains(target) ||
      target.closest("aside, input, textarea, select, [contenteditable='true'], [role='slider']") ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      layerAbove(stage.current, event)
    )
      return;
    if (event.key === "u" || event.key === "z") return undo();
    const direction = previewKeys[event.key];
    if (!direction) return;
    event.preventDefault();
    swipe(direction);
  }
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
      styles={{ content: { overflow: "clip" }, body: { overflow: "clip" } }}
      onKeyDown={onKeyDown}
    >
      <div className={viewerClasses.layout}>
        <div className={`${viewerClasses.main} ${classes.previewMain}`}>
          <div
            ref={stageRef}
            className={`${classes.previewStage} ${viewerClasses.viewerStage}`}
            onClick={(event) => {
              if (
                event.detail &&
                isPreviewBackdrop(event.target as HTMLElement, event.clientX, event.clientY)
              )
                closeIfTop();
            }}
          >
            <SwipeCard key={card.key} depth={0} full fly={fly} label={label} hints={{}}>
              <div ref={strip.ref} className={viewerClasses.mediaStrip}>
                <Neighbour item={previous} side="previous" />
                <section
                  className={classes.previewSide}
                  aria-label={
                    card.kind === "pair"
                      ? sideLabel(card, side)
                      : card.kind === "set"
                        ? `Result ${side + 1}`
                        : undefined
                  }
                >
                  <PreviewFace item={item} swipe={strip.gesture} />
                </section>
                <Neighbour item={next} side="next" />
              </div>
            </SwipeCard>
            {play && <VideoPlayButton play={play} />}
          </div>
          <ViewerChrome
            item={item}
            actions={sound}
            details={{ phone, opened: details, toggle: () => setDetails((open) => !open) }}
            close={close}
            closeLabel="Close Preview"
            focusClose
          />
          <div
            className={classes.previewButtons}
            data-actions-hidden={(phone && details) || undefined}
            inert={phone && details}
          >
            {items && (
              <Group justify="center" gap="xs" wrap="nowrap" mb="xs">
                <SegmentedControl
                  aria-label={card.kind === "pair" ? "Comparison Results" : "Set Results"}
                  mih={card.kind === "pair" ? "2.5rem" : undefined}
                  miw={0}
                  styles={
                    card.kind === "pair"
                      ? {
                          control: { minWidth: 0 },
                          label: {
                            paddingInline: "var(--mantine-spacing-xs)",
                            whiteSpace: "normal",
                          },
                          innerLabel: { minWidth: 0, overflowWrap: "anywhere" },
                        }
                      : undefined
                  }
                  value={String(side)}
                  onChange={(value) => setSide(Number(value))}
                  data={items.map((_, index) => {
                    const label = card.kind === "pair" ? sideLabel(card, index) : undefined;
                    return {
                      value: String(index),
                      label: label ? (
                        <Text span size="sm" lh={1.1} lineClamp={2} title={label}>
                          {label}
                        </Text>
                      ) : (
                        String(index + 1)
                      ),
                    };
                  })}
                />
                {card.kind === "set" &&
                  (
                    [
                      { value: "like", label: "Like This Image", icon: icons.like, colour: "pink" },
                      {
                        value: "discard",
                        label: "Deny This Image",
                        icon: icons.dislike,
                        colour: "red",
                      },
                    ] as const
                  ).map(({ value, label, icon: Icon, colour }) => (
                    <Tooltip key={value} label={label}>
                      <ActionIcon
                        size="md"
                        color={colour}
                        variant={overrides?.[item.id] === value ? "light" : "default"}
                        aria-label={label}
                        aria-pressed={overrides?.[item.id] === value}
                        onClick={() => toggleOverride(item.id, value)}
                      >
                        <Icon size={16} />
                      </ActionIcon>
                    </Tooltip>
                  ))}
              </Group>
            )}
            <DeckButtons
              card={card}
              quickRating={quickRating}
              act={act}
              askPass={askPass}
              hidden={false}
              expanded
              singleImageComparison={card.kind === "pair" && item.type === "image"}
              trailing={
                quickRating ? undefined : (
                  <DreamSuggestions card={card} side={side} onMore={() => act("more")} />
                )
              }
              leading={<DeckUndo disabled={!canUndo} onClick={undo} />}
            />
          </div>
        </div>
        <ViewerDetails item={item} opened={details} phone={phone} close={() => setDetails(false)}>
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
