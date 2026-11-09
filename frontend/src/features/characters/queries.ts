import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import type { Profile, ReferenceAsset } from "../../types";
import { withCharacter, withoutCharacter, type Character } from "../../../../shared/characters";
import { referenceCapacity, referenceGroupAssets, referenceGroups } from "../generation/payload";
import { nextReferenceTarget, placeReference } from "../generation/references";

/** A card as `/api/characters` lists it: its images that still exist, as reference assets. */
export interface CharacterCard extends Character {
  references: ReferenceAsset[];
  missing: number;
}
export interface CharacterFields {
  name: string;
  description: string;
  referenceIds: string[];
}

export const charactersQuery = queryOptions({
  queryKey: ["characters"],
  queryFn: async () => (await api<{ characters: CharacterCard[] }>("/api/characters")).characters,
});

/** Saves a new card, or `id`'s changes, and refreshes the list. */
export function useSaveCharacter(id?: string) {
  const client = useQueryClient();
  return useMutation({
    meta: { inlineError: true },
    mutationFn: async (fields: CharacterFields) =>
      (
        await api<{ character: CharacterCard }>(
          id ? `/api/characters/${encodeURIComponent(id)}` : "/api/characters",
          { method: id ? "PUT" : "POST", body: JSON.stringify(fields) },
        )
      ).character,
    onSuccess: () => client.invalidateQueries({ queryKey: charactersQuery.queryKey }),
  });
}

export function useDeleteCharacter() {
  const client = useQueryClient();
  return useMutation({
    meta: { inlineError: true },
    mutationFn: (id: string) =>
      api(`/api/characters/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: charactersQuery.queryKey }),
  });
}

/** How many references `profile` takes in all. */
export const referenceLimit = (profile?: Profile) =>
  referenceGroups(profile).reduce((total, group) => total + referenceCapacity(group), 0);

/** Whether the card is in use: some of its images placed and its description in the prompt. */
export function characterApplied(
  card: CharacterCard,
  references: ReferenceAsset[],
  prompt: string,
) {
  const ids = new Set(card.references.map((asset) => asset.id));
  return (
    references.some((asset) => ids.has(asset.id)) &&
    (!card.description || prompt.includes(card.description.trim()))
  );
}

/**
 * Picking a card: its images fill the open reference slots in order, as many as the profile has
 * room for (a profile taking one image swaps its reference), and its description joins the prompt.
 */
export function applyCharacter(
  card: CharacterCard,
  references: ReferenceAsset[],
  prompt: string,
  profile?: Profile,
) {
  const groups = referenceGroups(profile);
  let room = groups.reduce(
    (total, group) =>
      total + referenceCapacity(group) - referenceGroupAssets(references, group).length,
    0,
  );
  if (!room && groups.length === 1 && referenceCapacity(groups[0]) === 1) room = 1;
  let next = references;
  for (const asset of card.references.slice(0, room)) {
    const target = nextReferenceTarget(next, profile, null);
    if (!target) break;
    next = placeReference(next, { ...asset, slot: undefined }, profile, target);
  }
  return { references: next, prompt: withCharacter(prompt, card.description) };
}

/** Removing a card takes out both its images and its description. */
export function removeCharacter(card: CharacterCard, references: ReferenceAsset[], prompt: string) {
  const ids = new Set(card.references.map((asset) => asset.id));
  return {
    references: references.filter((asset) => !ids.has(asset.id)),
    prompt: withoutCharacter(prompt, card.description),
  };
}
