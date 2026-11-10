import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import type { Profile, ReferenceAsset } from "../../types";
import {
  characterLead,
  withCharacter,
  withoutCharacter,
  type Character,
} from "../../../../shared/characters";
import { nextReferenceTarget, placeReference } from "../generation/references";

/** A card as `/api/characters` lists it: its images that still exist, as reference assets. */
export interface CharacterCard extends Omit<Character, "generated"> {
  references: ReferenceAsset[];
  missing: number;
  /** Generate References' results, waiting to be picked in the editor. */
  generated?: {
    jobIds: string[];
    at: string;
    results: {
      galleryItemId: string;
      jobId: string;
      status: string;
      thumbnailUrl: string;
      prompt: string;
    }[];
  };
}
export interface CharacterFields {
  name: string;
  description: string;
  referenceIds: string[];
}

export const charactersQuery = queryOptions({
  queryKey: ["characters"],
  queryFn: async () => (await api<{ characters: CharacterCard[] }>("/api/characters")).characters,
  // Follows generated references until each has finished.
  refetchInterval: (query) =>
    query.state.data?.some((card) =>
      card.generated?.results.some((result) => !["done", "failed"].includes(result.status)),
    )
      ? 5000
      : false,
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

/** Whether the card is in use: some of its images placed and its lead in the prompt. */
export function characterApplied(
  card: CharacterCard,
  references: ReferenceAsset[],
  prompt: string,
) {
  const ids = new Set(card.references.map((asset) => asset.id));
  return (
    references.some((asset) => ids.has(asset.id)) &&
    prompt.includes(characterLead(card.description))
  );
}

/**
 * Picking a card: its first image (characterImages) fills the next open reference slot (a full
 * profile taking one image swaps its reference), and its lead starts the prompt.
 */
export function applyCharacter(
  card: CharacterCard,
  references: ReferenceAsset[],
  prompt: string,
  profile?: Profile,
) {
  const first = card.references[0];
  const target = first && nextReferenceTarget(references, profile, null);
  return {
    references: target
      ? placeReference(references, { ...first, slot: undefined }, profile, target)
      : references,
    prompt: withCharacter(prompt, card.description),
  };
}

/** Removing a card takes out both its images and its lead. */
export function removeCharacter(card: CharacterCard, references: ReferenceAsset[], prompt: string) {
  const ids = new Set(card.references.map((asset) => asset.id));
  return {
    references: references.filter((asset) => !ids.has(asset.id)),
    prompt: withoutCharacter(prompt, card.description),
  };
}
