import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  type Character,
  type CharacterTrait,
  type SheetRole,
  characterLead,
  identitySlot,
  withCharacter,
  withoutCharacter,
  withoutPart,
} from "../../../../shared/characters";
import { api, post } from "../../api";
import type { Profile, ReferenceAsset } from "../../types";
import { queueQuery } from "../generation/Queue";
import { nextReferenceTarget, placeReference } from "../generation/references";
import { type CardParts, forgetCard, rememberCard } from "./cardParts";

/** A card as `/api/characters` lists it: its images that still exist, as reference assets. */
export interface CharacterCard extends Omit<Character, "sheet" | "portrait"> {
  references: ReferenceAsset[];
  missing: number;
  /** The portrait a chat queued for a new card, until it becomes its first image. */
  portrait?: { jobId: string; status: "making" | "failed" };
  /** Make Sheet's sheet: its views by role once made (backend/cards.js shownSheet). */
  sheet?: {
    jobId: string;
    at: string;
    status: "making" | "done" | "failed";
    error?: string;
    panels: (ReferenceAsset & { role: SheetRole })[];
  };
}
export interface CharacterFields extends Partial<Record<CharacterTrait, string>> {
  name: string;
  description: string;
  age?: number;
  referenceIds: string[];
}

export const charactersQuery = queryOptions({
  queryKey: ["characters"],
  queryFn: async () => (await api<{ characters: CharacterCard[] }>("/api/characters")).characters,
  // Follows portraits and sheets until each has finished.
  refetchInterval: (query) =>
    query.state.data?.some(
      (card) => card.sheet?.status === "making" || card.portrait?.status === "making",
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
  parts?: CardParts,
) {
  const previous = parts?.[card.id];
  if (
    previous &&
    (previous.text !== characterLead(card.description) ||
      JSON.stringify(previous.referenceIds) !==
        JSON.stringify(card.references.map((asset) => asset.id)))
  )
    return false;
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
  parts?: CardParts,
) {
  const previous = parts?.[card.id];
  const remaining = previous
    ? references.filter((asset) => !previous.referenceIds?.includes(asset.id))
    : references;
  const first = card.references[0];
  // A profile's Identity slot takes it first.
  const identity = profile && identitySlot(profile);
  const target =
    first && nextReferenceTarget(remaining, profile, identity ? { slot: identity } : null);
  const nextPrompt = withCharacter(
    previous ? withoutPart(prompt, previous.text) : prompt,
    card.description,
  );
  return {
    references: target
      ? placeReference(remaining, { ...first, slot: undefined }, profile, target)
      : remaining,
    prompt: nextPrompt,
    cardParts: rememberCard(parts, "characters", card, nextPrompt),
  };
}

/** Removing a card takes out both its images and its lead. */
export function removeCharacter(
  card: CharacterCard,
  references: ReferenceAsset[],
  prompt: string,
  parts?: CardParts,
) {
  const ids = new Set([
    ...card.references.map((asset) => asset.id),
    ...(parts?.[card.id]?.referenceIds || []),
  ]);
  return {
    references: references.filter((asset) => !ids.has(asset.id)),
    prompt: withoutCharacter(prompt, card.description),
    cardParts: forgetCard(parts, card.id),
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
