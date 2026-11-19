import { Text, UnstyledButton } from "@mantine/core";

import { useSideways } from "../../ui/usePhone";
import type { PairDeckCard } from "./deck";
import { DeckMedia } from "./DeckMedia";
import { besideFits, useBoxShape } from "./mediaFit";

import classes from "./DreamPage.module.css";

export const sideNames = ["A", "B"] as const;
export const sideLabel = (card: PairDeckCard, index: number) =>
  `${sideNames[index]}${card.labels ? ` · ${card.labels[index]}` : ""}`;

/** Comparison media opens the shared preview; the bottom bar owns the choices. */
export function PairContent({
  card,
  top,
  playing,
  picked,
  view,
}: {
  card: PairDeckCard;
  top: boolean;
  playing: boolean;
  picked?: 0 | 1;
  view: (index: 0 | 1) => void;
}) {
  const [first] = card.items;
  const sideways = useSideways();
  const { ref: pair, box } = useBoxShape<HTMLDivElement>();
  const beside = besideFits((first.width || 1) / (first.height || 1), box);
  return (
    <>
      <div className={classes.caption}>
        <Text fw={500} ta="center" lineClamp={sideways ? undefined : 1}>
          {card.question}
        </Text>
        <Text size="xs" c="dimmed" ta="center" lineClamp={sideways ? undefined : 1}>
          {card.pairId ? "Alike but for one thing" : "From your gallery"} · Tap to Look Closer
        </Text>
      </div>
      <div ref={pair} className={classes.pair} data-stacked={!beside || undefined}>
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
              <div className={classes.frame}>
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
                  <DeckMedia item={item} playing={playing} />
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
                </UnstyledButton>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
