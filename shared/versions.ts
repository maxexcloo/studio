import type { GenerationInput, GenerationOperation, QueueMedia } from "./queue.ts";

/**
 * The least share of prompt words (distinct words both prompts use, of the words either uses) a
 * fresh run from a result must keep to stay one of its versions.
 */
export const versionPromptOverlap = 0.5;

const words = (prompt: unknown) =>
  new Set(
    String(prompt || "")
      .toLowerCase()
      .match(/\w+/g),
  );

/** The share of distinct words two prompts have in common, 1 when both are empty. */
function promptOverlap(a: unknown, b: unknown) {
  const left = words(a);
  const right = words(b);
  const union = new Set([...left, ...right]).size;
  if (!union) return 1;
  return [...left].filter((word) => right.has(word)).length / union;
}

const model = (input: GenerationInput) => String(input.profileId || input.model || "");

/**
 * Whether a run made from a result (its recorded `parentItemId`) is one of that result's versions,
 * an iteration of it, rather than a new image derived from it. Every iteration is, whatever model
 * or operation it uses: an edit or animation (Edit, Animate, the viewer's prompt, a Chat edit)
 * works on the result itself, and a fresh run from its settings (Edit Prompt, Run Again, Repeat Exactly,
 * on any model) keeps at least `versionPromptOverlap` of its prompt. Only a fresh run that replaces
 * most of the prompt, using the result as a reference or starting point for something new, is
 * derived. A source no model made (an upload, gallery/recreate.js) has no prompt to keep, so every
 * run from it (Edit Prompt on its suggested prompt) is a version.
 */
export function isVersion(
  run: { operation: GenerationOperation; input: GenerationInput },
  source: { input: GenerationInput },
) {
  if (run.operation !== "image" || !model(source.input)) return true;
  return promptOverlap(run.input.prompt, source.input.prompt) >= versionPromptOverlap;
}

/**
 * A saved result as the source `isVersion` compares a run with, for a source whose own run is gone:
 * its recorded settings, prompt and model.
 */
export const resultInput = (item: {
  settings?: Record<string, unknown>;
  prompt?: string;
  model?: string;
}): GenerationInput => ({ ...item.settings, prompt: item.prompt, model: item.model });

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
