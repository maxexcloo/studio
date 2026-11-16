// The queue's writing stage writes a variation of the selected image or set source.
import { maxPromptCharacters } from "../shared/queue.ts";
import { replyTitle } from "../shared/titles.ts";
import { AssistantError, cleanPrompt } from "./assistant.js";
import { userContent } from "./domain/model-content.ts";
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
  scope,
  source,
  prompts,
  writer,
  frame = async () => null,
  caption = () => "",
  signal,
  onThinking,
  onDelta,
}) {
  const model = await engine.model("rewrite", false, writer);
  const image = scope === "image" && (await engine.supportsVision(writer)) ? await frame() : null;
  const shown = scope === "image" && !image ? String((await caption()) || "").trim() : "";
  const reply = await engine.chat({
    call: "rewrite",
    model,
    messages: [
      {
        role: "system",
        content: [
          scope === "image"
            ? `You write one new prompt for ${profile.label || profile.id}, a variation of the selected image. Keep that image's subject and its source prompt's intent; do not broaden it to the surrounding set.`
            : `You write one new prompt for ${profile.label || profile.id}, a variation in the set "${title}".`,
          scope === "image" && (image || shown)
            ? "The selected image defines the subject and visible appearance. Preserve its species, breed, identity, markings and defining appearance. Its source prompt supplies the intended theme, style and requested details, not permission to substitute another subject. Vary the pose, scene, composition or camera angle within that theme; never switch animal species or replace the subject."
            : "The source prompt defines the subject and intended set theme. Preserve its species, breed, identity and defining appearance, and keep its theme and style. Vary the pose, scene, composition or camera angle within that theme; never switch animal species or replace the subject.",
          "The set title is only a label and may be incomplete. Previous variations are only for avoiding repetition: ignore any that drift away from the source; they must never redefine the subject or theme.",
          `Prompting guide: ${writerGuide(guide) || "(none; write a clear, specific natural-language prompt)"}`,
          'Reply with JSON only: {"title": "a concise two to four word Title Case label naming the content, without request wording", "prompt": "the finished prompt"}.',
        ]
          .filter(Boolean)
          .join("\n"),
      },
      {
        role: "user",
        content: userContent(
          [
            `Source prompt (authoritative subject and theme):\n${source}`,
            shown ? `What the selected image shows: ${shown}` : "",
            `Previous variations (avoid repetition, not subject guidance):\n${prompts
              .slice(-shownPrompts)
              .map((prompt) => `- ${prompt.replace(/\s+/g, " ").slice(0, 1000)}`)
              .join("\n")}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
          image ? [image] : [],
          Boolean(image),
        ),
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
