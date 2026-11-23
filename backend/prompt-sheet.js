/**
 * Make Sheet: the prompt assistant writes the prompt that redraws a character's image as a
 * character design sheet, as the queue item's writing stage (prompt-stage.js), for an image model
 * that edits with the image (backend/character-sheets.js). The layout is fixed, so Studio can cut
 * the sheet into its panels by the empty space between them; the writer fills in what the
 * character looks like and which expressions suit it, with nothing carried from the image's scene.
 *
 *   input.writing = { kind: "sheet", name, description }
 */
import { maxCardDescription, maxCardName } from "../shared/characters.ts";
import { AssistantError, cleanPrompt } from "./assistant.js";
import { userContent } from "./domain/model-content.ts";
import { americanEnglish, contentRule } from "./domain/writing-standard.ts";
import { promptInstruction } from "./prompt-instructions.js";

/** The request as admitted: the card's name and description. */
export const sheetRequest = (value) => ({
  kind: "sheet",
  name: String(value?.name || "")
    .trim()
    .slice(0, maxCardName),
  description: String(value?.description || "")
    .trim()
    .slice(0, maxCardDescription),
});

/** The writer's instructions: the sheet's fixed layout, then what it fills in. */
const sheetInstructions = (known) =>
  promptInstruction("character-sheet", {
    referenceContext:
      known === "seen"
        ? promptInstruction("sheet-from-image")
        : promptInstruction("sheet-from-caption"),
    americanEnglish,
    contentRule: contentRule(false),
  });

/**
 * Writes the sheet prompt for the character in `writing` (sheetRequest), streaming through
 * `onThinking` and `onDelta`. `frame()` loads its image ({ mime, data }), asked only when the text
 * model reads images; otherwise `caption()` says what it shows in words. `writer`: the account's
 * prompt writer (assistant.js `writerModel`).
 */
export async function writeSheetPrompt({
  engine,
  writing,
  writer,
  frame = async () => null,
  caption = () => "",
  signal,
  onThinking,
  onDelta,
}) {
  const model = await engine.model("sheet", false, writer);
  const image = (await engine.supportsVision(writer)) ? await frame() : null;
  const shown = image ? "" : String((await caption()) || "").trim();
  const reply = await engine.chat({
    call: "sheet",
    model,
    messages: [
      {
        role: "system",
        content: sheetInstructions(image ? "seen" : "described"),
      },
      {
        role: "user",
        content: userContent(
          [
            `Character: ${writing.name || "(unnamed)"}`,
            writing.description ? `Description: ${writing.description}` : "",
            shown ? `What the reference image shows: ${shown}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          image ? [image] : [],
          Boolean(image),
        ),
      },
    ],
    temperature: 0.7,
    // Reasoning models spend part of this on thinking before the prompt.
    maxTokens: 4000,
    signal,
    onThinking,
    onDelta,
  });
  const prompt = cleanPrompt(reply.text);
  if (!prompt) throw new AssistantError("unusable reply");
  return { prompt, thinking: reply.thinking, model };
}
