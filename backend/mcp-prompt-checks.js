// SPDX-License-Identifier: AGPL-3.0-only
// Checks Generate applies to prompt text: a full-body person gets face detail, and exact prompts must not carry instructions.
import { maxJobsPerCall } from "./mcp-media.js";

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
  new RegExp(`\\b${number}\\s+(?:[\\w-]+\\s+){0,3}?variations\\b`, "i"),
  /\bvariations\b/i,
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
  return `prompts run verbatim, and this one holds instructions ("${quoted}"). Call Generate again with ${counted} (1–${maxJobsPerCall} per call) and prompts set to just the plain prompt, without the instructions${count ? "" : " or a number of images"}; or pass the user's words as request so Studio writes the prompts.`;
}
