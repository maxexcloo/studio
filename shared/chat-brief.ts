/**
 * An account's chat brief: the standing rules and preferences every chat writes its prompts to,
 * so a new chat needn't be told them again. Its fields follow a Dream project's brief. Settings ›
 * Preferences and MCP's project tool (action brief) edit it; what to avoid stays the taste
 * profile's Always Avoid.
 */
export const briefTexts = ["subjects", "ethnicity", "age", "body", "styles", "rules"] as const;
/** Favourite profile ids and LoRA names, best first. */
export const briefLists = ["profiles", "loras"] as const;
export const maxBriefText = 300;
export const maxBriefList = 8;

export type ChatBrief = Partial<
  Record<(typeof briefTexts)[number], string> & Record<(typeof briefLists)[number], string[]>
>;

/** The brief as saved: trimmed, empty fields left out; throws on anything else. */
export function cleanBrief(value: unknown): ChatBrief {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Give the chat brief as fields.");
  const brief: ChatBrief = {};
  for (const [key, entry] of Object.entries(value)) {
    if ((briefTexts as readonly string[]).includes(key)) {
      if (typeof entry !== "string" || entry.trim().length > maxBriefText)
        throw new Error(`Keep the brief's ${key} to ${maxBriefText} characters.`);
      if (entry.trim()) brief[key as (typeof briefTexts)[number]] = entry.trim();
    } else if ((briefLists as readonly string[]).includes(key)) {
      if (
        !Array.isArray(entry) ||
        entry.length > maxBriefList ||
        entry.some((item) => typeof item !== "string" || !item.trim() || item.length > 200)
      )
        throw new Error(`List at most ${maxBriefList} favourite ${key}.`);
      if (entry.length)
        brief[key as (typeof briefLists)[number]] = [
          ...new Set(entry.map((item: string) => item.trim())),
        ];
    } else throw new Error(`The chat brief has no ${key}.`);
  }
  return brief;
}

/** The brief as one line, "subjects …; age …", with profiles by `name`; "" when empty. */
export function briefSummary(brief: ChatBrief, name = (id: string) => id) {
  return [
    ...briefTexts.filter((key) => brief[key]).map((key) => `${key} ${brief[key]}`),
    ...(brief.profiles?.length ? [`models ${brief.profiles.map(name).join(", ")}`] : []),
    ...(brief.loras?.length ? [`LoRAs ${brief.loras.join(", ")}`] : []),
  ].join("; ");
}
