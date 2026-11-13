/**
 * Make Sheet: the prompt assistant writes the prompt that redraws a character's image as a
 * character design sheet, as the queue item's writing stage (prompt-stage.js), for an image model
 * that edits with the image (backend/character-sheets.js). The layout is fixed, so Studio can cut
 * the sheet into its panels by the empty space between them; the writer fills in what the
 * character looks like, which expressions suit it and the gear it carries, by name.
 *
 *   input.writing = { kind: "sheet", name, description }
 */
import { maxCardDescription, maxCardName } from "../shared/characters.ts";
import { AssistantError, cleanPrompt } from "./assistant.js";
import { userContent } from "./domain/model-content.ts";
import { contentRule } from "./domain/writing-standard.ts";

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
export const sheetInstructions = (known) =>
  [
    "You write one prompt for an image-editing model that receives it together with one reference image of a character, and redraws that character as a character design sheet: the reference for drawing and animating the same character later.",
    known === "seen"
      ? "You can see the reference image. Read it first: the character's face, hair, body, every garment and accessory, anything carried or worn as gear, any text on them, and the medium (photo, anime, 3D render, painting)."
      : "You can't see the reference image, but its description below says what it shows. Keep to what it and the character's description state.",
    "Write the prompt as numbered sections, each one paragraph: 1. canvas and style, 2. the face column, 3. the turnaround, 4. the gear (only when there is gear), then a last section that keeps the design. About 250 to 500 words in all.",
    "The layout is fixed; describe it exactly, because the sheet is cut into its panels along the empty space between them. A 3:2 landscape sheet on a plain, flat, light grey background, with wide empty gaps between every tile and panel and nothing crossing them: no frames, borders, divider lines, labels, captions, titles, numbers or watermark anywhere. Soft, even studio light throughout, in the reference's own medium in every tile.",
    "Face column: down the left fifth of the sheet, four head-and-shoulders close-ups facing the viewer, stacked one above the other at the same size and crop. The top one is a neutral expression (relaxed brows, eyes naturally open, mouth closed). The other three are distinct expressions that suit the character's personality, each with what the brows, eyes and mouth do (joy, anger and sorrow when nothing suggests others). A face without muscles (a mask, helmet, robot or creature without expressions) gets one close-up of the head only, as the reference shows it.",
    "Turnaround: across the rest of the sheet's top two thirds, three full-body figures side by side at the same scale, standing in the same relaxed pose with the arms a little away from the body and a gap between them: the front view on the left, a clean side view in profile in the middle, the back view on the right. Draw them from head to feet: where the image cuts the body off, complete it plainly, continuing what is visible with simple matching clothing and footwear and the build the description gives, and name those garments, but add no gear.",
    "Gear: when the character carries or wears gear (weapons, tools, bags, belts, jewellery, glasses, hats, gloves, armour pieces), a row of close-ups along the bottom third under the turnaround, one tile per item, up to six, each isolated on the background. Name every item by what it is, with its material, colour and wear, and quote any text on it exactly. Name gear in the turnaround's description too. Never add gear the image and description don't show, and leave the row out when there is none; the turnaround then takes the full height.",
    "Last section: keep the character's exact design in every tile: the same face, eyes, hair, skin, markings, body and proportions, the same garments and gear on the same sides, and the same medium. No other characters or objects, no redesign, no beautifying or change of age, no merged or overlapping views, and no text other than what is written on the character or gear.",
    contentRule(false),
    "Reply with the prompt only, as plain text: no preamble, Markdown or notes.",
  ].join("\n");

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
