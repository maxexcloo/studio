// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The viewer's Animate menu: the prompt assistant writes an image-to-video motion prompt from the
 * source image's prompt and a theme, as the queue item's writing stage (prompt-stage.js) or for
 * Review Prompt First (assistant-routes.js), through the same engine (assistant.js). When the
 * running text model reads images it also sees the frame the clip starts from, so the motion stays
 * consistent with what is visible. Spicy needs Uncensored Models.
 *
 *   input.writing = { kind: "animate", theme, instruction?, source, extend? }
 *
 * `extend` marks a continuation from a video's last frame, whose `source` is that video's prompt.
 */
import { maxPromptCharacters } from "../shared/queue.ts";
import { AssistantError, cleanPrompt, writerGuide } from "./assistant.js";
import { userContent } from "./domain/model-content.ts";
import { isCloudProfile } from "./cloud-profiles.js";
import { families } from "./family-catalog.js";

export const animateThemes = Object.freeze({
  cinematic:
    "Cinematic Camera: one motivated, named camera move carries the shot (a slow push-in, an orbit, a crane up, a dolly or a tracking shot), with its speed and how the framing ends, such as from a wide shot to a close-up on the face. The subject moves with restraint (a turn of the head, a glance, a breath, a step) while the world moves around them: drifting haze, shifting light, parallax between foreground and background.",
  living:
    "Living Photo: a locked-off camera that never moves. The frame comes alive in small, continuous, natural motion: breathing, blinking, a shift of weight, hair and fabric lifting in a breeze, steam, rippling water, swaying leaves, flickering light, dust in the air. No big action and no cuts; it ends close to how it began, so it loops.",
  action:
    "Action: the subject does one clear, physical, energetic action the scene invites (spinning, leaping, running, throwing, striking, dancing), with a wind-up, a peak and a follow-through. Momentum shows in the body and its secondary motion (hair whipping, fabric snapping, splashes, sparks, dust or debris) and the camera follows it, tracking, whip-panning or handheld, at a pace that keeps the motion readable.",
  spicy:
    "Spicy: slow, sensual, explicit motion where the scene allows it, with frank, specific wording about bodies, touch and movement and intensity that builds across the beats. Every person is an adult.",
  custom:
    "Custom: the person's instruction decides what happens; build the beats, camera and any sound around it without changing it.",
});

// Phrases that tell a video model nothing; the writer is told to leave them out.
export const animateFiller = [
  "cinematic",
  "smooth",
  "dynamic",
  "epic",
  "high quality",
  "masterpiece",
  "4K",
];

/**
 * The clip's length in seconds from the run's input over the profile's defaults, read from the
 * control the profile runs on (as videoLength sets it); 0 when unknown.
 */
export function clipSeconds(input, profile) {
  const value = (key) => Number(input?.[key]) || Number(profile?.defaults?.[key]) || 0;
  const frames = value("frames");
  const fps = value("fps");
  if (profile?.capabilities?.duration !== true && frames && fps)
    return Math.round((frames / fps) * 10) / 10;
  return value("duration");
}

/** Whether the profile makes sound with the picture: an audio family (H3) or Grok. */
const makesSound = (profile) =>
  families[String(profile.family || "").replaceAll("-", "_")]?.audio === true ||
  isCloudProfile(profile);

/**
 * The writer's instructions. The guide comes first, including its format: a wrapped profile takes
 * only the description body, one without a wrapper every section its mode lists. `seen`: the writer
 * is shown the frame too.
 */
