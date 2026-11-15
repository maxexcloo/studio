import {
  type CardKind,
  characterLead,
  outfitPart,
  scenePart,
  withPart,
  withoutPart,
} from "../../../../shared/characters.ts";
import type { GenerationInput } from "../../types";
import type { CharacterCard, PromptCard, PromptCardKind } from "./queries";

export type CardParts = GenerationInput["cardParts"];

function cardTexts(kind: CardKind, description: string) {
  return kind === "characters"
    ? [characterLead(description)]
    : kind === "outfits"
      ? [outfitPart(description)]
      : [scenePart(description, true), scenePart(description)];
}

export function rememberCard(
  parts: CardParts,
  kind: CardKind,
  card: { id: string; description: string; references?: { id: string }[] },
  prompt: string,
): CardParts {
  return {
    ...Object.fromEntries(
      Object.entries(parts || {}).filter(
        ([id, part]) => id !== card.id && (kind === "characters" || part.kind !== kind),
      ),
    ),
    [card.id]: {
      kind,
      text: cardTexts(kind, card.description).find((text) => prompt.includes(text))!,
      ...(kind === "characters" ? { referenceIds: card.references?.map((asset) => asset.id) } : {}),
    },
  };
}

export function forgetCard(parts: CardParts, id: string): CardParts {
  return Object.fromEntries(Object.entries(parts || {}).filter(([key]) => key !== id));
}

function replaceCardText(prompt: string, parts: CardParts, kind: CardKind) {
  return Object.values(parts || {})
    .filter((part) => part.kind === kind)
    .reduce((text, part) => withoutPart(text, part.text), prompt);
}

/** The sentences a card may stand as in a prompt: a scene's differs with a character's image. */
const partsOf = (kind: PromptCardKind, card: Pick<PromptCard, "description">) =>
  cardTexts(kind, card.description);

/** The sentence `card` stands as in `prompt`, if it is there. */
export const promptCardApplied = (kind: PromptCardKind, card: PromptCard, prompt: string) =>
  partsOf(kind, card).find((part) => prompt.includes(part));

/**
 * `prompt` with `card`'s sentence after a character's lead, an outfit before a scene, in place of
 * the kind's other `cards`.
 */
export function withPromptCard(
  kind: PromptCardKind,
  card: PromptCard,
  prompt: string,
  lists: {
    cards?: Pick<PromptCard, "description">[];
    characters?: Pick<CharacterCard, "description">[];
    outfits?: Pick<PromptCard, "description">[];
    parts?: CardParts;
  },
) {
  const leads = [
    ...(lists.characters || [])
      .map((character) => characterLead(character.description))
      .filter((lead) => prompt.includes(lead)),
    ...Object.values(lists.parts || {})
      .filter((part) => part.kind === "characters" && prompt.includes(part.text))
      .map((part) => part.text),
  ];
  const cleared = (lists.cards || []).reduce(
    (text, other) => partsOf(kind, other).reduce(withoutPart, text),
    replaceCardText(prompt, lists.parts, kind),
  );
  const before =
    kind === "outfits"
      ? leads
      : [...leads, ...(lists.outfits || []).map((outfit) => outfitPart(outfit.description))];
  const part =
    kind === "outfits"
      ? outfitPart(card.description)
      : scenePart(card.description, leads.length > 0);
  return withPart(cleared, part, before);
}
