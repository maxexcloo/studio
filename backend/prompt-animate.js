// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The viewer's Animate menu: the prompt assistant writes an image-to-video motion prompt for the
 * frame a clip starts from and a theme, as the queue item's writing stage (prompt-stage.js) or for
 * Review Prompt First (assistant-routes.js), through the same engine (assistant.js). The writer
 * always knows the frame: it sees it when the running text model reads images, and otherwise reads
 * the frame's gallery caption; the prompt that made the frame is guidance on top. It also gets the
 * video profile's prompting guide, the clip's length and frame rate, and whether the model makes
 * sound. Spicy, and explicit wording in a Custom instruction, need Uncensored Models.
 *
 *   input.writing = { kind: "animate", theme, instruction?, source, extend? }
 *
 * `extend` marks a continuation from a video's last frame, whose `source` is that video's prompt.
 */
import { maxPromptCharacters } from "../shared/queue.ts";
import { AssistantError, cleanPrompt } from "./assistant.js";
import { userContent } from "./domain/model-content.ts";
import {
  contentRule,
  fidelity,
  filler,
  precedence,
  writerGuide,
} from "./domain/writing-standard.ts";
import { isCloudProfile } from "./cloud-profiles.js";
import { families } from "./family-catalog.js";

export const animateThemes = Object.freeze({
  cinematic:
    "Cinematic Camera: the camera move carries the shot. Choose the one move this composition invites and give its speed and where the framing ends: a slow push-in or zoom from a wide shot to the face, a lateral dolly or pan that reveals what lies beside the subject, a tilt up a tall subject, an orbit around a subject with space around them, a crane up over a landscape. The subject moves with restraint (a turn of the head, a glance, a breath, a step) while the world moves around them: drifting haze, shifting light, parallax between foreground and background. The frame's own mood deepens as the move lands.",
  living:
    "Living Photo: the camera stays still, locked off or at most an imperceptible drift. The frame comes alive in small, continuous, natural motion that fits what is in it: breathing, blinking, a shift of weight, a faint change of expression, hair and fabric lifting in a breeze, steam, rippling water, swaying leaves, flickering light, dust in the air. No big action, no new events and no cuts; it ends close to how it began, so it loops.",
  action:
    "Action: the subject does one clear, physical, energetic action that this frame sets up, from their pose, the props and the place (spinning, leaping, running, throwing, striking, dancing), with a wind-up, a peak and a follow-through. Momentum shows in the body and its secondary motion (hair whipping, fabric snapping, splashes, sparks, dust or debris), and the camera moves with it: tracking alongside, whip-panning, a handheld follow or a fast push-in on the impact, at a pace that keeps the motion readable.",
  spicy:
    "Spicy: slow, sensual, explicit motion built from the people, pose and setting already in the frame, with touch and movement whose intensity builds across the beats.",
  custom:
    "Custom: the person's instruction decides what happens. Make it happen with what is in the frame, and build the beats, camera and any sound around it without changing it. Bring in only what the instruction names, entering naturally (from out of frame, through a door) rather than appearing from nowhere.",
});

// Phrases that tell a video model nothing; the writer is told to leave them out. Not "cinematic",
// which MiniMax H3's own guide uses.
export const animateFiller = [...filler, "smooth", "dynamic"];

/**
 * The clip's length in seconds and frame rate from the run's input over the profile's defaults,
 * read from the control the profile runs on (as videoLength sets it); 0 when unknown.
 */
export function animateClip(input, profile) {
  const value = (key) => Number(input?.[key]) || Number(profile?.defaults?.[key]) || 0;
  const frames = value("frames");
  const fps = value("fps");
  const seconds =
    profile?.capabilities?.duration !== true && frames && fps
      ? Math.round((frames / fps) * 10) / 10
      : value("duration");
  return { seconds, fps };
}

/** Whether the profile makes sound with the picture: an audio family (H3) or Grok. */
const makesSound = (profile) =>
  families[String(profile.family || "").replaceAll("-", "_")]?.audio === true ||
  isCloudProfile(profile);

/** How the writer knows the frame: it sees it, reads its description, or has only the prompt. */
const frameKnowledge = {
  seen: "You can see that frame. Read it before writing: who and what is in it and exactly where; the shot size, angle and where the open space is; the light, weather and mood; and what is already in motion or about to be (a raised foot, wind in the hair, a tilted cup). Ground every movement in what is visible there.",
  described:
    "You can't see that frame, but its description below says what it shows. Ground every movement in that description.",
  unknown:
    "You can't see that frame: keep to what the prompt below states and move only what it establishes.",
};

/**
 * The writer's instructions. The guide comes first, including its format: a wrapped profile takes
 * only the description body, one without a wrapper every section its mode lists. `known`: how the
 * writer knows the frame (frameKnowledge); `explicit`: the account holds Uncensored Models.
 */
