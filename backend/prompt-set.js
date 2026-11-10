// More Like This Set: the queue's writing stage writes one new variation for an MCP result set
// (prompt-stage.js), from the set's title and the prompts it holds so far.
import { maxPromptCharacters } from "../shared/queue.ts";
import { replyTitle } from "../shared/titles.ts";
import { AssistantError, cleanPrompt } from "./assistant.js";
import { writerGuide } from "./domain/writing-standard.ts";

// The newest prompts are enough to steer away from; older ones only lengthen the request.
const shownPrompts = 12;

/** Resolves to `{ prompt, title, thinking, model }` for one new variation of the set; throws AssistantError. */
export async function writeSetPrompt({
  engine,
  profile,
  guide,
  title,
  prompts,
  signal,
  onThinking,
  onDelta,
}) {
  const model = await engine.model("rewrite");
  const reply = await engine.chat({
    call: "rewrite",
    model,
    messages: [
      {
        role: "system",
        content: [
          `You write one new prompt for ${profile.label || profile.id}, a variation in the set "${title}".`,
          "Keep the set's theme and style, and make it distinct from every prompt in it: a different subject, scene or angle.",
          `Prompting guide: ${writerGuide(guide) || "(none; write a clear, specific natural-language prompt)"}`,
          'Reply with JSON only: {"title": "a two to four word title", "prompt": "the finished prompt"}.',
        ]
          .filter(Boolean)
          .join("\n"),
      },
      {
        role: "user",
        content: `The set's prompts so far:\n${prompts
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
  return { prompt, thinking: reply.thinking, model, ...(named ? { title: named } : {}) };
}
