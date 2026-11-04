import { X, type LucideIcon } from "lucide-react";
import { icons } from "../../ui/icons";
import type { ActionGroups } from "../gallery/ActionBar";
import type { DeckCard } from "./deck";
import type { PairAnswer } from "./queries";

export type Verdict = "discard" | "keep" | "variations" | "star" | "animate" | "refine" | "more";

/** One way to judge the top card, as the deck's bar and the viewer's bar both offer it. */
export interface Choice {
  choice: Verdict | PairAnswer;
  /** The viewer's action id, which its keyboard shortcuts find (E Edit, F Star). */
  id: string;
  label: string;
  icon: LucideIcon;
  /** The phone deck's name under the icon, where the label is too long. */
  short?: string;
  /** Its key on desktop. */
  hint?: string;
  tip?: string;
  primary?: boolean;
  /** Shown only by its icon on desktop. */
  iconOnly?: boolean;
  disabled?: boolean;
}

/**
 * The top card's choices, in groups: a comparison's A, Both, Neither and B; a single card's Skip,
 * Edit and Animate, Star, Variations and More Like This, then Keep. Edit, Animate, Variations and
 * More Like This need a Dream image; a gallery image passes or is liked.
 */
export function dreamChoices(card: DeckCard): Choice[][] {
  if (card.kind === "pair") {
    const tip = (index: 0 | 1, side: string) =>
      card.labels?.[index] ? `${side}: ${card.labels[index]}` : undefined;
    return [
      [
        { choice: "a", id: "a", label: "A", icon: icons.winner, hint: "←", tip: tip(0, "A") },
        { choice: "both", id: "both", label: "Both", icon: icons.keep, hint: "↑" },
        { choice: "neither", id: "neither", label: "Neither", icon: X, hint: "↓" },
        { choice: "b", id: "b", label: "B", icon: icons.winner, hint: "→", tip: tip(1, "B") },
      ],
    ];
  }
  const calibrating = card.kind === "calibration";
  const dreamImage = !calibrating && card.item.type === "image";
  return [
    [
      {
        choice: "discard",
        id: "discard",
        label: calibrating ? "Pass" : "Skip",
        icon: X,
        hint: "←",
      },
    ],
    [
      { choice: "refine", id: "edit", label: "Edit", icon: icons.edit, disabled: !dreamImage },
      {
        choice: "animate",
        id: "animate",
        label: "Animate",
        icon: icons.animate,
        disabled: !dreamImage,
      },
    ],
    [
      { choice: "star", id: "star", label: "Star", icon: icons.star, iconOnly: true },
      {
        choice: "variations",
        id: "variations",
        label: "Variations",
        tip: "Keep & Variations",
        icon: icons.recreate,
        hint: "↑",
        disabled: !dreamImage,
      },
      {
        choice: "more",
        id: "more-like-this",
        label: "More Like This",
        short: "Similar",
        icon: icons.moreLikeThis,
        disabled: !dreamImage,
      },
    ],
    [
      {
        choice: "keep",
        id: "keep",
        label: calibrating ? "Like" : "Keep",
        icon: icons.keep,
        hint: "→",
        primary: true,
      },
    ],
  ];
}

/**
 * The choices as the viewer's action groups, leaving out what this card can't do: desktop names
 * all but Star, and phones keep the answers, Skip, Edit, Animate and Keep on the bar and the rest
 * under More.
 */
export function viewerChoices(card: DeckCard, act: (choice: Choice["choice"]) => void) {
  const groups: ActionGroups = dreamChoices(card).map((group) =>
    group
      .filter((choice) => !choice.disabled)
      .map((choice) => ({
        id: choice.id,
        label: choice.label,
        icon: choice.icon,
        onClick: () => act(choice.choice),
      })),
  );
  const ids = groups.flat().map((action) => action.id);
  return {
    label: card.kind === "pair" ? "Comparison Answers" : "Dream Actions",
    groups,
    labelled: ids.filter((id) => id !== "star"),
    primary: ids.filter((id) => !["star", "variations", "more-like-this"].includes(id)),
  };
}
