import { Text, UnstyledButton } from "@mantine/core";
import type { CSSProperties } from "react";

import { icons } from "../../ui/icons";
import { useTouch } from "../../ui/usePhone";
import { mediaSource } from "../gallery/mediaSource";
import type { PairDeckCard } from "./deck";

import classes from "./DreamPage.module.css";

export const sideNames = ["A", "B"] as const;
export const sideLabel = (card: PairDeckCard, index: number) =>
  `${sideNames[index]}${card.labels ? ` · ${card.labels[index]}` : ""}`;

/**
 * A pair card's content: its question over the two images, side by side (stacked on phones held
 * upright), each as large as fits at its shape. An image is the choice: pressing it (or Enter)
 * calls `choose`, and its label in the corner calls `view`. Dragging toward a side lifts it and
 * fades the other (`--dream-left`, `--dream-right` from `SwipeCard`); `picked` holds a chosen side
 * while the card leaves.
 */
export function PairContent({
  card,
  top,
  picked,
  choose,
  view,
}: {
  card: PairDeckCard;
  top: boolean;
  picked?: 0 | 1;
  choose: (index: 0 | 1) => void;
  view: (index: 0 | 1) => void;
}) {
  const touch = useTouch();
  return (
    <>
      <div className={classes.caption}>
        <Text fw={500} ta="center" lineClamp={1}>
          {card.question}
        </Text>
        <Text size="xs" c="dimmed" ta="center" lineClamp={1}>
          {card.pairId ? "Alike but for one thing" : "From your gallery"} ·{" "}
          {touch ? "tap one to choose, hold to look closer" : "click one to choose"}
        </Text>
      </div>
      <div className={classes.pair}>
        {card.items.map((item, index) => {
          const side = index as 0 | 1;
          const label = sideLabel(card, side);
          return (
            <div
              key={item.id}
              className={classes.choice}
              data-side={side}
              data-picked={picked === undefined ? undefined : picked === side}
            >
              <div
                className={classes.frame}
                style={{ "--ratio": (item.width || 1) / (item.height || 1) } as CSSProperties}
              >
                {/* Swipes start on the image too, so it is a button by role, not a <button>. */}
                <div
                  role="button"
                  tabIndex={top ? 0 : -1}
                  aria-label={`Choose ${label}`}
                  className={classes.pick}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    choose(side);
                  }}
                >
                  <img
                    src={mediaSource(item).displayUrl}
                    alt={item.prompt || "Dream image"}
                    draggable={false}
                  />
                </div>
                <UnstyledButton
                  className={classes.side}
                  aria-label={`View ${label}`}
                  tabIndex={top ? 0 : -1}
                  onClick={() => view(side)}
                >
                  <Text span size="sm" fw={600} truncate>
                    {label}
                  </Text>
                  <icons.preview size={14} />
                </UnstyledButton>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
