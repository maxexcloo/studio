import { ActionIcon, type MantineColor, Text, Tooltip } from "@mantine/core";
import { Check, Heart, X } from "lucide-react";
import type { ReactNode } from "react";

import { icons } from "../../ui/icons";
import { type Choice, dreamChoices } from "./choices";
import type { DeckCard } from "./deck";

import classes from "./DreamPage.module.css";

/** Each answer's round button: its glyph, or a comparison side's letter, and its tint. */
const looks: Record<string, { glyph: ReactNode; color: MantineColor }> = {
  discard: { glyph: <X size={30} strokeWidth={2.5} />, color: "red" },
  like: { glyph: <Heart size={28} strokeWidth={2.5} />, color: "pink" },
  keep: { glyph: <Check size={30} strokeWidth={2.5} />, color: "green" },
  neither: { glyph: <X size={30} strokeWidth={2.5} />, color: "red" },
  a: {
    glyph: (
      <Text fw={700} fz={28}>
        A
      </Text>
    ),
    color: "blue",
  },
  b: {
    glyph: (
      <Text fw={700} fz={28}>
        B
      </Text>
    ),
    color: "blue",
  },
  both: { glyph: <Check size={30} strokeWidth={2.5} />, color: "green" },
  shown: { glyph: <icons.winner size={30} strokeWidth={2.5} />, color: "blue" },
};

/**
 * The deck's answers as large round buttons under the card, as dating apps have them: a single
 * card's Dislike, Like and Accept, or a comparison's Neither, A, B and Both. Where one side is
 * `shown` alone, This Image answers for it in place of A and B.
 */
export function DeckButtons({
  card,
  act,
  hidden,
  shown,
}: {
  card: DeckCard;
  act: (choice: Choice["choice"]) => void;
  hidden: boolean;
  shown?: number;
}) {
  const answers = dreamChoices(card)
    .at(-1)!
    .flatMap((answer): Choice[] =>
      shown === undefined || (answer.id !== "a" && answer.id !== "b")
        ? [answer]
        : answer.id === "a"
          ? [
              { ...answer, id: "shown", label: "This Image", choice: shown ? "b" : "a" },
              ...(card.kind === "pair" && card.pairId
                ? [{ choice: "like" as const, id: "like", label: "Like", icon: icons.like }]
                : []),
            ]
          : [],
    );
  return (
    <div
      role="group"
      aria-label={card.kind === "pair" ? "Comparison Answers" : "Dream Actions"}
      className={classes.buttons}
      aria-hidden={hidden}
      inert={hidden}
    >
      {answers.map(({ choice, id, label }) => (
        <Tooltip key={id} label={label}>
          <ActionIcon
            className={classes.answer}
            variant="light"
            color={looks[id].color}
            radius="50%"
            // A comparison's sides stand out from Neither and Both.
            data-size={
              card.kind !== "pair"
                ? undefined
                : id === "a" || id === "b" || id === "shown" || id === "like"
                  ? "large"
                  : "small"
            }
            aria-label={label}
            onClick={() => act(choice)}
          >
            {looks[id].glyph}
          </ActionIcon>
        </Tooltip>
      ))}
    </div>
  );
}
