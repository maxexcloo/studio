import type { GenerationInput } from "../../types";

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
