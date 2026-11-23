import { ActionIcon, type MantineColor, Text, Tooltip } from "@mantine/core";
import { Check, Heart, X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

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

const holdTime = 500;
const holdSlop = 10;

function usePassHold(cardId: string, open: () => void) {
  const press = useRef<{ x: number; y: number; timer: number }>(undefined);
  const suppressClick = useRef(false);
  function stop() {
    window.clearTimeout(press.current?.timer);
    press.current = undefined;
  }
  function cancel() {
    if (press.current) suppressClick.current = true;
    stop();
  }
  useEffect(() => stop, [cardId]);
  return {
    onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
      stop();
      if (!event.isPrimary) {
        suppressClick.current = true;
        return;
      }
      if (event.button !== 0) return;
      suppressClick.current = false;
      const button = event.currentTarget;
      button.setPointerCapture(event.pointerId);
      press.current = {
        x: event.clientX,
        y: event.clientY,
        timer: window.setTimeout(() => {
          suppressClick.current = true;
          button.focus({ preventScroll: true });
          open();
        }, holdTime),
      };
    },
    onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
      const start = press.current;
      if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) <= holdSlop)
        return;
      cancel();
    },
    onPointerUp: stop,
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    onContextMenu(event: React.MouseEvent<HTMLButtonElement>) {
      event.preventDefault();
      if (event.button === 2) open();
    },
    onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault();
      open();
    },
    consumeClick(event: React.MouseEvent<HTMLButtonElement>) {
      if (!event.detail || !suppressClick.current) return false;
      suppressClick.current = false;
      return true;
    },
  };
}

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
  const answers = dreamChoices(card, singleImageComparison).at(-1)!;
  const labels: Record<string, string> = {
    both: expanded ? (card.kind === "pair" && card.items.length > 2 ? "All" : "Both") : "Accept",
    discard: quickRating ? "Dislike" : card.kind === "set" ? "Deny All" : "Pass",
    keep: quickRating ? "Skip" : "Accept",
    like: quickRating ? "Like" : "Super Like",
    neither: "Pass",
  };
  const rate = expanded ? "Rate This Image & Keep Set" : "Rate Cover & Keep Set";
  const { consumeClick, ...hold } = usePassHold(card.key, askPass);
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
      {answers.map(({ choice, id, label }) => {
        const side = id === "a" || id === "b" || id === "c";
        const title = labels[id] ?? label;
        const pass =
          !quickRating && (id === "neither" || (id === "discard" && card.kind !== "set"));
        const description = pass
          ? "Hold to Add a Reason"
          : id === "like" && card.kind === "set"
            ? rate
            : undefined;
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
              aria-keyshortcuts={pass ? "Shift+F10" : undefined}
              data-pass={pass || undefined}
              {...(pass && hold)}
              onClick={(event) => {
                if (!pass || !consumeClick(event)) act(choice);
              }}
            >
              {side ? (
                <Text fw={700} fz={26}>
                  {label}
                </Text>
              ) : expanded && id === "both" ? (
                <icons.compare size={24} />
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
