/**
 * An account's saved chat brief, available when explicitly requested. Its fields follow a Dream
 * project's brief. Library › Chat Brief and
 * MCP's project tool (action brief) edit it; favourite models and LoRAs and what to avoid stay the
 * taste profile's own Models, LoRAs and Dislikes.
 */
export const briefTexts = ["subjects", "ethnicity", "age", "body", "styles", "rules"] as const;
export const maxBriefText = 300;

export type ChatBrief = Partial<Record<(typeof briefTexts)[number], string>>;

/** The brief as saved: trimmed, empty fields left out; throws on anything else. */
export function cleanBrief(value: unknown): ChatBrief {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Give the chat brief as fields.");
  const brief: ChatBrief = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!(briefTexts as readonly string[]).includes(key))
      throw new Error(`The chat brief has no ${key}.`);
    if (typeof entry !== "string") throw new Error(`Give the brief's ${key} as text.`);
    if (entry.trim().length > maxBriefText)
      throw new Error(
        `The brief's ${key} is ${entry.trim().length} characters; shorten it to at most ${maxBriefText}.`,
      );
    if (entry.trim()) brief[key as (typeof briefTexts)[number]] = entry.trim();
  }
  return brief;
}

/** The brief as one line, "subjects …; age …"; "" when empty. */
export function briefSummary(brief: ChatBrief) {
  return briefTexts
    .filter((key) => brief[key])
    .map((key) => `${key} ${brief[key]}`)
    .join("; ");
}
