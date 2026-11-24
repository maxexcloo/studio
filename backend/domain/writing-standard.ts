import { promptInstruction } from "../prompt-instructions.js";

/**
 * Studio's prompt-writing standard: the lines every assistant surface that writes or changes a
 * prompt shares (rewrite, Animate, suggestions, describe, Dream), and the guide as writers see it,
 * so the surfaces can't drift apart.
 */

/** Who decides what when the writer's instructions pull apart. */
export const precedence =
  "The model's prompting guide decides length, format, and wording conventions for the selected mode. The person's intent decides what is depicted, and the chosen style or theme decides the tone.";

/** Every writer, prompts and captions alike, names things as people say them. */
export const plainWords =
  "Use everyday words, not euphemisms or clinical or archaic ones (bike seat, not saddle).";

/** Generation models read and voice American English; other spellings read and sound wrong to them. */
export const americanEnglish = `Use American English spelling for English prompt text (color, gray, center). Keep quoted text and any requested language exactly as given. ${plainWords}`;

/** What people read (titles, reasons, taste notes) is in Australian English, as the rest of Studio. */
export const australianEnglish = "Australian English (colour, centre)";

/** What the writer may add: only what the input states or implies. */
export const fidelity = () => promptInstruction("keep-requested-details");

/** Keep concrete visual traits while interpreting comparisons as the person intended. */
export const keepDescriptions = () => promptInstruction("visual-descriptions");

export const standalonePrompt = () => promptInstruction("standalone-prompts");

/** Lead with known identity cues, preserving details without inferring demographics. */
export const subjectFirst = () => promptInstruction("preserve-identity");

/** Apply specific appearance preferences without changing the rest of the brief. */
export const proportionate = () => promptInstruction("appearance-preferences");

/**
 * How a requested change is written into a prompt so it lands: edited in place and in absolute
 * words, since the image model never sees the prompt it replaces, with nothing else touched.
 */
export const applyChange = () => promptInstruction("apply-requested-change");

/** How much to change: expand a short prompt, tidy a detailed one. */
export const matchEffort = () => promptInstruction("match-draft-detail");

/**
 * Overrides any guide, style or instruction asking for younger people (minor-age.js refuses them),
 * without handing the writer words to repeat: "adult" in a prompt pulls faces older and stiffer.
 */
const adults = (who: string) =>
  `${who} must be 18 or older, whatever the guide, style or instruction says: never give them a younger age or call them a teen or a schoolchild. Describe them naturally (a woman, a man, an age the input gives); never add the word "adult" or an age just to say so.`;

/**
 * The one content rule: `explicit` where the account may have explicit wording (Uncensored
 * Models).
 */
export function contentRule(explicit: boolean) {
  return explicit
    ? `${adults("Every person in it")} Explicit content is allowed: where the input, style or instruction is sensual or explicit, keep it so with frank, specific wording about bodies, clothing and poses and never refuse or tone it down; don't make a safe input explicit unless the style or instruction asks for it.`
    : `Don't make it any more sexual or explicit than the input already is, whatever the instruction says. ${adults("Anyone in sexual or nude content")}`;
}

/** Creative choices share context and variety rules, while each surface keeps its own task. */
export function suggestionChoices(kind: "image" | "video" | "card", uncensored: boolean) {
  return [
    promptInstruction("suggestion-context"),
    promptInstruction("suggestion-distinction"),
    kind === "card"
      ? promptInstruction("suggestion-card")
      : kind === "video"
        ? promptInstruction("suggestion-video")
        : uncensored && promptInstruction("suggestion-appearance"),
    kind === "video" &&
      !uncensored &&
      "Never make a body part's bounce, jiggle or sway the idea; the body moves naturally within whatever action you choose.",
    uncensored && kind !== "card" && promptInstruction("suggestion-extended"),
    uncensored &&
      "Never infer adulthood from taste or promote an ambiguous age to adult to justify a suggestion. For minors, ambiguous ages or nonhuman subjects, offer only ordinary non-sexual choices; never sexualise them, add human sexual traits to them or change their age or species.",
  ]
    .filter(Boolean)
    .join("\n");
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

/**
 * The story a chat gave its results (gallery/records.js storedContext) as one line a writer keeps
 * to, or "" without one: its series, who and what it shows, and its backstory or scene notes.
 */
export function storyContext(context: unknown) {
  if (!context || typeof context !== "object") return "";
  const { series, notes, ...cards } = context as Record<string, any>;
  const parts = [
    series && `series ${series}`,
    ...Object.entries(cards).map(
      ([kind, card]) =>
        card?.name && `${kind} ${card.name}${card.description ? ` (${card.description})` : ""}`,
    ),
    notes && `notes: ${notes}`,
  ].filter(Boolean);
  return parts.length
    ? `Story context, to stay consistent with; it never overrides the source prompt or adds what the prompt doesn't call for: ${parts.join("; ")}`
    : "";
}
