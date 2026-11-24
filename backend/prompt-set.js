// The queue's writing stage writes a variation of the selected image or set source.
import { maxPromptCharacters } from "../shared/queue.ts";
import { replyTitle, titleRule } from "../shared/titles.ts";
import { AssistantError, cleanPrompt } from "./assistant.js";
import { userContent } from "./domain/model-content.ts";
import {
  americanEnglish,
  australianEnglish,
  keepDescriptions,
  precedence,
  standalonePrompt,
  writerGuide,
} from "./domain/writing-standard.ts";
import { promptInstruction } from "./prompt-instructions.js";

// The newest prompts show whole; older ones show their opening, enough to steer away from.
const shownPrompts = 12;
const olderPromptCharacters = 120;

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
  intent,
  prompts,
  story = "",
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
        content: promptInstruction("vary-set", {
          australianEnglish,
          sourceContext:
            scope === "image"
              ? promptInstruction("vary-selected-image", { model: profile.label || profile.id })
              : promptInstruction("vary-result-set", { model: profile.label || profile.id, title }),
          sourceSubject:
            scope === "image" && (image || shown)
              ? promptInstruction("keep-image-subject")
              : promptInstruction("keep-prompt-subject"),
          typedIntent:
            scope === "image" && intent ? promptInstruction("typed-variation-intent") : "",
          precedence,
          keepDescriptions: keepDescriptions(),
          standalonePrompt: standalonePrompt(),
          americanEnglish,
          guide: writerGuide(guide) || "(none; write a clear, specific natural-language prompt)",
          titleRule,
        }),
      },
      {
        role: "user",
        content: userContent(
          [
            `Source prompt (authoritative subject and theme):\n${source}`,
            shown ? `What the selected image shows: ${shown}` : "",
            intent ? `Typed source prompt (user intent): ${intent}` : "",
            story,
            `Previous variations (avoid repetition, not subject guidance):\n${prompts
              .map((prompt, index) =>
                prompt
                  .replace(/\s+/g, " ")
                  .slice(0, index < prompts.length - shownPrompts ? olderPromptCharacters : 1000),
              )
              .map((prompt) => `- ${prompt}`)
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