export function animateInstructions({ profile, guide, writing, seconds = 0, seen = false }) {
  const audio = makesSound(profile);
  const beats = !seconds ? "two to four" : seconds <= 4 ? "two" : seconds <= 8 ? "three" : "four";
  const words = seconds ? Math.min(160, Math.max(60, Math.round(40 + 12 * seconds))) : 100;
  const clip = seconds ? `${seconds}-second clip` : "clip";
  return [
    `You write motion prompts for the image-to-video model ${profile.label || profile.id}. Its prompting guide below comes first: where it sets length, structure, format or wording, follow it over anything here.`,
    "Format: write exactly what the guide's mode asks this profile to receive, matching its example. When the profile adds section labels itself, write only the description body, with no labels, and put any dialogue and sound inside it. When the guide asks for complete sections, write every section it lists for a run with an attached image, labelled and in order, separated by blank lines. Otherwise write one flowing paragraph.",
    writing.extend
      ? "This continues an existing clip: its last frame is the attached image the new clip starts from, and the clip so far was made from the prompt below. Don't replay its action: escalate it or turn it, with a new development, a reaction, a reveal or a consequence of what just happened, and carry on the camera's motion from where it ended."
      : "The attached image is the first frame, made from the prompt below; the model already sees it. Don't re-describe it: spend the words on what changes.",
    "Keep the subject's identity, face, outfit, setting and style as they are unless the theme or instruction changes them.",
    seen
      ? "You can see that frame too: anchor the subject's identity, outfit, setting and composition in what is visible there, within the guide's format and length, so the motion stays consistent with it."
      : "",
    `In the present tense, play the shot out as ${beats} beats that fill the ${clip}: the onset, how it develops, and the result or reaction the last frame lands on. Pace the beats to the time; don't cram in more action than the clip can show, and don't leave it static.`,
    "Make every beat concrete and physical: what the hands, eyes, head and body do; how hair, fabric, liquid, smoke, dust and light respond; how the subject touches or disturbs the things and people around them.",
    "Give the camera one deliberate, continuous path, or keep it locked off where the theme says so: name the shot, its speed and how the framing changes by the end.",
    "Let the light or mood shift with the action (a cloud passes, a neon sign flickers on, a door spills light), not stay fixed.",
    audio
      ? "This model makes sound with the picture. Give each beat the sound it makes (footsteps, rustling fabric, a glass set down) over the scene's ambience and, where someone could plausibly speak, one short line of dialogue with who says it and how, in the guide's dialogue format (in double quotes when it sets none). Add music only when the scene has a source for it or the theme calls for it."
      : "This model makes no sound: describe only what is seen, with no dialogue, sound or music.",
    `Leave out filler that shows nothing (${animateFiller.join(", ")}, stacked adjectives): name the specific movement, speed and camera path instead, so every phrase is something the viewer sees${audio ? " or hears" : ""}.`,
    `Unless the guide sets a length, write about ${words} words.`,
    "Reply with the prompt only, as plain text: no preamble, Markdown or notes, and no quotation marks around the whole prompt.",
    `Theme: ${animateThemes[writing.theme]}`,
    `Prompting guide: ${writerGuide(guide) || "(none; write a clear, specific natural-language prompt)"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

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
    ...(value?.extend === true ? { extend: true } : {}),
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

/**
 * Writes the motion prompt for `profile` and a clip of `seconds`, streaming through `onThinking`
 * and `onDelta`. `frame()` loads the frame the clip starts from ({ mime, data }, downscaled) and is
 * asked only when the text model reads images.
 */
export async function writeAnimatePrompt({
  engine,
  profile,
  guide,
  writing,
  seconds = 0,
  frame = async () => null,
  signal,
  onThinking,
  onDelta,
}) {
  const model = await engine.model("animate");
  const image = (await engine.supportsVision()) ? await frame() : null;
  const reply = await engine.chat({
    call: "animate",
    model,
    messages: [
      {
        role: "system",
        content: animateInstructions({ profile, guide, writing, seconds, seen: Boolean(image) }),
      },
      {
        role: "user",
        content: userContent(
          [
            `${writing.extend ? "The clip so far was made from" : "The first frame was made from"}: ${writing.source || "(no prompt recorded)"}`,
            writing.instruction ? `Instruction: ${writing.instruction}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          image ? [image] : [],
          Boolean(image),
        ),
      },
    ],
    temperature: 0.8,
    // Reasoning models spend part of this on thinking before the prompt; H3's sections run long.
    maxTokens: 3000,
    signal,
    onThinking,
    onDelta,
  });
  const prompt = cleanPrompt(reply.text);
  if (!prompt) throw new AssistantError("unusable reply");
  return { prompt, thinking: reply.thinking, model };
}
