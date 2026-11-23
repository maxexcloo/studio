// Checks generate applies to prompt text: a full-body person gets face detail, and exact prompts must not carry instructions.
import { similarPrompt } from "../domain/dream-concepts.ts";
import { maxJobsPerCall } from "./controls.js";

const numberWords = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  dozen: 12,
};
const number = `(\\d+|${Object.keys(numberWords).join("|")})`;
const numberOf = (word) => (/^\d+$/.test(word) ? Number(word) : numberWords[word.toLowerCase()]);

// Both are needed: a person word and a cue that the whole figure is in frame, so a portrait or a landscape stays as it was.
const personWords =
  /\b(person|persons|people|man|men|woman|women|girl|girls|boy|boys|model|models|couple|lady|ladies|guy|guys)\b/i;
const fullBodyCues =
  /\b(full[\s-]?body|full[\s-]length|full[\s-]figure|whole[\s-]body|head[\s-]to[\s-](toe|toes|feet)|wide[\s-](angle\s+)?shot|long[\s-]shot|standing)\b/i;
/** Whether a prompt shows a person whose face is small in frame: a full-body, wide or standing shot of someone. */
export function fullBodyPerson(prompt) {
  const text = String(prompt || "");
  return personWords.test(text) && fullBodyCues.test(text);
}

// "Generate five … of this scene: <prompt>" is an instruction to Studio, not a prompt for the model.
// Only clear meta-instructions count, so a finished prompt such as "Create two cats on a sofa" runs as written.
const instructionPatterns = [
  new RegExp(
    `\\b(?:generate|make|create)\\s+(?:me\\s+)?${number}\\s+(?:[\\w-]+\\s+){0,3}?(?:images?|pictures?|photos?|versions?)\\b`,
    "i",
  ),
  new RegExp(
    `\\b${number}\\s+(?:[\\w-]+\\s+){0,3}?variations\\b(?=\\s*(?:[:;,]|please\\b|of\\s+(?:this|the same)\\s+scene\\b|$))`,
    "i",
  ),
  /\bvariations\s+(?:please\b|of\s+(?:this|the same)\s+scene\b)/i,
  /\b(?:generate|make|create)\s+(?:me\s+)?(?:some\s+|a few\s+)?variations\b/i,
  /\bof\s+this\s+scene\b/i,
];
/**
 * The refusal for an exact prompt that holds generation instructions, or '' when it reads as a finished prompt.
 * Refusing, rather than rewriting, keeps the caller's prompt exactly what runs.
 */
export function exactPromptInstructions(prompt) {
  const text = String(prompt || "");
  let found = null;
  for (const pattern of instructionPatterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    found ||= match;
    if (match[1] && numberOf(match[1])) {
      found = match;
      break;
    }
  }
  if (!found) return "";
  const count = found[1] ? numberOf(found[1]) : 0;
  const quoted = found[0].trim().replace(/\s+/g, " ");
  const counted = count ? `count: ${count}` : "count (the number of images)";
  return `prompts run verbatim, and this one holds instructions ("${quoted}"). Call generate again with ${counted} (1–${maxJobsPerCall} per call) and prompts set to just the plain prompt when repeating one image idea. For distinct results, send one finished prompt per image. Include the user's original words as request.`;
}

const words = (prompt) =>
  [...new Set(prompt.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])].sort().join(" ");
/**
 * The refusal for a prompt list that isn't several distinct prompts, or '' when it is: a JSON list
 * that failed to parse would run as one prompt, and prompts with the same words make the same image.
 */
export function promptListProblem(prompts) {
  if (prompts.length === 1 && /^\s*\[\s*"/.test(prompts[0]))
    return 'prompts reads as a JSON list but isn\'t valid JSON, so it would run as one prompt. Pass prompts as an array of strings, such as ["first prompt", "second prompt"], and call generate again.';
  const seen = new Map();
  for (const [index, prompt] of prompts.entries()) {
    const key = words(prompt);
    if (seen.has(key))
      return `prompts ${seen.get(key) + 1} and ${index + 1} have the same words, so they make the same image. For more images of one prompt, raise count; otherwise make each prompt distinct (vary framing, angle, pose, outfit or setting) and call generate again.`;
    seen.set(key, index);
  }
  return "";
}

/**
 * The refusal for prompts that repeat one of the conversation's earlier sets (`earlier`, each its
 * number and prompts), or '' when none does: a large batch otherwise circles the same ideas.
 */
export function repeatedSetProblem(prompts, earlier) {
  for (const [index, prompt] of prompts.entries())
    for (const set of earlier)
      if (set.prompts.some((other) => similarPrompt(prompt, other)))
        return `prompt ${index + 1} repeats set ${set.number}. Give each prompt a new idea (subject, setting, outfit, action or framing) that earlier sets haven't used, and call generate again.`;
  return "";
}

/** The number of images the user's words ask for ("200 more", "five photos"), or 0 when they name none. */
export function requestedCount(request) {
  const match = new RegExp(
    `\\b${number}\\s+(?:more\\b|(?:[\\w-]+\\s+){0,3}?(?:images?|pictures?|photos?|results?|versions?|variations?)\\b)`,
    "i",
  ).exec(String(request || ""));
  return match ? numberOf(match[1]) : 0;
}

/**
 * The refusal when a chat turn would queue more images than its request asked for, or '':
 * `queued` is what the turn has queued already and `adding` this call's images.
 */
export function turnCountProblem(request, queued, adding) {
  const requested = requestedCount(request);
  if (!requested || queued + adding <= requested) return "";
  const left = requested - queued;
  return left > 0
    ? `the user asked for ${requested} images and this turn has queued ${queued}; queue at most ${left} more.`
    : `the user asked for ${requested} images and this turn has queued them all. Share the links and end the turn.`;
}