export function animateInstructions({
  profile,
  guide,
  writing,
  clip = {},
  known = "unknown",
  explicit = false,
}) {
  const { seconds = 0, fps = 0 } = clip;
  const audio = makesSound(profile);
  const beats = !seconds ? "two to four" : seconds <= 4 ? "two" : seconds <= 8 ? "three" : "four";
  const words = seconds ? Math.min(160, Math.max(60, Math.round(40 + 12 * seconds))) : 100;
  const length = [seconds && `${seconds}-second`, fps && `${fps} fps`].filter(Boolean).join(", ");
  return [
    `You write motion prompts for the image-to-video model ${profile.label || profile.id}. Follow its prompting guide below.`,
    precedence,
    "Format: write exactly what the guide's mode asks this profile to receive, matching its example. When the profile adds section labels itself, write only the description body, with no labels, and put any dialogue and sound inside it. When the guide asks for complete sections, write every section it lists for a run with an attached image, labelled and in order, separated by blank lines. Otherwise write one flowing paragraph.",
    writing.extend
      ? "This continues an existing clip: its last frame is the attached image the new clip starts from, and the clip so far was made from the prompt below. Don't replay its action: escalate it or turn it, with a new development, a reaction, a reveal or a consequence of what just happened, and carry on the camera's motion from where it ended."
      : "The attached image is the first frame, made from the prompt below; the model already sees it. Don't re-describe it: open with one short sentence anchoring the frame only where the guide asks for it (such as MiniMax H3's keyframe shot or Grok's opening composition), and otherwise spend the words on what changes.",
    frameKnowledge[known],
    `The prompt is guidance on the intent, subjects and mood; where it and the frame disagree, the frame wins.${writing.extend ? "" : " Animate what that prompt was going for, not just what happens to be in view."}`,
    fidelity,
    "Never contradict the frame. Keep each subject's identity, face, body, outfit, setting and style as they are unless the theme or instruction changes them.",
    `In the present tense, play the shot out as ${beats} beats that fill the ${length ? `${length} clip` : "clip"}: the onset, how it develops, and the result or reaction the last frame lands on. Pace the beats to the time; don't cram in more action than the clip can show, and don't leave it static.`,
    fps && fps < 20
      ? `At ${fps} fps fast motion judders: favour fluid, moderate-speed movement and steady camera moves.`
      : "",
    "Keep it clean and consistent: one through-line of action that the frame sets up, each beat following from the last, not a list of unrelated motions. Keep it alive: pick what is particular to this frame (its subject, props, weather, light) and make that move, rather than a stock gesture any image would get.",
    "Make every beat concrete and physical: what the hands, eyes, head and body do; how hair, fabric, water, smoke, dust and light respond; how the subject touches or disturbs the things and people around them.",
    "Choose the camera for this composition and the theme, and give it one deliberate, continuous path, or keep it still where the theme says so: name the move (push-in, zoom, pull-out, pan, tilt, orbit, tracking, crane, handheld or static), its speed and how the framing changes by the end. A deep wide frame suits a push-in or a slow pan across it, a close portrait a gentle push-in or a held shot, a tall subject a tilt, a subject with space around them an orbit, fast action a tracking or handheld follow. Don't default to the same slow push-in for every frame.",
    // A Living Photo loops, so it ends as it began.
    writing.theme === "living"
      ? ""
      : "Let the light or mood shift with the action (a cloud passes, a neon sign flickers on, a door spills light), not stay fixed.",
    audio
      ? "This model makes sound with the picture. Give each beat the sound it makes (footsteps, rustling fabric, a glass set down) over the scene's ambience. Where a person in the frame is in a moment that invites speech (facing someone or the camera, mid-conversation, reacting), add one short line of dialogue with who says it and how, their lips moving with it, in the guide's dialogue format (in double quotes when it sets none); give no line to someone asleep, kissing, eating, far off or turned away, and none where there is no one. Add music only when the scene has a source for it or the theme calls for it."
      : "This model makes no sound: describe only what is seen, with no dialogue, sound or music.",
    `Leave out filler that shows nothing (${animateFiller.join(", ")}, stacked adjectives): name the specific movement, speed and camera path instead, so every phrase is something the viewer sees${audio ? " or hears" : ""}.`,
    `Unless the guide sets a length, write about ${words} words.`,
    "Reply with the prompt only, as plain text: no preamble, Markdown or notes, and no quotation marks around the whole prompt.",
    `Theme: ${animateThemes[writing.theme]}`,
    // Spicy is admitted only with Uncensored Models (animateIssue).
    contentRule(explicit || writing.theme === "spicy"),
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
 * Writes the motion prompt for `profile` and a `clip` ({ seconds, fps }), streaming through
 * `onThinking` and `onDelta`. `frame()` loads the frame the clip starts from ({ mime, data },
 * downscaled) and is asked only when the text model reads images; otherwise `caption()` says what
 * it shows in words. `explicit`: the account holds Uncensored Models.
 */
export async function writeAnimatePrompt({
  engine,
  profile,
  guide,
  writing,
  clip = {},
  explicit = false,
  frame = async () => null,
  caption = () => "",
  signal,
  onThinking,
  onDelta,
}) {
  const model = await engine.model("animate");
  const image = (await engine.supportsVision()) ? await frame() : null;
  const description = image ? "" : String((await caption()) || "").trim();
  const known = image ? "seen" : description ? "described" : "unknown";
  const reply = await engine.chat({
    call: "animate",
    model,
    messages: [
      {
        role: "system",
        content: animateInstructions({ profile, guide, writing, clip, known, explicit }),
      },
      {
        role: "user",
        content: userContent(
          [
            `${writing.extend ? "The clip so far was made from" : "The first frame was made from"}: ${writing.source || "(no prompt recorded)"}`,
            description ? `What the frame shows: ${description}` : "",
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
