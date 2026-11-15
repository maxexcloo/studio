import {
  type CardKind,
  characterLead,
  outfitPart,
  scenePart,
  withPart,
  withoutPart,
} from "../../../../shared/characters.ts";
import type { GenerationInput, ReferenceAsset } from "../../types";
import type { PromptCard, PromptCardKind } from "./queries";

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
  before: string,
  prompt: string,
): CardParts {
  const text = cardTexts(kind, card.description).find((text) => prompt.includes(text))!;
  const replaced = Object.entries(parts || {}).filter(([id, part]) =>
    kind === "characters" ? id === card.id : part.kind === kind,
  );
  const unowned = replaced.reduce(
    (prompt, [, part]) => (part.ownsText ? withoutPart(prompt, part.text) : prompt),
    before,
  );
  return {
    ...Object.fromEntries(
      Object.entries(parts || {}).filter(
        ([id, part]) => id !== card.id && (kind === "characters" || part.kind !== kind),
      ),
    ),
    [card.id]: {
      kind,
      text,
      ownsText: !unowned.includes(text),
      ...(kind === "characters" ? { referenceIds: card.references?.map((asset) => asset.id) } : {}),
    },
  };
}

export function forgetCard(parts: CardParts, id: string): CardParts {
  return Object.fromEntries(Object.entries(parts || {}).filter(([key]) => key !== id));
}

/** Removes only the contribution recorded when this card was applied. */
export function removeCard(id: string, prompt: string, parts: CardParts) {
  const previous = parts?.[id];
  return {
    prompt: previous?.ownsText ? withoutPart(prompt, previous.text) : prompt,
    cardParts: forgetCard(parts, id),
  };
}

export function removeCharacter(
  card: { id: string },
  references: ReferenceAsset[],
  prompt: string,
  parts: CardParts,
) {
  const ids = new Set(parts?.[card.id]?.referenceIds);
  return {
    references: references.filter((asset) => !ids.has(asset.id)),
    ...removeCard(card.id, prompt, parts),
  };
}

function replaceCardText(prompt: string, parts: CardParts, kind: CardKind) {
  return Object.values(parts || {})
    .filter((part) => part.kind === kind && part.ownsText)
    .reduce((text, part) => withoutPart(text, part.text), prompt);
}

/** Selection follows the applied card's ID and version, never a coincidental text match. */
export function promptCardApplied(
  kind: PromptCardKind,
  card: PromptCard,
  prompt: string,
  parts?: CardParts,
) {
  const previous = parts?.[card.id];
  return previous &&
    previous.kind === kind &&
    cardTexts(kind, card.description).includes(previous.text) &&
    prompt.includes(previous.text)
    ? previous
    : undefined;
}

/**
 * Places a card after the recorded parts that precede it, replacing only applied parts of its kind.
 */
export function withPromptCard(
  kind: PromptCardKind,
  card: PromptCard,
  prompt: string,
  parts?: CardParts,
) {
  const leads = Object.values(parts || {})
    .filter((part) => part.kind === "characters" && prompt.includes(part.text))
    .map((part) => part.text);
  const cleared = replaceCardText(prompt, parts, kind);
  const before =
    kind === "outfits"
      ? leads
      : [
          ...leads,
          ...Object.values(parts || {})
            .filter((part) => part.kind === "outfits")
            .map((part) => part.text),
        ];
  const part =
    kind === "outfits"
      ? outfitPart(card.description)
      : scenePart(card.description, leads.length > 0);
  return withPart(cleared, part, before);
}
