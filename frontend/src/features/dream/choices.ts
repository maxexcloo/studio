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
  /** Its key on desktop. */
  hint?: string;
  tip?: string;
  primary?: boolean;
}

/**
 * The top card's choices, in groups: a comparison's Neither, A, B and Both (the picks in the
 * middle); a single card's Pass, then Edit and Animate, Star, Variations and More Like This, then
 * Like. Edit, Animate, Variations and More Like This need a Dream image; a gallery image is passed,
 * liked or starred.
 */
export function dreamChoices(card: DeckCard): Choice[][] {
  if (card.kind === "pair") {
    const tip = (index: 0 | 1, side: string) =>
      card.labels?.[index] ? `${side}: ${card.labels[index]}` : undefined;
    return [
      [
        { choice: "neither", id: "neither", label: "Neither", icon: X, hint: "↓" },
        { choice: "a", id: "a", label: "A", icon: icons.winner, hint: "←", tip: tip(0, "A") },
        { choice: "b", id: "b", label: "B", icon: icons.winner, hint: "→", tip: tip(1, "B") },
        { choice: "both", id: "both", label: "Both", icon: icons.keep, hint: "↑" },
      ],
    ];
  }
  const dreamImage = card.kind === "dream" && card.item.type === "image";
  const star: Choice = { choice: "star", id: "star", label: "Star", icon: icons.star };
  return [
    [{ choice: "discard", id: "discard", label: "Pass", icon: X, hint: "←" }],
    ...(dreamImage
      ? [
          [
            { choice: "refine", id: "edit", label: "Edit", icon: icons.edit },
            { choice: "animate", id: "animate", label: "Animate", icon: icons.animate },
          ] satisfies Choice[],
          [
            star,
            {
              choice: "variations",
              id: "variations",
              label: "Variations",
              tip: "Like & Variations",
              icon: icons.recreate,
              hint: "↑",
            },
            {
              choice: "more",
              id: "more-like-this",
              label: "More Like This",
              icon: icons.moreLikeThis,
            },
          ] satisfies Choice[],
        ]
      : [[star]]),
    [{ choice: "keep", id: "keep", label: "Like", icon: icons.keep, hint: "→", primary: true }],
  ];
}

/**
 * The choices as the viewer's action groups: desktop names all but Star, and phones name only a
 * comparison's answers and Pass and Like.
 */
export function viewerChoices(
  card: DeckCard,
  act: (choice: Choice["choice"]) => void,
  phone: boolean,
) {
  const groups: ActionGroups = dreamChoices(card).map((group) =>
    group.map((choice) => ({
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
    labelled: ids.filter((id) =>
      phone && card.kind !== "pair" ? ["discard", "keep"].includes(id) : id !== "star",
    ),
  };
}
