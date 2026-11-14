import { type LucideIcon, X } from "lucide-react";

import type { Action, ActionGroups } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
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
  /** One of the bars' large choices: Pass, Super Like and Like, or a comparison's A and B. */
  main?: boolean;
  primary?: boolean;
}

/**
 * The top card's choices, in groups: a comparison's Neither, A, B and Both (the picks in the
 * middle); a single card's Pass, then Edit and Animate, Super Like, Variations and More Like This,
 * then Like. Edit, Animate, Variations and More Like This need a Dream image; a gallery image is
 * passed, liked or super liked.
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
  // Super Like keeps a really good one and stars it: the strongest thing taste learns.
  const star: Choice = {
    choice: "star",
    id: "star",
    label: "Super Like",
    tip: "Super Like: keep and star it",
    icon: icons.star,
    main: true,
  };
  return [
    [{ choice: "discard", id: "discard", label: "Pass", icon: X, hint: "←", main: true }],
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
      : [[star]]),
    [
      {
        choice: "keep",
        id: "keep",
        label: "Like",
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
 * then More Like This and Variations, then the verdicts at the end, Pass, Super Like and Like, with
 * Like the filled one. Desktop names every action; phones name Pass and Like and keep More Like
 * This and Variations under ⋯ More. A comparison names all its answers, A and B large.
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
    pick("animate", "edit"),
    phone && dream.length
      ? [{ id: "more", label: "More", icon: icons.more, menu: [dream] }]
      : dream,
    pick("discard", "star", "keep"),
  ];
  return {
    label: "Dream Actions",
    groups,
    labelled: phone ? ["discard", "keep"] : all.map((choice) => choice.id),
  };
}
