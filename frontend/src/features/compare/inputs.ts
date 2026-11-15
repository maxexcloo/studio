import type { GenerationInput } from "../../types";
import type { Variant } from "../generation/GenerationProvider";

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

const randomSeed = () => String(Math.floor(Math.random() * 2 ** 32));

/** `input` with `count` seeds: its own where it has one, then random ones. */
export function seedInputs(input: GenerationInput, count: number) {
  const own = String(input.seed);
  const seeds = [/^\d+$/.test(own) ? own : randomSeed()];
  while (seeds.length < count) seeds.push(randomSeed());
  return seeds.map((seed) => ({ ...input, seed }));
}

export const promptLines = (prompt: string) =>
  prompt
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** `input` once per line of its prompt. */
export const promptInputs = (input: GenerationInput) =>
  promptLines(input.prompt).map((prompt) => ({ ...input, prompt }));

export const letter = (index: number) => String.fromCharCode(65 + index);

/** Each variant's seed as it runs: its own, else the first variant's that has one, else random (""). */
export function runSeeds(variants: Variant[]) {
  const own = variants.map(({ input }) =>
    /^\d+$/.test(String(input.seed)) ? String(input.seed) : "",
  );
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
        ({ input }) => `${input.steps} Steps`,
        ({ input }) => `Guidance ${input.cfg}`,
        ({ input }) =>
          typeof input.resolution === "string" && input.resolution
            ? input.resolution.toUpperCase()
            : `${input.width}×${input.height}`,
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
    ({ references }) => `${references.length} References`,
  ];
  const differing = facets.filter(differs);
  return variants.map(
    (variant, index) =>
      differing
        .map((facet) => facet(variant, index))
        .join(" · ")
        .slice(0, 80) || `Variant ${letter(index)}`,
  );
}
