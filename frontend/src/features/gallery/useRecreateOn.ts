import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { StudioSession } from "../../../../shared/queue";
import { post } from "../../api";
import type { MediaItem, Profile } from "../../types";
import { inputForProfile, modelsQuery } from "../generation/GenerationProvider";
import { generationInput, profileName } from "../generation/payload";
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
      const failed: string[] = [];
      let error: unknown;
      for (const item of items.slice(0, recreateOnLimit)) {
        try {
          const { draft, seed, profile: original } = await mediaDraft(item, "image", client);
          const input = {
            ...inputForProfile(draft.input, profile),
            seed: seed ?? "",
            count: 1,
            ...(item.width && item.height ? { width: item.width, height: item.height } : {}),
            loras: original.family === profile.family ? draft.input.loras : [],
          };
          const session =
            draft.sessionId || (await post<{ session: StudioSession }>("/api/sessions")).session.id;
          const { jobId } = await post<{ jobId: string }>(`/api/sessions/${session}/generations`, {
            ...generationInput(input, profile, draft.references),
            operation: "image",
            parentJobId: draft.parentJobId,
            parentItemId: draft.parentItemId,
          });
          // The new run's image is its job's first, chosen once it exists.
          const comparison = await post<{ id: string }>("/api/comparisons", {
            jobIds: [item.jobId, jobId],
            itemIds: [item.id, ""],
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
