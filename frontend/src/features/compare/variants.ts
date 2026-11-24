import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { compareVariants, letter } from "../../../../shared/compare";
import {
  isCloudProfile,
  loraName,
  loraStrengthSweep,
  profileNameParts,
} from "../../../../shared/profiles";
import { selectedResolution } from "../../../../shared/resolution";
import { post } from "../../api";
import type { GenerationInput, MediaItem, Profile } from "../../types";
import { useRemembered } from "../auth/useRemembered";
import { galleryKey } from "../gallery/queries";
import { mediaDraft } from "../gallery/useMediaAction";
import { submitBlockedReason } from "../generation/GenerationEditor";
import {
  type Draft,
  defaultProfile,
  initialInput,
  inputForProfile,
  modelsQuery,
  useDraft,
  useGeneration,
  useGenerationActions,
} from "../generation/GenerationProvider";
import { compatibleLoras, loraInfoQuery } from "../generation/LoraPicker";
import { useOpenComposer } from "../generation/openComposer";
import {
  generationInput,
  isProfile,
  profileForBackend,
  profileName,
  usesNegative,
} from "../generation/payload";
import { queueQuery } from "../generation/Queue";
import {
  draftVariants,
  moreSeeds,
  ownSeed,
  randomSeed,
  runSeeds,
  setVariants,
  variantLabels,
} from "./inputs";
import type { Comparison } from "./queries";

const fitsComparison = (count: number) =>
  count >= compareVariants.min && count <= compareVariants.max;

/**
 * `input` on `profile` with that profile's own settings, keeping the seed and, where the profile
 * offers the same size tier, the size.
 */
function modelInput(input: GenerationInput, profile: Profile): GenerationInput {
  const tier = selectedResolution(input, profile);
  return {
    ...inputForProfile(input, profile),
    seed: input.seed,
    ...(tier && { width: input.width, height: input.height, resolutionTier: tier }),
  };
}

/** Each variant the composer's draft compares as it runs, its models looked up in `profiles`. */
const variantsOf = (draft: Draft, profiles: Profile[]) =>
  draftVariants(draft, (input, profileId) => {
    const profile = profiles.find((each) => isProfile(each, profileId));
    return profile && modelInput(input, profile);
  });

/** Removes a set variant; one left ends the comparison. */
export const removeVariant = (draft: Draft, profiles: Profile[], index: number) =>
  setVariants(
    draft,
    variantsOf(draft, profiles).filter((_, each) => each !== index),
  );

/** The composer's comparison: its variants, their labels and why it can't run yet, if it can't. */
export function useDraftComparison() {
  const { profiles, models } = useGeneration();
  const draft = useDraft(true);
  const lora = useQuery(loraInfoQuery).data?.loras;
  const variants = variantsOf(draft, profiles);
  const profileOf = (input: GenerationInput) =>
    profileForBackend(
      input.profileId
        ? profiles.find((profile) => isProfile(profile, input.profileId))
        : defaultProfile(models.data, input.kind),
      input.profileBackend,
      Boolean(input.referenceAssets?.length),
    );
  const labels = variantLabels(variants, {
    profile: (input) => {
      const profile = profileOf(input);
      // The model alone; steps name the speed where variants differ in it.
      return profile ? profileNameParts(profileName(profile))[0] : input.profileId;
    },
    lora: (name) => loraName(name, lora?.[name]),
  });
  const seeds = runSeeds(variants);
  const keys = variants.map(({ input, references }, index) =>
    JSON.stringify([{ ...input, seed: seeds[index] }, references.map((reference) => reference.id)]),
  );
  const blockedReason = !fitsComparison(variants.length)
    ? `Choose ${compareVariants.min}–${compareVariants.max} variants to compare.`
    : variants
        .map(({ input, references }, index) => {
          const reason = submitBlockedReason({
            input,
            profile: profileOf(input),
            references,
            uploading: false,
            assisting: false,
          });
          return reason && `Variant ${letter(index)}: ${reason}`;
        })
        .find(Boolean) ||
      (new Set(keys).size < keys.length ? "Change a variant so each one differs." : undefined);
  return { variants, labels, profileOf, blockedReason };
}

