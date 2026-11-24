import { characterLead, withPart } from "../../../../shared/characters.ts";
import { maxPromptCharacters } from "../../../../shared/queue.ts";
import type { Change, VariationDirection } from "../../../../shared/suggestions";
import type { MediaItem, Profile } from "../../types";
import type { CharacterCard } from "../characters/queries";
import type { Draft, Variant } from "../generation/GenerationProvider";
import { referencePatch } from "../generation/payload.ts";

export const directionLabels: Record<VariationDirection, string> = {
  light: "Light",
  outfit: "Outfit",
  pose: "Pose",
  scene: "Scene",
  style: "Style",
};

const directionGuides = {
  light: "style",
  outfit: "style",
  pose: "layout",
  scene: "layout",
  style: "style",
};
const cardKindsToVary = {
  light: undefined,
  outfit: "outfits",
  pose: undefined,
  scene: "scenes",
  style: undefined,
};

/** Retain the exact saved character wording and the compatible references for each direction. */
export function variationVariants(
  draft: Draft,
  profile: Profile | undefined,
  seed: string | number | undefined,
  item: Pick<MediaItem, "resultSet" | "identity">,
  cards: CharacterCard[],
  changes: Change[],
): Variant[] {
  const source = draft.input;
  const original = source.prompt.replace(/\s+/g, " ").trim();
  const appliedParts = Object.entries(source.cardParts ?? {}).filter(([, part]) =>
    original.includes(part.text.replace(/\s+/g, " ")),
  );
  const characterParts = appliedParts.filter(([, part]) => part.kind === "characters");
  const linkedId = item.resultSet?.character?.id ?? item.identity?.characterId;
  const found = cards.filter(
    (card) =>
      card.id === linkedId ||
      (draft.references.some((asset) => card.references.some(({ id }) => id === asset.id)) &&
        original.includes(characterLead(card.description).replace(/\s+/g, " "))),
  );
  const lockedIds = new Set([
    ...Object.values(source.cardParts ?? {})
      .filter(({ kind }) => kind === "characters")
      .flatMap((part) => part.cardReferenceIds ?? []),
    ...found.flatMap((card) => card.references.map(({ id }) => id)),
  ]);
  const descriptions = [
    ...found.map((card) => card.description),
    item.resultSet?.context?.character?.description ?? "",
  ];
  const characterTexts = [
    ...new Set([
      ...characterParts.map(([, part]) => part.text.replace(/\s+/g, " ")),
      ...descriptions
        .map((description) =>
          [
            characterLead(description),
            characterLead(description, true, 2),
            characterLead(description, false),
          ]
            .map((lead) => lead.replace(/\s+/g, " "))
            .find((lead) => lead && original.includes(lead)),
        )
        .filter((lead): lead is string => Boolean(lead)),
    ]),
  ].sort((left, right) => original.indexOf(left) - original.indexOf(right));
  const variants = changes.map((change) => {
    const direction = change.request as VariationDirection;
    const prompt = characterTexts.reduce(
      (text, part, index) => withPart(text, part, characterTexts.slice(0, index)),
      change.prompt,
    );
    const references = draft.references.filter((asset) => {
      const slot = profile?.mediaInputs?.find(({ id }) => id === asset.slot);
      return lockedIds.has(asset.id) || slot?.required || slot?.role !== directionGuides[direction];
    });
    const cardParts = Object.fromEntries(
      appliedParts.filter(
        ([, part]) =>
          part.kind !== cardKindsToVary[direction] &&
          prompt.includes(part.text.replace(/\s+/g, " ")),
      ),
    );
    return {
      references,
      label: `${directionLabels[direction]} · ${change.label}`,
      input: {
        ...source,
        ...referencePatch(source, draft.references, references, profile),
        cardParts,
        count: 1,
        seed: seed ?? "",
        prompt,
        inpaint: undefined,
      },
    };
  });
  const prompts = variants.map(({ input }) => input.prompt);
  if (
    prompts.some((prompt) => prompt === original || prompt.length > maxPromptCharacters) ||
    new Set(prompts).size !== prompts.length
  ) {
    throw new Error("The prompts could not be varied while keeping the character. Try again.");
  }
  return variants;
}
