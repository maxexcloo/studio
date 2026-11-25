import { ActionIcon, type MantineColor, Text, Tooltip } from "@mantine/core";
import { Check, ChevronDown, X } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { likeColour } from "../../theme";
import { icons } from "../../ui/icons";
import { useHold } from "../../ui/useHold";
import { type Choice, dreamChoices } from "./choices";
import type { DeckCard } from "./deck";

import classes from "./DreamPage.module.css";

/** Each answer's round button: its glyph, or a comparison side's letter, and its tint. */
const looks: Record<string, { glyph: ReactNode; color: MantineColor }> = {
  discard: { glyph: <X size={30} strokeWidth={2.5} />, color: "red" },
  like: { glyph: <icons.superLike size={28} strokeWidth={2.5} />, color: likeColour },
  keep: { glyph: <Check size={30} strokeWidth={2.5} />, color: "green" },
  neither: { glyph: <icons.passAll size={28} strokeWidth={2.5} />, color: "red" },
  both: { glyph: <icons.keepAll size={28} strokeWidth={2.5} />, color: "green" },
};

/** Undo and Suggestions, the smaller bordered controls either side of the verdicts. */
export const sideControl = { variant: "default", size: "lg", radius: "xl" } as const;
export const sideIconSize = 20;

export function DeckUndo({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <Tooltip label="Undo">
      <ActionIcon
        {...sideControl}
        data-touch-target
        aria-label="Undo"
        disabled={disabled}
        onClick={onClick}
      >
        <icons.undo size={sideIconSize} />
      </ActionIcon>
    </Tooltip>
  );
}

/** The deck's verdicts, with its smaller Undo and Suggestions controls on either side. */
export function DeckButtons({
  card,
  act,
  askPass,
  hidden,
  expanded,
  singleImageComparison = false,
  leading,
  trailing,
  quickRating = false,
}: {
  card: DeckCard;
  act: (choice: Choice["choice"]) => void;
  askPass: () => void;
  hidden: boolean;
  expanded?: boolean;
  singleImageComparison?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  quickRating?: boolean;
}) {
  const comparison = card.kind === "pair" && !singleImageComparison;
  const answers = dreamChoices(card, singleImageComparison, quickRating).at(-1)!;
  const rate = expanded ? "Rate This Image & Keep Set" : "Rate Cover & Keep Set";
  const { consumeClick, ...hold } = useHold(card.key, askPass);
  return (
    <div
      role="group"
      aria-label={
        comparison ? "Comparison Answers" : quickRating ? "Rating Actions" : "Dream Actions"
      }
      className={classes.buttons}
      data-comparison-size={card.kind === "pair" ? card.items.length : undefined}
      aria-hidden={hidden}
      inert={hidden}
    >
      {leading}
      {answers.map(({ choice, id, label: title }) => {
        const side = id === "a" || id === "b" || id === "c";
        const pass =
          !quickRating && (id === "neither" || (id === "discard" && card.kind !== "set"));
        const description = pass
          ? "Hold to Add a Reason"
          : id === "like" && card.kind === "set"
            ? rate
            : !quickRating && id === "like"
              ? "Keep, Like and Teach Dream"
              : !quickRating && (id === "keep" || id === "both")
                ? "Keep Unrated and Teach Dream"
                : undefined;
        return (
          <Fragment key={id}>
            <Tooltip label={description ?? title}>
              <ActionIcon
                className={classes.answer}
                data-touch-target
                variant="light"
                color={side ? "blue" : looks[id].color}
                radius="50%"
                data-size={
                  side && card.kind === "pair" && card.items.length === 2 ? "large" : undefined
                }
                aria-label={title}
                aria-description={description}
                aria-keyshortcuts={pass ? "Shift+F10" : undefined}
                data-pass={pass || undefined}
                {...(pass && hold)}
                onClick={(event) => {
                  if (!pass || !consumeClick(event)) act(choice);
                }}
              >
                {side ? (
                  <Text fw={700} fz={26}>
                    {title}
                  </Text>
                ) : (
                  looks[id].glyph
                )}
              </ActionIcon>
            </Tooltip>
            {pass && (
              <Tooltip label="Pass Reason">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  data-touch-target
                  aria-label="Pass Reason"
                  onClick={askPass}
                >
                  <ChevronDown size={16} />
                </ActionIcon>
              </Tooltip>
            )}
          </Fragment>
        );
      })}
      {trailing}
    </div>
  );
}
