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
import { mediaTitle } from "../gallery/mediaLabels";
import { mediaSource } from "../gallery/mediaSource";
import type { SwipeDirection, SwipeGesture } from "../gallery/swipe";
import { VideoPlayButton } from "../gallery/VideoPlayButton";
import { ViewerChrome, ViewerMetadata, ViewerTitle } from "../gallery/ViewerChrome";
import { ViewerDetails } from "../gallery/ViewerDetails";
import { Neighbour, useStrip, useTouchSwipe } from "../gallery/ViewerMediaStrip";
import { zoomImage } from "../gallery/zoomImage";
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

/** Why Dream made a result and the LoRAs it tried, each rated here. */
function Caption({ item, full, title }: { item: DreamItem; full: boolean; title?: string }) {
  const info = useQuery(loraInfoQuery);
  // Clips written before Dream named them say how they were made, over their gallery title.
  const why =
    item.dream?.why ||
    (item.type === "video"
      ? [item.dream?.arm === "extend" ? "Extended" : "Animated", item.title]
          .filter(Boolean)
          .join(" · ")
      : "");
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

function LibraryCaption({ item, full }: { item: MediaItem; full: boolean }) {
  const title = mediaTitle(item);
  const prompt = item.prompt?.trim();
  return (
    <div className={classes.caption}>
      <ViewerTitle item={item} title={title} fw={600} lineClamp={full ? undefined : 2} />
      <ViewerMetadata item={item} />
      {prompt && prompt.toLowerCase() !== title.toLowerCase() && (
        <Text size="sm" c="dimmed" lineClamp={full ? undefined : 2}>
          {prompt}
        </Text>
      )}
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
        <LibraryCaption item={item} full={full} />
      )}
    </div>
  );
}

interface FaceProps {
  item: MediaItem;
  swipe: SwipeGesture;
  /** A tap or click on the media, which cycles the chrome. */
  onTap: () => void;
  bare: boolean;
}

function PreviewImage({ item, swipe, onTap, bare }: FaceProps) {
  const source = mediaSource(item);
  const [ZoomImage] = useState(zoomImage);
  return (
    <div className={classes.fit}>
      {/* The deck card's own picture, already loaded, so the fill is there from the first frame. */}
      <MediaBackdrop src={source.displayUrl} />
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
          onTap={onTap}
          hideControls={bare}
        />
      </Suspense>
    </div>
  );
}

function PreviewFace({ item, swipe, onTap, bare }: FaceProps) {
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
          else if (!isPreviewBackdrop(event.target as HTMLElement, event.clientX, event.clientY))
            onTap();
        },
      })}
    >
      {item.type === "image" ? (
        <PreviewImage item={item} swipe={swipe} onTap={onTap} bare={bare} />
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
  onSuggestionApplied,
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
  onSuggestionApplied?: () => void;
}) {
  const id = useId();
  const closeIfTop = closeWhenTop(id, close);
  const phone = usePhone();
  const [details, setDetails] = useState(false);
  // Taps cycle the chrome, then the chrome with the card's text, then the media alone.
  const [chrome, setChrome] = useState<"standard" | "text" | "bare">("standard");
  const bare = chrome === "bare";
  const stage = useRef<HTMLDivElement>(null);
  const cycleChrome = () => {
    // Hiding the chrome removes any focused control in it; the stage keeps the shortcuts working.
    if (chrome === "text") stage.current?.focus({ preventScroll: true });
    setChrome(chrome === "standard" ? "text" : chrome === "text" ? "bare" : "standard");
  };
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
    if (event.key === "c") return cycleChrome();
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
      variant="viewer"
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
            tabIndex={-1}
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
                  <PreviewFace item={item} swipe={strip.gesture} onTap={cycleChrome} bare={bare} />
                </section>
                <Neighbour item={next} side="next" />
              </div>
            </SwipeCard>
            {chrome === "text" && (
              <CardText
                item={item}
                dreamt={card.kind !== "library"}
                title={
                  card.kind === "set"
                    ? card.title
                    : card.kind === "pair"
                      ? card.question
                      : undefined
                }
              />
            )}
            {play && <VideoPlayButton play={play} />}
          </div>
          <ViewerChrome
            item={item}
            actions={sound}
            hidden={bare}
            details={{ phone, opened: details, toggle: () => setDetails((open) => !open) }}
            close={close}
            closeLabel="Close Preview"
            focusClose
          />
          <div
            className={classes.previewButtons}
            hidden={bare}
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
                <DreamSuggestions
                  card={card}
                  side={side}
                  onMore={() => act("more")}
                  onApplied={onSuggestionApplied ?? close}
                />
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
