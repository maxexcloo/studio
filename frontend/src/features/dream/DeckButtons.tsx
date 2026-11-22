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
  both: { glyph: <Check size={30} strokeWidth={2.5} />, color: "green" },
};

export function DeckUndo({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <Tooltip label="Undo">
      <ActionIcon
        variant="default"
        radius="xl"
        size="md"
        aria-label="Undo"
        disabled={disabled}
        onClick={onClick}
      >
        <icons.undo size={18} />
      </ActionIcon>
    </Tooltip>
  );
}

/** The deck's verdicts, with its smaller Undo and Suggestions controls on either side. */
export function DeckButtons({
  card,
  act,
  hidden,
  expanded,
  leading,
  trailing,
}: {
  card: DeckCard;
  act: (choice: Choice["choice"]) => void;
  hidden: boolean;
  expanded?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  const answers = dreamChoices(card).at(-1)!;
  const labels: Record<string, string> = {
    both: "Accept",
    discard: card.kind === "set" ? "Deny All" : "Pass",
    keep: "Accept",
    like: "Super Like",
    neither: "Pass",
  };
  const rate = expanded ? "Rate This Image & Keep Set" : "Rate Cover & Keep Set";
  return (
    <div
      role="group"
      aria-label={card.kind === "pair" ? "Comparison Answers" : "Dream Actions"}
      className={classes.buttons}
      data-comparison-size={card.kind === "pair" ? card.items.length : undefined}
      aria-hidden={hidden}
      inert={hidden}
    >
      {leading}
      {answers.map(({ choice, id, label }) => {
        const side = id === "a" || id === "b" || id === "c";
        const title = labels[id] ?? label;
        const description = id === "like" && card.kind === "set" ? rate : undefined;
        return (
          <Tooltip key={id} label={description ?? title}>
            <ActionIcon
              className={classes.answer}
              variant="light"
              color={side ? "blue" : looks[id].color}
              radius="50%"
              data-size={
                side && card.kind === "pair" && card.items.length === 2 ? "large" : undefined
              }
              aria-label={title}
              aria-description={description}
              onClick={() => act(choice)}
            >
              {side ? (
                <Text fw={700} fz={26}>
                  {label}
                </Text>
              ) : (
                looks[id].glyph
              )}
            </ActionIcon>
          </Tooltip>
        );
      })}
      {trailing}
    </div>
  );
}
