import { ActionIcon, type MantineColor, Text, Tooltip } from "@mantine/core";
import { Check, Heart, X } from "lucide-react";
import type { ReactNode } from "react";

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
      <Text fw={700} fz={22}>
        A
      </Text>
    ),
    color: "blue",
  },
  b: {
    glyph: (
      <Text fw={700} fz={22}>
        B
      </Text>
    ),
    color: "blue",
  },
  both: { glyph: <Check size={30} strokeWidth={2.5} />, color: "green" },
};

/**
 * The deck's answers as large round buttons under the card, as dating apps have them: a single
 * card's Dislike, Like and Accept, or a comparison's Neither, A, B and Both.
 */
export function DeckButtons({
  card,
  act,
  hidden,
}: {
  card: DeckCard;
  act: (choice: Choice["choice"]) => void;
  hidden: boolean;
}) {
  const answers = dreamChoices(card).at(-1)!;
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
            radius="xl"
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
