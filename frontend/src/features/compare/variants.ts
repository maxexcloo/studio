import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { post } from "../../api";
import type { GenerationInput, MediaItem, Profile } from "../../types";
import { compareVariants } from "../../../../shared/compare";
import { mediaDraft } from "../gallery/useMediaAction";
import {
  defaultProfile,
  initialInput,
  inputForProfile,
  modelsQuery,
  useGeneration,
  useGenerationActions,
  type Draft,
  type Variant,
} from "../generation/GenerationProvider";
import { submitBlockedReason } from "../generation/GenerationEditor";
import { compatibleLoras, loraInfoQuery, loraTitle } from "../generation/LoraPicker";
import { useOpenComposer } from "../generation/openComposer";
import {
  generationInput,
  isProfile,
  profileForBackend,
  profileName,
  usesNegative,
} from "../generation/payload";
import { queueQuery } from "../generation/Queue";
import { isCloudProfile } from "../../../../shared/profiles";
import type { Comparison } from "./queries";

export const letter = (index: number) => String.fromCharCode(65 + index);

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
    ...variants[index],
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

/**
 * Each variant named by what sets it apart from the others ("Flux Dev · 30 Steps"), or by its
 * letter when nothing recorded here does.
 */
export function variantLabels(
  variants: Variant[],
  names: { profile: (input: GenerationInput) => string; lora: (name: string) => string },
) {
  const enabled = (input: GenerationInput) => input.loras.filter((lora) => lora.enabled !== false);
  const strength = (input: GenerationInput, name: string) =>
    enabled(input).find((lora) => lora.name === name)?.strength;
  const loraNames = [
    ...new Set(variants.flatMap(({ input }) => enabled(input).map((l) => l.name))),
  ];
  const changedLoras = loraNames.filter(
    (name) => new Set(variants.map(({ input }) => strength(input, name))).size > 1,
  );
  const prompts = variants.map(({ input }) => JSON.stringify([input.prompt, input.negative]));
  const facets: ((variant: Variant, index: number) => string)[] = [
    ({ input }) => names.profile(input),
    (_, index) => `Prompt ${letter(prompts.indexOf(prompts[index]))}`,
    ({ input }) =>
      changedLoras
        .map((name) => {
          const value = strength(input, name);
          return `${names.lora(name)} ${value === undefined ? "Off" : value}`;
        })
        .join(", "),
    ({ input }) => `${input.steps} Steps`,
    ({ input }) => `Guidance ${input.cfg}`,
    ({ input }) => `${input.width}×${input.height}`,
    ({ references }) => `${references.length} References`,
  ];
  const differing = facets.filter(
    (facet) => new Set(variants.map((variant, index) => facet(variant, index))).size > 1,
  );
  return variants.map(
    (variant, index) =>
      differing
        .map((facet) => facet(variant, index))
        .join(" · ")
        .slice(0, 80) || `Variant ${letter(index)}`,
  );
}

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
    );
  const labels = variantLabels(variants, {
    profile: (input) => {
      const profile = profileOf(input);
      return profile ? profileName(profile) : input.profileId;
    },
    lora: (name) => loraTitle(lora?.[name], name),
  });
  const keys = variants.map(({ input, references }) =>
    JSON.stringify([{ ...input, seed: "" }, references.map((reference) => reference.id)]),
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

/** Queues the composer's variants as one comparison with a shared seed, then shows it. */
export function useCompareRun(onSubmitted?: () => void) {
  const { draft } = useGeneration();
  const { variants, labels, profileOf } = useDraftComparison();
  const client = useQueryClient();
  const navigate = useNavigate();
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
                seed: variants[0].input.seed,
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
      for (const queryKey of [queueQuery.queryKey, ["gallery"], ["comparisons"]])
        void client.invalidateQueries({ queryKey });
      onSubmitted?.();
      navigate(`/compare/${comparison.id}`);
    },
  });
}

/** A saved result's exact settings and seed, as the composer draft that reruns it. */
async function exactDraft(
  item: MediaItem,
  profiles: Profile[],
  client: ReturnType<typeof useQueryClient>,
) {
  const { draft, seed } = await mediaDraft(item, "image", profiles, client);
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
    fromItem: async (item: MediaItem) => open(addVariant(await exactDraft(item, profiles, client))),
    again: async (items: MediaItem[]) => {
      const drafts = await Promise.all(items.map((item) => exactDraft(item, profiles, client)));
      open(showVariant(drafts[0], drafts, 0));
    },
    useThis: async (item: MediaItem) => open(await exactDraft(item, profiles, client)),
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
      // Without the LoRA, then three strengths.
      const variants = [0, 0.6, 0.8, 1].map((strength) => ({
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
