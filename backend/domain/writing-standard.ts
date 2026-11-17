/**
 * Studio's prompt-writing standard: the lines every assistant surface that writes or changes a
 * prompt shares (rewrite, Animate, suggestions, describe, Dream), and the guide as writers see it,
 * so the surfaces can't drift apart.
 */

/** Who decides what when the writer's instructions pull apart. */
export const precedence =
  "Where these instructions disagree, the model's prompting guide decides the length and format for its mode, the chosen style or theme decides the tone, and the person's own wording wins over both.";

/** Generation models read and voice American English; other spellings read and sound wrong to them. */
export const americanEnglish =
  "Write prompt text in American English (color, gray, center), whatever spelling the input or these instructions use; quoted text stays as written.";

/** What the writer may add: only what the input states or implies. */
export const fidelity =
  "Ground every detail in the input and any image: never add subjects or objects, or invent specific clothing, colors or materials, that the person didn't ask for or clearly imply.";

/** A person's description stays word for word, so a subject looks the same from prompt to prompt. */
export const keepDescriptions =
  "Keep the person's own descriptions of people and things (face, body, skin, hair, clothing) word for word; change them only where the instruction asks.";

/** A person's age and ethnicity lead and stay, since a late or dropped one is often lost in the image. */
export const subjectFirst =
  "Name each person's age and ethnicity in the prompt's first words, show the ethnicity in their face (eye shape, nose, skin tone) and keep both through every rewrite and change.";

/**
 * A person's rules applied in proportion, so a batch keeps what they like: an attractiveness word
 * and one small real mark score best, a face rewritten plain or older worst.
 */
export const proportionate =
  "Apply each rule in proportion: real flaws means subtle texture (pores, slight asymmetry, a freckle or small mark) on the face asked for, never a plainer, older, harsher or more masculine one; keep the asked-for age, attractiveness and style, and vary a batch within the brief, never away from it.";

/**
 * How a requested change is written into a prompt so it lands: edited in place and in absolute
 * words, since the image model never sees the prompt it replaces, with nothing else touched.
 */
export const applyChange =
  'Make the change land clearly: rewrite the words it concerns in place, replacing whatever contradicts it rather than adding beside it, and state the new result in absolute words, since the image model never sees the earlier prompt ("a red satin dress", never "a redder dress", "much bigger" or "than before"); where the change is to the person themselves (body, face, hair, clothing, pose), name it where they are first described. Keep every other word as it was and add nothing the change doesn\'t ask for (no quality, skin or style tags).';

/** How much to change: expand a short prompt, tidy a detailed one. */
export const matchEffort =
  "Match the effort to the input: expand a short prompt the way the guide recommends, and only tidy a detailed one (order, grammar, repeated ideas), keeping its wording where it already works.";

/** Overrides any guide, style or instruction asking for younger people (minor-age.js refuses them). */
const adults = (who: string) =>
  `${who} is an adult, 18 or older, whatever the guide, style or instruction says: never give them a younger age or call them a teen or a schoolchild.`;

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
export function suggestionChoices(kind: "image" | "video" | "card", spicy: boolean) {
  return [
    "Infer useful choices from the current prompt and reference images first; taste is secondary and never replaces the current subject. Preserve identity, species, breed, age, ethnicity and the person's own wording except for the particular change offered. Each option is an independent choice, never a change to apply automatically. Choosing one new detail is the suggestion itself; it gives no permission to change unrelated details. If the typed prompt differs from the source picture or caption, its wording describes the proposed result and the picture is source context only.",
    "Make alternatives meaningfully different in what they offer, not synonyms or near-duplicates with different labels. Avoid repeating already offered ideas, including paraphrases; choose details specific to this context rather than generic improvements.",
    kind === "card"
      ? "These choices name or describe the same reference, not alternative appearances: vary the useful visible details stressed, without inventing or changing bodies, clothing, identity or setting. Keep each card kind's scope."
      : kind === "video"
        ? "Vary motion, subject action, expression, interaction, camera movement, atmosphere, pace or sound where the scene supports them. Keep the subject's existing appearance and anatomy; static body-shape, wardrobe or setting replacements are not motion ideas."
        : spicy &&
          "For a clearly adult human subject, include a non-graphic body-shape, proportion or build alternative where it would be useful and visible, alongside distinct pose, framing, outfit, setting or other relevant choices. Infer a specific alternative from this subject's existing description, not a stock ideal: vary in different directions over refreshes, without treating slimmer, curvier, larger or more muscular as inherently better. A proposed body change replaces only the relevant trait; every unchosen trait stays as written.",
    spicy &&
      "Spicy permits context-fitting sensual choices only for clearly adult humans; it does not require every option to be sensual. Never infer adulthood from taste or promote an ambiguous age to adult to justify a suggestion. For minors, ambiguous ages or nonhuman subjects, offer only ordinary non-sexual choices; never sexualise them, add human sexual traits to them or change their age or species.",
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
