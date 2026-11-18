import { Badge, CloseButton, Group, Modal, Text, VisuallyHidden } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";

import { loraName } from "../../../../shared/profiles";
import type { MediaItem } from "../../types";
import { mediaSource, playbackUrl } from "../gallery/mediaSource";
import { LoraRatings, loraInfoQuery } from "../generation/LoraPicker";
import type { Choice } from "./choices";
import type { DeckCard } from "./deck";
import { DeckButtons } from "./DeckButtons";
import { sideLabel } from "./PairCard";
import type { DreamItem } from "./queries";

import classes from "./DreamPage.module.css";

/** Why Dream made a result, its prompt and the LoRAs it tried, each rated here; `full` unclamped. */
export function Caption({ item, full = false }: { item: DreamItem; full?: boolean }) {
  const info = useQuery(loraInfoQuery);
  // The LoRAs Dream tried, each rated here so a new one joins (or leaves) the account's Liked LoRAs.
  const loras = (Array.isArray(item.settings?.loras) ? item.settings.loras : [])
    .filter((lora) => lora?.name && lora.enabled !== false)
    .map((lora) => String(lora.name));
  return (
    <div className={classes.caption}>
      {item.dream?.why && (
        <Text size="sm" fw={500} lineClamp={full ? undefined : 1}>
          {item.dream.why}
        </Text>
      )}
      <Text size="xs" c="dimmed" lineClamp={full ? undefined : 2}>
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

function Media({ item }: { item: MediaItem }) {
  const source = mediaSource(item);
  return item.type === "video" ? (
    <video
      src={playbackUrl(source.url)}
      poster={source.thumbnailUrl}
      aria-label={item.prompt || "Dream video"}
      controls
      autoPlay
      muted
      loop
      playsInline
    />
  ) : (
    <img src={source.displayUrl} alt={item.prompt || "Dream image"} />
  );
}

/**
 * The top card whole: each side's media and full text scroll above the deck's own answers, and a
 * comparison's sides swipe across, opening on `side`. An answer closes it and plays out on the deck.
 */
export function DreamPreview({
  card,
  side,
  close,
  act,
}: {
  card: DeckCard;
  side: number;
  close: () => void;
  act: (choice: Choice["choice"]) => void;
}) {
  const items = card.kind === "pair" ? card.items : [card.item];
  // Gallery images show their prompt alone, as on the deck.
  const dreamt = card.kind === "dream" || (card.kind === "pair" && !!card.pairId);
  const track = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(side);
  useLayoutEffect(() => {
    const element = track.current;
    if (element) element.scrollLeft = side * element.clientWidth;
  }, [side]);
  const move = (step: number) => {
    const element = track.current!;
    element.scrollTo({ left: (shown + step) * element.clientWidth });
  };
  return (
    <Modal
      opened
      onClose={close}
      fullScreen
      withCloseButton={false}
      padding={0}
      title={<VisuallyHidden>Preview</VisuallyHidden>}
      removeScrollProps={{ allowPinchZoom: true }}
      classNames={{ header: classes.previewHeader, body: classes.preview }}
      onKeyDown={(event) => {
        if (card.kind !== "pair" || (event.key !== "ArrowLeft" && event.key !== "ArrowRight"))
          return;
        event.preventDefault();
        move(event.key === "ArrowLeft" ? -1 : 1);
      }}
    >
      <Group justify="space-between" wrap="nowrap" p="sm">
        {card.kind === "pair" ? (
          <Badge variant="default" size="lg" radius="xl" fw={500} aria-live="polite">
            {sideLabel(card, shown)}
          </Badge>
        ) : (
          <span />
        )}
        <CloseButton aria-label="Close Preview" data-autofocus onClick={close} />
      </Group>
      <div
        ref={track}
        className={classes.previewTrack}
        onScroll={(event) =>
          setShown(
            Math.round(event.currentTarget.scrollLeft / (event.currentTarget.clientWidth || 1)),
          )
        }
      >
        {items.map((item, index) => (
          <section
            key={item.id}
            className={classes.previewPage}
            aria-label={card.kind === "pair" ? sideLabel(card, index) : undefined}
          >
            <div className={classes.previewMedia}>
              <Media item={item} />
            </div>
            {dreamt ? (
              <Caption item={item as DreamItem} full />
            ) : (
              <div className={classes.caption}>
                <Text size="xs" c="dimmed">
                  {item.prompt}
                </Text>
              </div>
            )}
          </section>
        ))}
      </div>
      <DeckButtons card={card} act={act} hidden={false} />
    </Modal>
  );
}
