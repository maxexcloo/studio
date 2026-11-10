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
  /** Generate References' queued jobs, until the card is next saved with the ones to keep. */
  generated?: { jobIds: string[]; at: string };
}

/**
 * Generate References: one shot per view, for a consistent set (a character turnaround) the card
 * can keep up to its limit. They share a seed; a card with an image passes its first as a reference.
 */
export const characterViews = [
  "Head-and-shoulders portrait from the front, looking at the camera",
  "Full-body front view, standing straight, arms relaxed",
  "Full-body side view in profile, facing left",
  "Full-body back view, facing away",
] as const;
export const characterShots = (description: string) =>
  characterViews.map((view) =>
    [view, description.trim(), "plain light grey background, even soft lighting"]
      .filter(Boolean)
      .join(", "),
  );

/** The prompt with a card's description added after it, unless the prompt already holds it. */
export function withCharacter(prompt: string, description: string) {
  const text = description.trim();
  if (!text || prompt.includes(text)) return prompt;
  const before = prompt.trimEnd();
  if (!before) return text;
  return `${before}${/[.!?,;:]$/.test(before) ? " " : ", "}${text}`;
}

/** The prompt without a card's description and the comma or space that joined it. */
export function withoutCharacter(prompt: string, description: string) {
  const text = description.trim();
  const at = text ? prompt.indexOf(text) : -1;
  if (at < 0) return prompt;
  const before = prompt.slice(0, at).trimEnd().replace(/,$/, "");
  const rest = prompt.slice(at + text.length);
  const after = rest.replace(/^[\s,;.]+/, "");
  if (!before || !after) return before || after;
  return `${before}${rest.trimStart().startsWith(",") ? ", " : " "}${after}`;
}
