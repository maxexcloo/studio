import { Text, UnstyledButton } from "@mantine/core";
import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";

import type { PairDeckCard } from "./deck";
import { DeckMedia } from "./DeckMedia";

import classes from "./DreamPage.module.css";

export const sideNames = ["A", "B"] as const;
export const sideLabel = (card: PairDeckCard, index: number) =>
  `${sideNames[index]}${card.labels ? ` · ${card.labels[index]}` : ""}`;

/**
 * Whether the sides show larger next to each other than one above the other: when the space is
 * wider, for its height, than one side's shape.
 */
function useSideBySide(ratio: number) {
  const pair = useRef<HTMLDivElement>(null);
  const [beside, setBeside] = useState(true);
  useLayoutEffect(() => {
    const element = pair.current!;
    const measure = () =>
      setBeside(element.clientWidth / Math.max(1, element.clientHeight) >= ratio);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ratio]);
  return { pair, beside };
}

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
  const [first] = card.items;
  const { pair, beside } = useSideBySide((first.width || 1) / (first.height || 1));
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
                  <DeckMedia item={item} playing={top} />
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
