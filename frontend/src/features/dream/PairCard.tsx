import { useEffect, useRef, useState, type RefObject } from "react";
import { Paper, Text, UnstyledButton } from "@mantine/core";
import type { MediaItem } from "../../types";
import { useMotionDuration } from "../../ui/Appearance";
import { mediaSource } from "../gallery/mediaSource";
import classes from "./DreamPage.module.css";

/** Picks one side of the pair; resolves once the choice has shown. */
export type Choose = (index: 0 | 1) => Promise<void>;

/**
 * A this-or-that pair of gallery images: tap (or press ← or →) the one you prefer. The choice
 * lifts and the other fades before the next card arrives.
 */
export function PairCard({
  items,
  choose,
  onChoose,
}: {
  items: [MediaItem, MediaItem];
  choose: RefObject<Choose | null>;
  onChoose: (index: 0 | 1) => void;
}) {
  const duration = useMotionDuration();
  const [chosen, setChosen] = useState<0 | 1 | null>(null);
  const picked = useRef(false);
  function pick(index: 0 | 1) {
    if (picked.current) return Promise.resolve();
    picked.current = true;
    setChosen(index);
    return new Promise<void>((resolve) => setTimeout(resolve, duration * 2));
  }
  useEffect(() => {
    choose.current = pick;
    return () => {
      if (choose.current === pick) choose.current = null;
    };
  });
  return (
    <Paper
      withBorder
      radius="lg"
      className={classes.card}
      role="group"
      aria-label="Which Do You Prefer?"
      data-pair
    >
      <div className={classes.caption}>
        <Text fw={500} ta="center">
          Which Do You Prefer?
        </Text>
        <Text size="xs" c="dimmed" ta="center">
          From Your Gallery
        </Text>
      </div>
      <div className={classes.pair}>
        {items.map((item, index) => {
          const source = mediaSource(item);
          return (
            <UnstyledButton
              key={item.id}
              className={classes.choice}
              data-chosen={chosen === null ? undefined : chosen === index}
              aria-label={index ? "Prefer Second Image" : "Prefer First Image"}
              onClick={() => void pick(index as 0 | 1).then(() => onChoose(index as 0 | 1))}
            >
              <img src={source.url} alt={item.prompt || "Gallery image"} draggable={false} />
            </UnstyledButton>
          );
        })}
      </div>
    </Paper>
  );
}
