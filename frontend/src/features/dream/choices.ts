import { type LucideIcon, X } from "lucide-react";

import type { Action, ActionGroups } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import type { DeckCard } from "./deck";
import type { PairAnswer } from "./queries";

export type Verdict = "discard" | "keep" | "variations" | "like" | "animate" | "refine" | "more";

/** One way to judge the top card, as the deck's bar and the viewer's bar both offer it. */
export interface Choice {
  choice: Verdict | PairAnswer;
  /** The viewer's action id, which its keyboard shortcuts find (E Edit, F Like). */
  id: string;
  label: string;
  icon: LucideIcon;
  /** Its key on desktop. */
  hint?: string;
  tip?: string;
  /** One of the bars' large choices: Dislike, Like and Keep, or a comparison's A and B. */
  main?: boolean;
  primary?: boolean;
}

/**
 * The top card's choices, in groups: a comparison's Neither, A, B and Both (the picks in the
 * middle); a single card's Dislike, then Edit and Animate, Like, Variations and More Like This,
 * then Keep. Edit, Animate, Variations and More Like This need a Dream image; a gallery image is
 * disliked, kept or liked.
 */
export function dreamChoices(card: DeckCard): Choice[][] {
  if (card.kind === "pair") {
    const tip = (index: 0 | 1, side: string) =>
      card.labels?.[index] ? `${side}: ${card.labels[index]}` : undefined;
    return [
      [
        { choice: "neither", id: "neither", label: "Neither", icon: X, hint: "↓" },
        {
          choice: "a",
          id: "a",
          label: "A",
          icon: icons.winner,
          hint: "←",
          tip: tip(0, "A"),
          main: true,
        },
        {
          choice: "b",
          id: "b",
          label: "B",
          icon: icons.winner,
          hint: "→",
          tip: tip(1, "B"),
          main: true,
        },
        { choice: "both", id: "both", label: "Both", icon: icons.keep, hint: "↑" },
      ],
    ];
  }
  const dreamImage = card.kind === "dream" && card.item.type === "image";
  // Like keeps a really good one and likes it: the strongest thing taste learns.
  const like: Choice = {
    choice: "like",
    id: "like",
    label: "Like",
    tip: "Like: keep and like it",
    icon: icons.like,
    main: true,
  };
  return [
    [
      {
        choice: "discard",
        id: "discard",
        label: "Dislike",
        tip: "Dislike: hide it and see less like it",
        icon: icons.dislike,
        hint: "←",
        main: true,
      },
    ],
    ...(dreamImage
      ? [
          [
            { choice: "refine", id: "edit", label: "Edit", icon: icons.edit },
            { choice: "animate", id: "animate", label: "Animate", icon: icons.animate },
          ] satisfies Choice[],
          [
            like,
            {
              choice: "variations",
              id: "variations",
              label: "Variations",
              tip: "Keep & Variations",
              icon: icons.variations,
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
      : [[like]]),
    [
      {
        choice: "keep",
        id: "keep",
        label: "Keep",
        icon: icons.keep,
        hint: "→",
        main: true,
        primary: true,
      },
    ],
  ];
}

/**
 * The choices as the viewer's action groups, on one row in the item bar's order: Animate and Edit,
 * then Recreate ▾ holding More Like This and Variations, then the verdicts at the end, Dislike,
 * Like and Keep, with Keep the filled one. Phones leave Like's name to its icon. A comparison
 * names all its answers, A and B large.
 */
export function viewerChoices(
  card: DeckCard,
  act: (choice: Choice["choice"]) => void,
  phone: boolean,
) {
  const action = (choice: Choice): Action => ({
    id: choice.id,
    label: choice.label,
    icon: choice.icon,
    emphasis: choice.primary ? "filled" : choice.main ? "default" : undefined,
    onClick: () => act(choice.choice),
  });
  const choices = dreamChoices(card).map((group) => group.map(action));
  if (card.kind === "pair")
    return {
      label: "Comparison Answers",
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
    pick("discard", "like", "keep"),
  ];
  return {
    label: "Dream Actions",
    groups,
    labelled: ["animate", "edit", "recreate", "discard", ...(phone ? [] : ["like"]), "keep"],
  };
}
