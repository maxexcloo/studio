import { useMutation, useQueryClient } from "@tanstack/react-query";

import { post } from "../../api";
import type { MediaItem, Profile } from "../../types";
import { inputForProfile, modelsQuery } from "../generation/GenerationProvider";
import {
  generationInput,
  isProfile,
  profileForBackend,
  profileName,
  runReferenceSlots,
  splitReferenceSlots,
} from "../generation/payload";
import { queueQuery } from "../generation/Queue";
import { mediaProfileName } from "./mediaLabels";
import { galleryKey } from "./queries";
import { mediaDraft } from "./useMediaAction";

/** How many results one Recreate On queues, each its own comparison. */
export const recreateOnLimit = 10;

/**
 * Recreate On: each finished image runs once more on `profile` with its prompt, references, size
 * and seed (a model that ignores seeds draws its own), as a version of it, and joins the original
 * as a comparison to judge the models by. LoRAs carry over within the same model family only.
 * Resolves to the comparisons made and the items that failed, with the first failure.
 */
export function useRecreateOn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ items, profile }: { items: MediaItem[]; profile: Profile }) => {
      const { profiles } = await client.ensureQueryData(modelsQuery);
      const comparisons: string[] = [];
      const failed = items.slice(recreateOnLimit).map(({ id }) => id);
      let error: unknown;
      for (const item of items.slice(0, recreateOnLimit)) {
        try {
          const { draft, seed } = await mediaDraft(
            item,
            "image",
            client,
            undefined,
            undefined,
            profile.id,
          );
          const run = profileForBackend(profile, undefined, Boolean(draft.references.length));
          const original = profiles.find((candidate) =>
            isProfile(candidate, String(item.settings?.profileId || item.model || "")),
          );
          const { unused } = splitReferenceSlots(draft.references, runReferenceSlots(run));
          if (unused.length)
            throw new Error(
              "The selected model cannot use all of this image's saved reference slots.",
            );
          const input = {
            ...inputForProfile(draft.input, profile),
            seed: seed ?? "",
            count: 1,
            ...(item.width && item.height ? { width: item.width, height: item.height } : {}),
            loras:
              run?.capabilities.lora && original?.family === run.family ? draft.input.loras : [],
          };
          const comparison = await post<{ id: string }>("/api/comparisons/recreate", {
            itemId: item.id,
            input: generationInput(input, profile, draft.references),
            labels: [mediaProfileName(item, profiles) || "Original", profileName(profile)].map(
              (label) => label.slice(0, 80),
            ),
          });
          comparisons.push(comparison.id);
        } catch (reason) {
          failed.push(item.id);
          error ??= reason;
        }
      }
      return { comparisons, failed, error };
    },
    onSettled: () => {
      for (const queryKey of [queueQuery.queryKey, galleryKey, ["comparisons"]])
        void client.invalidateQueries({ queryKey });
    },
  });
}
