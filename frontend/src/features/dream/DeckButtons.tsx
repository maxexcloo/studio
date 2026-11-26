import { ActionIcon, type MantineColor, Menu, Popover, Text, Tooltip } from "@mantine/core";
import { Check, X } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";

import type { DreamPassReason } from "../../../../shared/dream";
import { likeColour, menuWidth } from "../../theme";
import { icons } from "../../ui/icons";
import { useHold } from "../../ui/useHold";
import { type Choice, dreamChoices } from "./choices";
import type { DeckCard } from "./deck";

import classes from "./DreamPage.module.css";

export const passReasonLabels = {
  taste: "Not My Taste",
  similar: "Too Similar",
  glitch: "Glitch",
} satisfies Record<Exclude<DreamPassReason, "skip">, string>;
const passReasons = Object.keys(passReasonLabels) as (keyof typeof passReasonLabels)[];

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

function PassButton({
  cardKey,
  choice,
  id,
  title,
  description,
  act,
}: {
  cardKey: string;
  choice: Choice["choice"];
  id: string;
  title: string;
  description: string;
  act: (choice: Choice["choice"], reason?: DreamPassReason) => void;
}) {
  const [openedFor, setOpenedFor] = useState<string>();
  const opened = openedFor === cardKey;
  const { consumeClick, ...hold } = useHold(cardKey, () => setOpenedFor(cardKey));
  return (
    <Menu
      opened={opened}
      onChange={(next) => {
        if (!next) setOpenedFor(undefined);
      }}
      withRoles={false}
      position="top"
      width={menuWidth}
      withinPortal
    >
      <Popover.Target popupType="menu">
        <span style={{ display: "inline-flex" }}>
          <Tooltip label={description} disabled={opened}>
            <ActionIcon
              className={classes.answer}
              data-touch-target
              variant="light"
              color={looks[id].color}
              radius="50%"
              aria-label={title}
              aria-description={description}
              aria-keyshortcuts="Shift+F10"
              aria-haspopup="menu"
              aria-expanded={opened}
              data-pass
              {...hold}
              onClick={(event) => {
                if (!consumeClick(event)) act(choice);
              }}
            >
              {looks[id].glyph}
            </ActionIcon>
          </Tooltip>
        </span>
      </Popover.Target>
      <Menu.Dropdown aria-label="Pass Reason">
        <Menu.Label>Pass Reason</Menu.Label>
        {passReasons.map((reason) => (
          <Menu.Item
            key={reason}
            onClick={() => {
              setOpenedFor(undefined);
              act(choice, reason);
            }}
          >
            {passReasonLabels[reason]}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

/** The deck's verdicts, with its smaller Undo and Suggestions controls on either side. */
export function DeckButtons({
  card,
  act,
  hidden,
  expanded,
  singleImageComparison = false,
  leading,
  trailing,
  quickRating = false,
}: {
  card: DeckCard;
  act: (choice: Choice["choice"], reason?: DreamPassReason) => void;
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
        if (pass)
          return (
            <PassButton
              key={id}
              cardKey={card.key}
              choice={choice}
              id={id}
              title={title}
              description={description!}
              act={act}
            />
          );
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
                onClick={() => act(choice)}
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
          </Fragment>
        );
      })}
      {trailing}
    </div>
  );
}
