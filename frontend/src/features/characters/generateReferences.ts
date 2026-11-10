import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { post } from "../../api";
import type { Profile, Session } from "../../types";
import { characterShots } from "../../../../shared/characters";
import { inputForProfile, initialInput, modelsQuery } from "../generation/GenerationProvider";
import { generationInput, referencePatch } from "../generation/payload";
import { queueQuery } from "../generation/Queue";
import { charactersQuery, type CharacterCard } from "./queries";

const takesReferences = (profile: Profile) => Boolean(profile.mediaInputs?.length);

/**
 * The profile Generate References uses: with an image on the card, the preferred image profile
 * that takes references (`preferred`, the composer's, then the default), else the preferred
 * text-to-image one; ready local profiles first.
 */
export function referenceProfile(
  card: CharacterCard,
  profiles: Profile[],
  preferred: (string | undefined)[],
) {
  const fits = (profile: Profile) =>
    profile.kind === "image" &&
    profile.ready !== false &&
    (card.references.length
      ? takesReferences(profile)
      : !profile.mediaInputs?.some((slot) => slot.required));
  return (
    preferred
      .map((id) => profiles.find((profile) => profile.id === id))
      .find((profile) => profile && fits(profile)) || profiles.find(fits)
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
      const references = takesReferences(profile)
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
      const shots = characterShots(card.description);
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
      return { profile, jobIds };
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: charactersQuery.queryKey });
      void client.invalidateQueries({ queryKey: ["gallery"] });
      void client.invalidateQueries({ queryKey: queueQuery.queryKey });
      void client.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}