/** Queues the composer's variants as one comparison, sharing a seed unless they set their own. */
export function useCompareRun(onQueued: (comparisonId: string) => void) {
  const draft = useDraft(true);
  const { variants, labels, profileOf } = useDraftComparison();
  const client = useQueryClient();
  return useMutation({
    meta: { inlineError: true },
    mutationFn: () =>
      post<Comparison>("/api/comparisons/run", {
        ...(draft.sessionId ? { sessionId: draft.sessionId } : {}),
        ...(draft.parentJobId ? { parentJobId: draft.parentJobId } : {}),
        ...(draft.parentItemId ? { parentItemId: draft.parentItemId } : {}),
        variants: variants.map(({ input, references }, index) => {
          const profile = profileOf(input);
          return {
            label: labels[index],
            input: generationInput(
              {
                ...input,
                count: 1,
                negative: usesNegative(profile) ? input.negative : "",
              },
              profile,
              references,
            ),
          };
        }),
      }),
    onSuccess: (comparison) => {
      client.setQueryData(["comparison", comparison.id], comparison);
      for (const queryKey of [queueQuery.queryKey, galleryKey, ["comparisons"]])
        void client.invalidateQueries({ queryKey });
      onQueued(comparison.id);
    },
  });
}

/** A saved result's exact settings and seed, as the composer draft that reruns it. */
async function exactDraft(item: MediaItem, client: ReturnType<typeof useQueryClient>) {
  const { draft, seed } = await mediaDraft(item, "image", client);
  return { ...draft, input: { ...draft.input, seed: seed ?? "" } };
}

/**
 * Stages comparisons in the composer: from a result (it and a copy to change), again from a
 * comparison's results (the winner first, from its exact source), from one of them alone (Use
 * This), and Library › Test LoRA's strength sweep.
 */
export function useStageComparison() {
  const { profiles, setDraft } = useGenerationActions();
  const client = useQueryClient();
  const openComposer = useOpenComposer();
  const open = (draft: Draft) => {
    setDraft(draft);
    openComposer("image");
  };
  const [seeds] = useRemembered("compare-seeds", "4");
  return {
    // A result's exact settings, compared across seeds from its own.
    fromItem: async (item: MediaItem) => {
      const draft = await exactDraft(item, client);
      const seed = ownSeed(draft.input.seed) || randomSeed();
      open({
        ...draft,
        input: { ...draft.input, seed },
        compare: { axis: "Seed", seeds: moreSeeds([], Number(seeds) - 1) },
      });
    },
    again: async (items: MediaItem[]) => {
      const drafts = await Promise.all(items.map((item) => exactDraft(item, client)));
      open(setVariants(drafts[0], drafts));
    },
    useThis: async (item: MediaItem) => open(await exactDraft(item, client)),
    testLora: async (name: string, prompt: string) => {
      const [models, info] = await Promise.all([
        client.fetchQuery(modelsQuery),
        client.fetchQuery(loraInfoQuery),
      ]);
      const suits = (profile?: Profile) =>
        Boolean(
          profile &&
          profile.kind === "image" &&
          profile.ready !== false &&
          !isCloudProfile(profile) &&
          profile.capabilities.lora &&
          compatibleLoras(profile, info.loras).includes(name),
        );
      const preferred = defaultProfile(models, "image");
      const profile = suits(preferred) ? preferred : profiles.find(suits);
      if (!profile) throw new Error("No ready image profile can run this LoRA.");
      // Without the LoRA, then its default and the strengths beside it.
      open({
        sessionId: "",
        operation: "image",
        input: { ...inputForProfile({ ...initialInput, prompt }, profile), loras: [] },
        references: [],
        compare: {
          axis: "LoRA Strength",
          lora: name,
          strengths: loraStrengthSweep(info.loras[name]),
        },
      });
    },
  };
}
