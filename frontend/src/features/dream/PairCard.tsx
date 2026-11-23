import { Text, UnstyledButton } from "@mantine/core";

import { useSideways } from "../../ui/usePhone";
import { letter } from "../compare/inputs";
import type { PairDeckCard } from "./deck";
import { DeckMedia } from "./DeckMedia";
import { besideFits, useBoxShape } from "./mediaFit";

import classes from "./DreamPage.module.css";

export const sideLabel = (card: PairDeckCard, index: number) =>
  `${letter(index)}${card.labels ? ` · ${card.labels[index]}` : ""}`;

/** Comparison media opens the shared preview; the bottom bar owns the choices. */
export function PairContent({
  card,
  top,
  playing,
  picked,
  shown,
  select,
  view,
}: {
  card: PairDeckCard;
  top: boolean;
  playing: boolean;
  picked?: number;
  shown?: number;
  select: (side: number) => void;
  view: (index: number) => void;
}) {
  const [first] = card.items;
  const sideways = useSideways();
  const { ref: pair, box } = useBoxShape<HTMLDivElement>();
  const beside = besideFits((first.width || 1) / (first.height || 1), box);
  return (
    <>
      <div className={classes.caption}>
        <Text fw={600} size="sm" ta="center" lineClamp={sideways ? undefined : 1}>
          {card.question}
        </Text>
        <Text size="xs" c="dimmed" ta="center">
          Alike but for one thing
        </Text>
      </div>
      <div
        ref={pair}
        className={classes.pair}
        data-stacked={!beside || undefined}
        data-comparison-size={card.items.length}
      >
        {card.items.map((item, side) => {
          const label = sideLabel(card, side);
          return (
            <div
              key={item.id}
              className={classes.choice}
              data-side={side}
              data-picked={picked === undefined ? undefined : picked === side}
              data-selected={shown === side || undefined}
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
                  aria-label={`${shown === undefined ? "Preview" : "Select"} ${label}`}
                  aria-pressed={shown === undefined ? undefined : shown === side}
                  tabIndex={top ? 0 : -1}
                  onClick={() => (shown === undefined ? view(side) : select(side))}
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
