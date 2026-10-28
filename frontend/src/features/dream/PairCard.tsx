import type { ReactNode } from "react";
import { Text } from "@mantine/core";
import { mediaSource } from "../gallery/mediaSource";
import type { PairDeckCard } from "./deck";
import classes from "./DreamPage.module.css";

export const sideNames = ["A", "B"] as const;

/**
 * A pair card's content: its question over the two images, A and B side by side (stacked on
 * phones), each named by what it has of the thing that varies. Dragging toward a side lifts it and
 * fades the other (`--dream-left`, `--dream-right` from `SwipeCard`).
 */
export function PairContent({
  card,
  view,
}: {
  card: PairDeckCard;
  /** The action that opens a side in the viewer. */
  view: (index: 0 | 1) => ReactNode;
}) {
  return (
    <>
      <div className={classes.caption}>
        <Text fw={500} ta="center">
          {card.question}
        </Text>
        <Text size="xs" c="dimmed" ta="center">
          {card.pairId ? "Alike But for One Thing" : "From Your Gallery"}
        </Text>
      </div>
      <div className={classes.pair}>
        {card.items.map((item, index) => (
          <div key={item.id} className={classes.choice} data-side={index}>
            <img src={mediaSource(item).url} alt={item.prompt || "Dream image"} draggable={false} />
            <Text size="sm" fw={500} className={classes.side}>
              {sideNames[index]}
              {card.labels ? ` · ${card.labels[index]}` : ""}
            </Text>
            {view(index as 0 | 1)}
          </div>
        ))}
      </div>
    </>
  );
}
