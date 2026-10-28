// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The viewer's Animate menu: the prompt assistant writes an image-to-video motion prompt from the
 * source image's prompt and a theme, as the queue item's writing stage (prompt-stage.js), through
 * the same engine (assistant.js) as assistant-routes.js. Spicy needs Uncensored Models.
 *
 *   input.writing = { kind: "animate", theme, instruction?, source }
 */
import { AssistantError, cleanPrompt, maxPromptCharacters, writerGuide } from "./assistant.js";

export const animateThemes = Object.freeze({
  cinematic:
    "Cinematic Camera: a deliberate, motivated camera move (push-in, orbit, crane or tracking shot) with subtle subject motion and atmosphere.",
  living:
    "Living Photo: the camera stays still; bring the frame gently to life with small natural motion such as breathing, blinking, hair, fabric, water, leaves, light and particles.",
  action:
    "Action: the subject performs one clear, energetic action that suits the scene, with dynamic but readable motion and a camera that follows it.",
  spicy:
    "Spicy: sensual, explicit motion where the scene allows it, with frank, specific wording about bodies and movement. Every person is an adult.",
  custom: "Follow the person's instruction for what should happen.",
});

/** The request as admitted: a known theme, the instruction and the source image's prompt. */
export function animateRequest(value) {
  return {
    kind: "animate",
    theme: String(value?.theme || ""),
    instruction: String(value?.instruction || "")
      .trim()
      .slice(0, 1000),
    source: String(value?.source || "")
      .trim()
      .slice(0, maxPromptCharacters),
  };
}

/** Why the request can't be written, as { status, error }, or null; `allowed(feature)` is the account's grant. */
export function animateIssue(writing, { allowed }) {
  if (!Object.hasOwn(animateThemes, writing.theme))
    return { status: 400, error: "Choose a known animation theme." };
  if (writing.theme === "custom" && !writing.instruction)
    return { status: 400, error: "Describe what should happen." };
  if (writing.theme === "spicy" && !allowed("uncensoredModels"))
    return { status: 403, error: "Spicy needs Uncensored Models for this account." };
  return null;
}

/** Writes the motion prompt for `profile`, streaming through `onThinking` and `onDelta`. */
export async function writeAnimatePrompt({
  engine,
  profile,
  guide,
  writing,
  signal,
  onThinking,
  onDelta,
}) {
  const { model } = engine.settings();
  const reply = await engine.chat({
    model,
    messages: [
      {
        role: "system",
        content: [
          `You write motion prompts for the image-to-video model ${profile.label || profile.id}. Follow its prompting guide below.`,
          "The image is the first frame. Describe the motion, action and camera from that frame in one short paragraph (under 80 words), without re-describing what is already visible.",
          "Reply with the prompt only, as plain text: no preamble, labels, quotes, Markdown or notes.",
          `Theme: ${animateThemes[writing.theme]}`,
          `Prompting guide: ${writerGuide(guide) || "(none; write a clear, specific natural-language prompt)"}`,
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `The first frame was generated from: ${writing.source || "(no prompt recorded)"}`,
          writing.instruction ? `Instruction: ${writing.instruction}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    temperature: 0.8,
    // Reasoning models spend part of this on thinking before the prompt.
    maxTokens: 1500,
    signal,
    onThinking,
    onDelta,
  });
  const prompt = cleanPrompt(reply.text);
  if (!prompt) throw new AssistantError("unusable reply");
  return { prompt, thinking: reply.thinking, model };
}
