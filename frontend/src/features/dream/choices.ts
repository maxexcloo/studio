import type { LucideIcon } from "lucide-react";

import { letter } from "../../../../shared/compare";
import type { Action, ActionGroups } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import type { ViewerActions } from "../gallery/MediaViewerActions";
import type { DeckCard } from "./deck";
import { type PairAnswer, comparisonVotes } from "./queries";

export type Verdict = "discard" | "keep" | "variations" | "like" | "animate" | "refine" | "more";

/** One way to judge the top card, as the deck's bar and the viewer's bar both offer it. */
export interface Choice {
  choice: Verdict | PairAnswer;
  /** The viewer's action id, which its keyboard shortcuts find (E Edit, F Super Like). */
  id: string;
  label: string;
  icon: LucideIcon;
  /** A single card's verdicts: Pass, Super Like and Accept. */
  main?: boolean;
  primary?: boolean;
}

/**
 * A card's verdicts as every surface names them: Pass dislikes it (Deny All on a set, Dislike when
 * rating the gallery), Accept keeps it unrated and Super Like accepts and rates it.
 */
export function verdictLabels(card: DeckCard, quickRating = false) {
  return {
    discard: quickRating ? "Dislike" : card.kind === "set" ? "Deny All" : "Pass",
    like: "Super Like",
    keep: "Accept",
  };
}

/**
 * The top card's choices, in groups: a comparison's Pass, sides and Accept; a single card's Edit
 * and Animate, Variations and More Like This, then its verdicts. Edit, Animate, Variations and
 * More Like This need a Dream image.
 */
export function dreamChoices(
  card: DeckCard,
  singleImageComparison = false,
  quickRating = false,
): Choice[][] {
  if (card.kind === "pair" && !singleImageComparison)
    return [
      [
        { choice: "neither", id: "neither", label: "Pass", icon: icons.passAll },
        ...comparisonVotes.slice(0, card.items.length).map((choice, index) => ({
          choice,
          id: choice,
          label: letter(index),
          icon: icons.winner,
        })),
        { choice: "both", id: "both", label: "Accept", icon: icons.keepAll },
      ],
    ];
  const labels = verdictLabels(card, quickRating);
  const ratings: Choice[] = [
    { choice: "discard", id: "discard", label: labels.discard, icon: icons.dislike, main: true },
    { choice: "like", id: "like", label: labels.like, icon: icons.superLike, main: true },
    { choice: "keep", id: "keep", label: labels.keep, icon: icons.keep, main: true, primary: true },
  ];
  // An image comparison in fullscreen judges the image shown, between Pass and Accept for every
  // side at the edges.
  if (card.kind === "pair") {
    const every = card.items.length > 2 ? "All" : "Both";
    return [
      [
        { choice: "neither", id: "neither", label: `Pass ${every}`, icon: icons.passAll },
        ...ratings,
        { choice: "both", id: "both", label: `Accept ${every}`, icon: icons.keepAll },
      ],
    ];
  }
  if (card.kind !== "dream" || card.item.type !== "image") return [ratings];
  return [
    [
      { choice: "refine", id: "edit", label: "Edit", icon: icons.edit },
      { choice: "animate", id: "animate", label: "Animate", icon: icons.animate },
    ],
    [
      { choice: "variations", id: "variations", label: "Variations", icon: icons.recreate },
      { choice: "more", id: "more-like-this", label: "More Like This", icon: icons.moreLikeThis },
    ],
    ratings,
  ];
}

/** A choice as a bar action; `emphasis` sets the ratings apart, Accept filled. */
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
 * A result's choices as the viewer's action groups, on one row in the item bar's order: Animate and
 * Edit, then Recreate ▾ holding More Like This and Variations, then the ratings, Accept the filled
 * one.
 */
export function viewerChoices(
  card: DeckCard,
  act: (choice: Choice["choice"]) => void,
): ViewerActions {
  const all = dreamChoices(card).flatMap((group) => group.map(action(act, true)));
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
    labelled: ["animate", "edit", "recreate", "discard", "like", "keep"],
  };
}
