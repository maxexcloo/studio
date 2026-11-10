/**
 * Character cards: a name, 1–4 reference images and a short description that picking the card
 * adds to the prompt (backend/characters.js stores them per account).
 */
export const maxCharacterImages = 4;
export const maxCharacterName = 60;
export const maxCharacterDescription = 400;
export const maxCharacters = 200;

export interface Character {
  id: string;
  name: string;
  description: string;
  /** Account-owned reference asset IDs (backend/references.js), in slot order. */
  referenceIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** The prompt with a card's description added after it, unless the prompt already holds it. */
export function withCharacter(prompt: string, description: string) {
  const text = description.trim();
  if (!text || prompt.includes(text)) return prompt;
  const before = prompt.trimEnd();
  if (!before) return text;
  return `${before}${/[.!?,;:]$/.test(before) ? " " : ". "}${text}`;
}

/** The prompt without a card's description and the separator that joined it. */
export function withoutCharacter(prompt: string, description: string) {
  const text = description.trim();
  const at = text ? prompt.indexOf(text) : -1;
  if (at < 0) return prompt;
  const before = prompt.slice(0, at).trimEnd();
  const after = prompt.slice(at + text.length).replace(/^[\s,;.]+/, "");
  if (!after) return before.replace(/[,;:]$/, "");
  return before ? `${before} ${after}` : after;
}
