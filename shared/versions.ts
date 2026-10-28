import type { GenerationInput, GenerationOperation, QueueMedia } from "./queue.ts";

/**
 * The least share of prompt words (distinct words both prompts use, of the words either uses) a
 * run made from a result's settings must keep to stay one of its versions.
 */
export const versionPromptOverlap = 0.5;

const words = (prompt: unknown) =>
  new Set(
    String(prompt || "")
      .toLowerCase()
      .match(/\w+/g),
  );

/** The share of distinct words two prompts have in common, 1 when both are empty. */
export function promptOverlap(a: unknown, b: unknown) {
  const left = words(a);
  const right = words(b);
  const union = new Set([...left, ...right]).size;
  if (!union) return 1;
  return [...left].filter((word) => right.has(word)).length / union;
}

const model = (input: GenerationInput) => String(input.profileId || input.model || "");

/**
 * Whether a run made from a result (its recorded `parentItemId`) is one of that result's versions
 * rather than a new image derived from it. Edits and animations work on the result itself, so they
 * always are; a run from its settings (Prompt, Run Again, Exact Repeat) is while it keeps the
 * profile and at least `versionPromptOverlap` of the prompt.
 */
export function isVersion(
  run: { operation: GenerationOperation; input: GenerationInput },
  source: { input: GenerationInput },
) {
  if (run.operation !== "image") return true;
  return (
    model(run.input) === model(source.input) &&
    promptOverlap(run.input.prompt, source.input.prompt) >= versionPromptOverlap
  );
}

/**
 * The result of `parent` that a run's first reference is (the image, or a video's last frame), so
 * the run was made from it. Chat records its runs' sources this way.
 */
export function referencedResult(
  input: GenerationInput,
  parent: { items?: QueueMedia[]; outputs?: QueueMedia[] },
) {
  const references = Array.isArray(input.referenceAssets) ? input.referenceAssets : [];
  const id = String(references[0]?.assetId || "").replace(/:last-frame$/, "");
  return id && [...(parent.items || []), ...(parent.outputs || [])].some((item) => item.id === id)
    ? id
    : undefined;
}
