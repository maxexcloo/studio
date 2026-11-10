import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { post } from "../../api";
import type { Profile, Session } from "../../types";
import { characterProfiles, characterShots, editsReferences } from "../../../../shared/characters";
import { inputForProfile, initialInput, modelsQuery } from "../generation/GenerationProvider";
import { generationInput, referencePatch } from "../generation/payload";
import { queueQuery } from "../generation/Queue";
import { charactersQuery, type CharacterCard } from "./queries";

/**
 * The profile Generate References uses, ready ones only: with an image on the card, the best that
 * edits with references (characterProfiles, `preferred` first: the composer's, then the default);
 * else, or without one, a text-to-image one, which draws from the description alone. An img2img
 * start image would carry the card's pose and layout into every view.
 */
export function referenceProfile(
  card: CharacterCard,
  profiles: Profile[],
  preferred: (string | undefined)[],
) {
  const ready = profiles.filter((profile) => profile.kind === "image" && profile.ready !== false);
  const editor = card.references.length ? characterProfiles(ready, preferred)[0] : undefined;
  return (
    editor ||
    [...preferred.flatMap((id) => ready.filter((profile) => profile.id === id)), ...ready].find(
      (profile) => !profile.mediaInputs?.some((slot) => slot.required),
    )
  );
}

/**
 * Generate References: queues one shot per view (shared/characters.ts) as ordinary jobs in one
 * session, sharing a seed and, when the card has one, its first image as a reference. The card
 * lists them until the editor saves the ones to keep.
 */
export function useGenerateReferences(preferredProfileId?: string) {
  const client = useQueryClient();
  const models = useQuery(modelsQuery);
  return useMutation({
    meta: { inlineError: true },
    mutationFn: async (card: CharacterCard) => {
      const profile = referenceProfile(card, models.data?.profiles || [], [
        preferredProfileId,
        models.data?.defaults?.imageModel,
      ]);
      if (!profile) throw new Error("No image model is ready for Generate References.");
      const references =
        profile.mediaInputs?.length && editsReferences(profile)
          ? card.references
              .slice(0, 1)
              .map((asset) => ({ ...asset, slot: profile.mediaInputs![0].id }))
          : [];
      const base = inputForProfile(initialInput, profile);
      const input = {
        ...base,
        ...referencePatch(base, [], references, profile),
        count: 1,
        seed: String(Math.floor(Math.random() * 2 ** 31)),
      };
      const shots = characterShots(card.description, references.length > 0);
      const first = generationInput({ ...input, prompt: shots[0] }, profile, references);
      const { session } = await post<{ session: Session }>("/api/sessions", { inputs: first });
      const jobIds: string[] = [];
      for (const prompt of shots)
        jobIds.push(
          (
            await post<{ jobId: string }>(
              `/api/sessions/${session.id}/generations`,
              generationInput({ ...input, prompt }, profile, references),
            )
          ).jobId,
        );
      await post(`/api/characters/${encodeURIComponent(card.id)}/generated`, { jobIds });
      return { profile, jobIds, withImage: references.length > 0 };
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: charactersQuery.queryKey });
      void client.invalidateQueries({ queryKey: ["gallery"] });
      void client.invalidateQueries({ queryKey: queueQuery.queryKey });
      void client.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}
