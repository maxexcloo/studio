import { Text, UnstyledButton } from "@mantine/core";
import type { CSSProperties } from "react";

import { icons } from "../../ui/icons";
import { mediaSource } from "../gallery/mediaSource";
import type { PairDeckCard } from "./deck";

import classes from "./DreamPage.module.css";

export const sideNames = ["A", "B"] as const;
export const sideLabel = (card: PairDeckCard, index: number) =>
  `${sideNames[index]}${card.labels ? ` · ${card.labels[index]}` : ""}`;

/** Comparison media opens the shared preview; the bottom bar owns the choices. */
export function PairContent({
  card,
  top,
  picked,
  view,
}: {
  card: PairDeckCard;
  top: boolean;
  picked?: 0 | 1;
  view: (index: 0 | 1) => void;
}) {
  return (
    <>
      <div className={classes.caption}>
        <Text fw={500} ta="center" lineClamp={1}>
          {card.question}
        </Text>
        <Text size="xs" c="dimmed" ta="center" lineClamp={1}>
          {card.pairId ? "Alike but for one thing" : "From your gallery"} · Tap to Look Closer
        </Text>
      </div>
      <div className={classes.pair}>
        {card.items.map((item, index) => {
          const side = index as 0 | 1;
          const label = sideLabel(card, side);
          const source = mediaSource(item);
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
                {/* SwipeCard owns pointer taps and swipes; keys open the same preview. */}
                <div
                  role="button"
                  tabIndex={top ? 0 : -1}
                  aria-label={`View ${label}`}
                  data-preview-id={item.id}
                  className={classes.pick}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    view(side);
                  }}
                >
                  <img
                    src={item.type === "video" ? source.thumbnailUrl : source.displayUrl}
                    alt={item.prompt || (item.type === "video" ? "Dream video" : "Dream image")}
                    draggable={false}
                  />
                </div>
                <UnstyledButton
                  className={classes.side}
                  aria-label={`Preview ${label}`}
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
