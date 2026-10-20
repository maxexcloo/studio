// SPDX-License-Identifier: AGPL-3.0-only
// Checks Generate applies to prompt text: a full-body person gets face detail, and an exact prompt must not carry instructions.
import { maxJobsPerCall } from './mcp-media.js';

const numberWords = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12 };
const number = `(\\d+|${Object.keys(numberWords).join('|')})`;
const numberOf = (word) => /^\d+$/.test(word) ? Number(word) : numberWords[word.toLowerCase()];

// Both are needed: a person word and a cue that the whole figure is in frame, so a portrait or a landscape stays as it was.
const personWords = /\b(person|persons|people|man|men|woman|women|girl|girls|boy|boys|model|models|couple|lady|ladies|guy|guys)\b/i;
const fullBodyCues = /\b(full[\s-]?body|full[\s-]length|full[\s-]figure|whole[\s-]body|head[\s-]to[\s-](toe|toes|feet)|wide[\s-](angle\s+)?shot|long[\s-]shot|standing)\b/i;
/** Whether a prompt shows a person whose face is small in frame: a full-body, wide or standing shot of someone. */
export function fullBodyPerson(prompt) {
  const text = String(prompt || '');
  return personWords.test(text) && fullBodyCues.test(text);
}

// "Generate five … of this scene: <prompt>" is an instruction to Studio, not a prompt for the model.
const instructionPatterns = [
  new RegExp(`^\\W*(?:please\\s+)?(?:generate|make|create|produce|render|give\\s+me)\\s+(?:me\\s+)?${number}\\b`, 'i'),
  new RegExp(`\\b(?:generate|make|create|produce|render)\\s+(?:me\\s+)?${number}\\s+(?:[\\w-]+\\s+){0,4}?(?:variations?|versions?|variants?|images?|photos?|pictures?|shots?)\\b`, 'i'),
  new RegExp(`\\b${number}\\s+(?:[\\w-]+\\s+){0,3}?(?:variations|variants)\\b`, 'i'),
  /\bvariations?\s+(?:of|on)\s+(?:this|the|that)\s+(?:scene|image|prompt|photo|picture)\b/i,
  /\bof\s+this\s+(?:scene|image|prompt|photo|picture)\s*:/i
];
/**
 * The refusal for an exact prompt that holds generation instructions, or '' when it reads as a finished prompt.
 * Refusing, rather than rewriting, keeps the caller's prompt exactly what runs.
 */
export function exactPromptInstructions(request) {
  const text = String(request || '');
  let found = null;
  for (const pattern of instructionPatterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    found ||= match;
    if (match[1] && numberOf(match[1])) { found = match; break; }
  }
  if (!found) return '';
  const count = found[1] ? numberOf(found[1]) : 0;
  const quoted = found[0].trim().replace(/\s+/g, ' ');
  const counted = count ? `count: ${count}` : 'count (the number of images)';
  return `exact_prompt is for a finished prompt only, and this request holds instructions ("${quoted}"). Call Generate again with ${counted} (1–${maxJobsPerCall} per call) and request set to just the plain prompt, without the instructions${count ? '' : ' or a number of images'}; or leave exact_prompt off so Studio writes from your words.`;
}
