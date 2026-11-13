import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import type { Profile, ReferenceAsset } from "../../types";
import {
  characterLead,
  identitySlot,
  withCharacter,
  withoutCharacter,
  type Character,
  type SheetRole,
} from "../../../../shared/characters";
import { nextReferenceTarget, placeReference } from "../generation/references";
import { queueQuery } from "../generation/Queue";

/** A card as `/api/characters` lists it: its images that still exist, as reference assets. */
export interface CharacterCard extends Omit<Character, "generated" | "sheet"> {
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
  /** Make Sheet's sheet: its views by role once made (backend/cards.js shownSheet). */
  sheet?: {
    jobId: string;
    at: string;
    status: "making" | "done" | "failed";
    error?: string;
    panels: (ReferenceAsset & { role: SheetRole })[];
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
  // Follows generated references and sheets until each has finished.
  refetchInterval: (query) =>
    query.state.data?.some(
      (card) =>
        card.sheet?.status === "making" ||
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

/** Make Sheet: queues the card's sheet, which the card then follows (backend/character-sheets.js). */
export function useMakeSheet() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (card: CharacterCard) =>
      post<{ jobId: string; profile: string }>(
        `/api/characters/${encodeURIComponent(card.id)}/sheet`,
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: charactersQuery.queryKey });
      void client.invalidateQueries({ queryKey: queueQuery.queryKey });
    },
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
  // A profile's Identity slot takes it first.
  const identity = profile && identitySlot(profile);
  const target =
    first && nextReferenceTarget(references, profile, identity ? { slot: identity } : null);
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

/** An outfit or scene card as `/api/<kind>` lists it (backend/cards.js). */
export interface PromptCard {
  id: string;
  name: string;
  description: string;
  references: ReferenceAsset[];
}
export type PromptCardKind = "outfits" | "scenes";

export const promptCardsQuery = (kind: PromptCardKind) =>
  queryOptions({
    queryKey: [kind],
    queryFn: async () => (await api<Record<PromptCardKind, PromptCard[]>>(`/api/${kind}`))[kind],
  });

/** Saves a new outfit or scene, or `id`'s changes, and refreshes its list. */
export function useSavePromptCard(kind: PromptCardKind, id?: string) {
  const client = useQueryClient();
  return useMutation({
    meta: { inlineError: true },
    mutationFn: (fields: { name: string; description: string; referenceIds: string[] }) =>
      api(id ? `/api/${kind}/${encodeURIComponent(id)}` : `/api/${kind}`, {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(fields),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: [kind] }),
  });
}

export function useDeletePromptCard(kind: PromptCardKind) {
  const client = useQueryClient();
  return useMutation({
    meta: { inlineError: true },
    mutationFn: (id: string) => api(`/api/${kind}/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: [kind] }),
  });
}
