import { letter } from "../../../../shared/compare.ts";
import type { Resolution } from "../../../../shared/resolution.ts";
import type { GenerationInput } from "../../types";
import { plural } from "../../ui/plural.ts";
import type { Draft, Variant } from "../generation/GenerationProvider";

/** Compares candidates one at a time, keeping the rest of the stack and optionally its baseline. */
export function loraInputs(
  input: GenerationInput,
  candidates: { name: string; strength: number }[],
  without: boolean,
) {
  const baseline = {
    ...input,
    loras: input.loras.filter(
      (lora) => !candidates.some((candidate) => candidate.name === lora.name),
    ),
  };
  return [
    ...(without ? [baseline] : []),
    ...candidates.map(({ name, strength }) => ({
      ...baseline,
      loras: [
        ...baseline.loras,
        {
          triggers: true,
          ...input.loras.find((lora) => lora.name === name),
          name,
          strength,
          enabled: true,
        },
      ],
    })),
  ];
}

/** `input` with the LoRA `name` at each strength, 0 leaving it out. */
export const strengthInputs = (input: GenerationInput, name: string, strengths: number[]) =>
  strengths.map((strength) => ({
    ...input,
    loras: strength
      ? input.loras.some((lora) => lora.name === name)
        ? input.loras.map((lora) =>
            lora.name === name ? { ...lora, strength, enabled: true } : lora,
          )
        : [...input.loras, { name, strength, enabled: true, triggers: true }]
      : input.loras.filter((lora) => lora.name !== name),
  }));

export const randomSeed = () => String(Math.floor(Math.random() * 2 ** 32));

export const ownSeed = (seed: unknown) => (/^\d+$/.test(String(seed)) ? String(seed) : "");

/** `seeds` grown with random ones or cut to `count`. */
export function moreSeeds(seeds: string[], count: number) {
  const next = seeds.slice(0, count);
  while (next.length < count) next.push(randomSeed());
  return next;
}

export const promptLines = (prompt: string) =>
  prompt
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** `input` once per line of its prompt. */
export const promptInputs = (input: GenerationInput) =>
  promptLines(input.prompt).map((prompt) => ({ ...input, prompt }));

/**
 * Each variant `draft` compares as it runs, all on the draft's settings but what is compared; just
 * the draft outside a comparison. `model` moves an input to a profile, if it is still offered.
 */
export function draftVariants(
  { input, references, compare }: Pick<Draft, "input" | "references" | "compare">,
  model: (input: GenerationInput, profileId: string) => GenerationInput | undefined,
): Variant[] {
  const each = (inputs: GenerationInput[]) => inputs.map((one) => ({ input: one, references }));
  if (!compare) return [{ input, references }];
  switch (compare.axis) {
    case "Seed":
      return each([input.seed, ...compare.seeds].map((seed) => ({ ...input, seed })));
    case "Prompt":
      return each(promptInputs(input));
    case "Model":
      return each([
        input,
        ...compare.profileIds.flatMap((profileId) => model(input, profileId) ?? []),
      ]);
    case "LoRA":
      return each(loraInputs(input, compare.loras, compare.without));
    case "LoRA Strength":
      return each(compare.lora ? strengthInputs(input, compare.lora, compare.strengths) : [input]);
    case "Resolution":
      return each(
        compare.sizes.map((size) =>
          compare.native
            ? { ...input, resolution: size }
            : { ...input, resolutionTier: size as Resolution },
        ),
      );
    default:
      return compare.variants.map(({ changes, references: own, label }) => ({
        input: { ...input, ...changes },
        references: own ?? references,
        ...(label && { label }),
      }));
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const referenceIds = ({ references }: Variant) => references.map((reference) => reference.id);

/**
 * `draft` comparing `variants` as they are: the first becomes the draft, and each other keeps only
 * the settings that set the variants apart, so the rest follows the draft. One variant ends it.
 */
export function setVariants<T extends Draft>(draft: T, variants: Variant[]): T {
  const [first] = variants;
  const base = { ...draft, input: first.input, references: first.references };
  if (variants.length < 2) return { ...base, compare: undefined };
  const keys = [...new Set(variants.flatMap(({ input }) => Object.keys(input)))].filter((key) =>
    variants.some(({ input }) => !same(input[key], first.input[key])),
  );
  const ownReferences = variants.some(
    (variant) => !same(referenceIds(variant), referenceIds(first)),
  );
  return {
    ...base,
    compare: {
      variants: variants.map(({ input, references, label }, index) => ({
        changes: index ? Object.fromEntries(keys.map((key) => [key, input[key]])) : {},
        ...(index && ownReferences ? { references } : {}),
        ...(label && { label }),
      })),
    },
  };
}

/** Each variant's seed as it runs: its own, else the first variant's that has one, else random (""). */
export function runSeeds(variants: Variant[]) {
  const own = variants.map(({ input }) => ownSeed(input.seed));
  const shared = own.find(Boolean) ?? "";
  return own.map((seed) => seed || shared);
}

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
  const seeds = runSeeds(variants);
  type Facet = (variant: Variant, index: number) => string;
  const differs = (facet: Facet) =>
    new Set(variants.map((variant, index) => facet(variant, index))).size > 1;
  const profile: Facet = ({ input }) => names.profile(input);
  // Another profile brings its own settings, so they name a variant only on the same profile.
  const settings: Facet[] = differs(profile)
    ? []
    : [
        ({ input }) => plural(Number(input.steps), "Step"),
        ({ input }) => `Guidance ${input.cfg}`,
        ({ input }) =>
          typeof input.resolution === "string" && input.resolution
            ? input.resolution.toUpperCase()
            : input.resolutionTier || `${input.width}×${input.height}`,
      ];
  const facets: Facet[] = [
    profile,
    (_, index) => `Prompt ${letter(prompts.indexOf(prompts[index]))}`,
    ({ input }) =>
      changedLoras
        .map((name) => {
          const value = strength(input, name);
          return `${names.lora(name)} ${value === undefined ? "Off" : value}`;
        })
        .join(", "),
    ...settings,
    (_, index) => `Seed ${seeds[index]}`,
    ({ references }) => plural(references.length, "Reference"),
  ];
  const differing = facets.filter(differs);
  return variants.map(
    (variant, index) =>
      variant.label ||
      differing
        .map((facet) => facet(variant, index))
        .join(" · ")
        .slice(0, 80) ||
      `Variant ${letter(index)}`,
  );
}
