// More Like This Set: the queue's writing stage writes one new variation for an MCP result set
// (prompt-stage.js), anchored to its selected source with earlier variations for variety.
import { maxPromptCharacters } from "../shared/queue.ts";
import { replyTitle } from "../shared/titles.ts";
import { AssistantError, cleanPrompt } from "./assistant.js";
import { writerGuide } from "./domain/writing-standard.ts";

// The newest prompts are enough to steer away from; older ones only lengthen the request.
const shownPrompts = 12;

/**
 * Resolves to `{ prompt, title, thinking, model }` for one new variation of the set, written by the
 * account's prompt `writer` (assistant.js `writerModel`); throws AssistantError.
 */
export async function writeSetPrompt({
  engine,
  profile,
  guide,
  title,
  source,
  prompts,
  writer,
  signal,
  onThinking,
  onDelta,
}) {
  const model = await engine.model("rewrite", false, writer);
  const reply = await engine.chat({
    call: "rewrite",
    model,
    messages: [
      {
        role: "system",
        content: [
          `You write one new prompt for ${profile.label || profile.id}, a variation in the set "${title}".`,
          "The source prompt defines the subject and intended set theme. Preserve its species, breed, identity and defining appearance, and keep its theme and style. Vary the pose, scene, composition or camera angle within that theme; never switch animal species or replace the subject.",
          "The set title is only a label and may be incomplete. Previous variations are only for avoiding repetition: ignore any that drift away from the source; they must never redefine the subject or theme.",
          `Prompting guide: ${writerGuide(guide) || "(none; write a clear, specific natural-language prompt)"}`,
          'Reply with JSON only: {"title": "a concise two to four word Title Case label naming the content, without request wording", "prompt": "the finished prompt"}.',
        ]
          .filter(Boolean)
          .join("\n"),
      },
      {
        role: "user",
        content: `Source prompt (authoritative subject and theme):\n${source}\n\nPrevious variations (avoid repetition, not subject guidance):\n${prompts
          .slice(-shownPrompts)
          .map((prompt) => `- ${prompt.replace(/\s+/g, " ").slice(0, 1000)}`)
          .join("\n")}`,
      },
    ],
    temperature: 1,
    maxTokens: 3000,
    signal,
    onThinking,
    onDelta,
  });
  let written = {};
  try {
    written = JSON.parse(/\{[\s\S]*\}/.exec(reply.text)?.[0] || "");
  } catch {
    /* Unusable; refused below. */
  }
  const prompt = cleanPrompt(String(written.prompt || "")).slice(0, maxPromptCharacters);
  if (!prompt) throw new AssistantError("unusable reply");
  const named = replyTitle(written.title);
  return {
    prompt,
    thinking: reply.thinking,
    model,
    ...(named ? { title: named } : {}),
  };
}
