import { type LucideIcon, X } from "lucide-react";

import type { Action, ActionGroups } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import type { ViewerActions } from "../gallery/MediaViewerActions";
import type { DeckCard } from "./deck";
import type { PairAnswer } from "./queries";

export type Verdict = "discard" | "keep" | "variations" | "like" | "animate" | "refine" | "more";

/** One way to judge the top card, as the deck's bar and the viewer's bar both offer it. */
export interface Choice {
  choice: Verdict | PairAnswer;
  /** The viewer's action id, which its keyboard shortcuts find (E Edit, F Superlike). */
  id: string;
  label: string;
  icon: LucideIcon;
  /** A single card's ratings: Like, Dislike and Superlike. */
  main?: boolean;
  primary?: boolean;
}

/**
 * The top card's choices, in groups: a comparison's A, B, Neither and Both; a single card's Edit
 * and Animate, Variations and More Like This, then its ratings. Like keeps it, Dislike hides it and
 * Superlike, the strongest thing taste learns, keeps it and rates it Liked. Edit, Animate,
 * Variations and More Like This need a Dream image.
 */
export function dreamChoices(card: DeckCard): Choice[][] {
  if (card.kind === "pair")
    return [
      [
        { choice: "a", id: "a", label: "A", icon: icons.winner },
        { choice: "b", id: "b", label: "B", icon: icons.winner },
        { choice: "neither", id: "neither", label: "Neither", icon: X },
        { choice: "both", id: "both", label: "Both", icon: icons.keep },
      ],
    ];
  const ratings: Choice[] = [
    { choice: "keep", id: "keep", label: "Like", icon: icons.like, main: true, primary: true },
    { choice: "discard", id: "discard", label: "Dislike", icon: icons.dislike, main: true },
    { choice: "like", id: "like", label: "Superlike", icon: icons.keep, main: true },
  ];
  if (card.kind !== "dream" || card.item.type !== "image") return [ratings];
  return [
    [
      { choice: "refine", id: "edit", label: "Edit", icon: icons.edit },
      { choice: "animate", id: "animate", label: "Animate", icon: icons.animate },
    ],
    [
      { choice: "variations", id: "variations", label: "Variations", icon: icons.assistant },
      { choice: "more", id: "more-like-this", label: "More Like This", icon: icons.moreLikeThis },
    ],
    ratings,
  ];
}

/** A choice as a bar action; `emphasis` sets the ratings apart, Like filled. */
const action =
  (act: (choice: Choice["choice"]) => void, emphasis = false) =>
  (choice: Choice): Action => ({
    id: choice.id,
    label: choice.label,
    icon: choice.icon,
    emphasis: emphasis && choice.main ? (choice.primary ? "filled" : "default") : undefined,
    onClick: () => act(choice.choice),
  });

/**
 * The choices as the viewer's action groups, on one row in the item bar's order: Animate and Edit,
 * then Recreate ▾ holding More Like This and Variations, then the ratings, Like the filled one. A
 * comparison names all its answers, each with an equal target.
 */
export function viewerChoices(
  card: DeckCard,
  act: (choice: Choice["choice"]) => void,
): ViewerActions {
  const choices = dreamChoices(card).map((group) => group.map(action(act, true)));
  if (card.kind === "pair")
    return {
      label: "Comparison Answers",
      equal: true,
      groups: choices,
      labelled: choices.flat().map((choice) => choice.id),
    };
  const all = choices.flat();
  const pick = (...ids: string[]) => ids.flatMap((id) => all.filter((choice) => choice.id === id));
  const dream = pick("more-like-this", "variations");
  const groups: ActionGroups = [
    [
      ...pick("animate", "edit"),
      ...(dream.length
        ? [{ id: "recreate", label: "Recreate", icon: icons.recreate, menu: [dream] }]
        : []),
    ],
    pick("keep", "discard", "like"),
  ];
  return {
    label: "Dream Actions",
    groups,
    labelled: ["animate", "edit", "recreate", "keep", "discard", "like"],
  };
}

/**
 * The deck's bar: only the ratings, or a comparison's answers, with Undo before the last, each
 * named and equally wide.
 */
export function deckChoices(
  card: DeckCard,
  act: (choice: Choice["choice"]) => void,
  undo: Action,
): ViewerActions {
  const answers = dreamChoices(card).at(-1)!.map(action(act));
  const groups = [[...answers.slice(0, -1), undo, ...answers.slice(-1)]];
  return {
    label: card.kind === "pair" ? "Comparison Answers" : "Dream Actions",
    equal: true,
    groups,
    labelled: groups[0].map((choice) => choice.id),
  };
}
