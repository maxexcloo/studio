/**
 * Studio's prompt-writing standard: the lines every assistant surface that writes or changes a
 * prompt shares (rewrite, Animate, suggestions, describe, Dream), and the guide as writers see it,
 * so the surfaces can't drift apart.
 */

/** Who decides what when the writer's instructions pull apart. */
export const precedence =
  "Where these instructions disagree, the model's prompting guide decides the length and format for its mode, the chosen style or theme decides the tone, and the person's own wording wins over both.";

/** What the writer may add: only what the input states or implies. */
export const fidelity =
  "Ground every detail in the input and any image: never add subjects or objects, or invent specific clothing, colours or materials, that the person didn't ask for or clearly imply.";

/** How much to change: expand a short prompt, tidy a detailed one. */
export const matchEffort =
  "Match the effort to the input: expand a short prompt the way the guide recommends, and only tidy a detailed one (order, grammar, repeated ideas), keeping its wording where it already works.";

/**
 * The one content rule: `explicit` where the account may have explicit wording (Uncensored
 * Models, or account-policy.js `explicitWording` where the surface honours the preference).
 */
export function contentRule(explicit: boolean) {
  return explicit
    ? "Every person in it is an adult. Explicit content is allowed: where the input, style or instruction is sensual or explicit, keep it so with frank, specific wording about bodies, clothing and poses and never refuse or tone it down; don't make a safe input explicit unless the style or instruction asks for it."
    : "Don't make it any more sexual or explicit than the input already is, whatever the instruction says.";
}

/** Quality tags and filler that tell a model nothing; writers leave them out. */
export const filler = Object.freeze([
  "masterpiece",
  "best quality",
  "high quality",
  "highly detailed",
  "ultra detailed",
  "8k",
  "4K",
  "epic",
  "stunning",
]);

/** The avoid line for `words` (the shared filler unless a surface adds its own). */
export const avoidFiller = (words: readonly string[] = filler) =>
  `Leave out filler and stacked quality tags that show nothing (${words.join(", ")}): name what is actually seen instead.`;

// Guide parts about settings, provenance or running the model; writing needs only what shapes the prompt.
const omittedGuideKeys = new Set(["operator", "reviewed_on", "sampling", "sources"]);
// A listed rule about running the model (steps, CFG, samplers, sizes, nodes) that says nothing about wording.
const operatorNote =
  /\b(\d+[- ]steps?|steps|cfg|guidance|sampler|scheduler|sigmas?|denoise|megapixels?|\d+(\.\d+)?\s*mp|gpus?|checkpoint|node|workflow)\b/i;
const writingNote = /\b(prompts?|captions?|write|writing|describe|wording|words?|phrases?|text)\b/i;
const isOperatorNote = (value: unknown) =>
  typeof value === "string" && operatorNote.test(value) && !writingNote.test(value);

/** The guide as writers see it, as compact JSON: without settings, provenance or operator notes. */
export function writerGuide(guide: unknown) {
  const prune = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.filter((item) => !isOperatorNote(item)).map(prune)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([key]) => !omittedGuideKeys.has(key))
              .map(([key, item]) => [key, prune(item)]),
          )
        : value;
  return guide && typeof guide === "object" ? JSON.stringify(prune(guide)) : "";
}
