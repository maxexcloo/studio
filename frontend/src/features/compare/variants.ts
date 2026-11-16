import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { compareVariants } from "../../../../shared/compare";
import { isCloudProfile, loraName, loraStrengthSweep } from "../../../../shared/profiles";
import { post } from "../../api";
import type { GenerationInput, MediaItem, Profile } from "../../types";
import { galleryKey } from "../gallery/queries";
import { mediaDraft } from "../gallery/useMediaAction";
import { submitBlockedReason } from "../generation/GenerationEditor";
import {
  type Draft,
  type Variant,
  defaultProfile,
  initialInput,
  inputForProfile,
  modelsQuery,
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
import { letter, runSeeds, variantLabels } from "./inputs";
import type { Comparison } from "./queries";

/** Every variant of `draft`, the one being edited as it stands; just it outside a comparison. */
export function draftVariants(draft: Draft): Variant[] {
  const current = { input: draft.input, references: draft.references };
  return draft.compare
    ? draft.compare.variants.map((variant, index) =>
        index === draft.compare!.active ? current : variant,
      )
    : [current];
}

/** `draft` editing `variants[index]`; a single variant ends the comparison. */
export function showVariant(draft: Draft, variants: Variant[], index: number): Draft {
  return {
    ...draft,
    input: variants[index].input,
    references: variants[index].references,
    compare: variants.length > 1 ? { variants, active: index } : undefined,
  };
}

/** Adds a copy of the variant being edited, then edits the copy. */
export function addVariant(draft: Draft): Draft {
  const variants = draftVariants(draft);
  const next = [...variants, variants[draft.compare?.active ?? 0]];
  return showVariant(draft, next, next.length - 1);
}

export function removeVariant(draft: Draft): Draft {
  const active = draft.compare?.active ?? 0;
  const next = draftVariants(draft).filter((_, index) => index !== active);
  return showVariant(draft, next, Math.min(active, next.length - 1));
}

export const canAddVariant = (draft: Draft) => draftVariants(draft).length < compareVariants.max;

export const fitsComparison = (count: number) =>
  count >= compareVariants.min && count <= compareVariants.max;

/** A comparison of `inputs`, each a change to the variant being edited, whose references they keep. */
export function compareInputs(draft: Draft, inputs: GenerationInput[]): Draft {
  return showVariant(
    draft,
    inputs.map((input) => ({ input, references: draft.references })),
    0,
  );
}

/** `input` as it stands, then on each of `profiles` with its seed. */
export const modelInputs = (input: GenerationInput, profiles: Profile[]) => [
  input,
  ...profiles.map((profile) => ({ ...inputForProfile(input, profile), seed: input.seed })),
];

/** The composer's comparison: its variants, their labels and why it can't run yet, if it can't. */
export function useDraftComparison() {
  const { draft, profiles, models } = useGeneration();
  const lora = useQuery(loraInfoQuery).data?.loras;
  const variants = draftVariants(draft);
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
      return profile ? profileName(profile) : input.profileId;
    },
    lora: (name) => loraName(name, lora?.[name]),
  });
  const seeds = runSeeds(variants);
  const keys = variants.map(({ input, references }, index) =>
    JSON.stringify([{ ...input, seed: seeds[index] }, references.map((reference) => reference.id)]),
  );
  const blockedReason =
    variants
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
  const { draft } = useGeneration();
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
  return {
    fromItem: async (item: MediaItem) => open(addVariant(await exactDraft(item, client))),
    again: async (items: MediaItem[]) => {
      const drafts = await Promise.all(items.map((item) => exactDraft(item, client)));
      const variants = drafts.map(({ input, references }) => ({ input, references }));
      open(showVariant(drafts[0], variants, 0));
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
      const input = { ...inputForProfile({ ...initialInput, prompt }, profile), loras: [] };
      // Without the LoRA, then its default and the strengths beside it.
      const variants = loraStrengthSweep(info.loras[name]).map((strength) => ({
        references: [],
        input: {
          ...input,
          loras: strength ? [{ name, strength, enabled: true, triggers: true }] : [],
        },
      }));
      open(showVariant({ sessionId: "", operation: "image", input, references: [] }, variants, 0));
    },
  };
}
