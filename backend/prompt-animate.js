import { isCloudProfile } from "../shared/profiles.ts";
/**
 * The viewer's Animate menu: the prompt assistant writes an image-to-video motion prompt for the
 * frame a clip starts from and a theme, as the queue item's writing stage (prompt-stage.js) or for
 * Review Prompt (assistant-routes.js), through the same engine (assistant.js). The writer
 * always knows the frame: it sees it when the running text model reads images, and otherwise reads
 * the frame's gallery caption; the prompt that made the frame is guidance on top. It also gets the
 * video profile's prompting guide, the clip's length and frame rate, and whether the model makes
 * sound. Its themes are Library › Prompt Styles' Animate records; an uncensored theme, and
 * explicit wording in a Custom instruction, need Uncensored Models.
 *
 *   input.writing = { kind: "animate", theme, instruction?, source, extend? }
 *
 * `extend` marks a continuation from a video's last frame, whose `source` is that video's prompt.
 */
import { maxPromptCharacters } from "../shared/queue.ts";
import { AssistantError, cleanPrompt } from "./assistant.js";
import { userContent } from "./domain/model-content.ts";
import {
  americanEnglish,
  australianEnglish,
  contentRule,
  fidelity,
  filler,
  keepDescriptions,
  precedence,
  writerGuide,
} from "./domain/writing-standard.ts";
import { families } from "./family-catalogue.js";
import { promptInstruction } from "./prompt-instructions.js";
import { promptStyleStore } from "./prompt-styles.js";

/** An enabled Animate theme (Library › Prompt Styles) or Custom, by id; null otherwise. */
const animateTheme = (id) => promptStyleStore().style("animate", id);

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

/**
 * How the shot fills the clip: two beats for a short clip, three for a longer one, the most
 * interesting change landing early enough to be seen, and nothing that needs more time.
 */
function pacing(seconds, fps = 0) {
  const order =
    "in the present tense and in order, without timestamps unless the guide asks for them";
  if (!seconds)
    return promptInstruction("animate-short", {
      order,
    });
  const beats = seconds <= 6 ? 2 : 3;
  const each = Math.round((seconds / beats) * 10) / 10;
  return promptInstruction("animate-pacing", {
    seconds,
    frameRate: fps ? ` at ${fps} fps` : "",
    beats:
      beats === 2
        ? promptInstruction("two-motion-beats", { each, order })
        : promptInstruction("three-motion-beats", { each, order }),
    payoffTime: Math.round(seconds * 0.6),
  });
}

/** Whether the profile makes sound with the picture. */
function makesSound(profile) {
  const family = String(profile.family || "").replaceAll("-", "_");
  return family === "ltx2" || families[family]?.audio === true || isCloudProfile(profile);
}

/** How the writer knows the frame: it sees it, reads its description, or has only the prompt. */
const frameKnowledge = {
  seen: "animate-frame-seen",
  described: "animate-frame-described",
  unknown: "animate-frame-unknown",
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
  const theme = animateTheme(writing.theme);
  if (!theme) throw new AssistantError("Choose a known animation theme.", { status: 400 });
  const audio = makesSound(profile);
  const words = seconds ? Math.min(160, Math.max(60, Math.round(40 + 12 * seconds))) : 100;
  // About two and a half spoken words a second, leaving room for the action around them.
  const speech = Math.round(2.5 * (seconds || 6));
  return promptInstruction("animate", {
    model: profile.label || profile.id,
    precedence,
    keepDescriptions: keepDescriptions(),
    continuation: writing.extend
      ? promptInstruction("extend-existing-clip")
      : promptInstruction("start-animation"),
    frameContext: promptInstruction(frameKnowledge[known]),
    fidelity: fidelity(),
    americanEnglish,
    pacing: pacing(seconds, fps),
    lowFrameRate: fps && fps < 20 ? promptInstruction("low-frame-rate-motion", { fps }) : "",
    sound: audio
      ? promptInstruction("motion-with-sound", { speech })
      : promptInstruction("motion-without-sound"),
    filler: animateFiller.join(", "),
    sound2: audio ? " or hears" : "",
    words,
    theme: theme.instruction,
    contentRule: contentRule(explicit || Boolean(theme.uncensored)),
    guide: writerGuide(guide) || "(none; write a clear, specific natural-language prompt)",
  });
}

/** Room for a Custom instruction, and for Dream's, which brings its still's context and recent clips. */
const maxInstructionCharacters = 4000;

/** The request as admitted: a known theme, the instruction and the source image's prompt. */
export function animateRequest(value) {
  return {
    kind: "animate",
    theme: String(value?.theme || ""),
    instruction: String(value?.instruction || "")
      .trim()
      .slice(0, maxInstructionCharacters),
    source: String(value?.source || "")
      .trim()
      .slice(0, maxPromptCharacters),
    ...(value?.extend === true ? { extend: true } : {}),
  };
}

/** Why the request can't be written, as { status, error }, or null; `allowed(feature)` is the account's grant. */
export function animateIssue(writing, { allowed }) {
  const theme = animateTheme(writing.theme);
  if (!theme) return { status: 400, error: "Choose a known animation theme." };
  if (theme.custom && !writing.instruction)
    return { status: 400, error: "Describe what should happen." };
  if (theme.uncensored && !allowed("uncensoredModels"))
    return { status: 403, error: `${theme.label} needs Uncensored Models for this account.` };
  return null;
}

/** A named clip's reply: the prompt, then its closing Title and Why lines (name-clip). */
export function clipName(reply) {
  const match = /\n\s*Title:\s*(.+?)\s*\n\s*Why:\s*(.+?)\s*$/i.exec(String(reply || ""));
  if (!match) return { text: reply };
  return {
    text: reply.slice(0, match.index),
    title: match[1].slice(0, 80),
    why: match[2].slice(0, 200),
  };
}

/**
 * Writes the motion prompt for `profile` and a `clip` ({ seconds, fps }), streaming through
 * `onThinking` and `onDelta`. `frame()` loads the frame the clip starts from ({ mime, data },
 * downscaled) and is asked only when the text model reads images; otherwise `caption()` says what
 * it shows in words. `explicit`: the account holds Uncensored Models. `story`: the chat's story
 * (writing-standard.ts storyContext), if any. `taste`: what Prompt Writing receives of the account's
 * taste (domain/taste.ts `tasteLines`). `writer`: its prompt writer
 * (assistant.js `writerModel`). `named` also asks for the clip's title and why (Dream's cards).
 */
export async function writeAnimatePrompt({
  engine,
  profile,
  guide,
  writing,
  clip = {},
  explicit = false,
  story = "",
  taste = [],
  writer,
  frame = async () => null,
  caption = () => "",
  named = false,
  signal,
  onThinking,
  onDelta,
}) {
  const model = await engine.model("animate", false, writer);

  const image = (await engine.supportsVision(writer)) ? await frame() : null;
  const description = image ? "" : String((await caption()) || "").trim();
  const known = image ? "seen" : description ? "described" : "unknown";
  const system = animateInstructions({ profile, guide, writing, clip, known, explicit });
  const reply = await engine.chat({
    call: "animate",
    model,
    messages: [
      {
        role: "system",
        content: named
          ? `${system}\n${promptInstruction("name-clip", { australianEnglish })}`
          : system,
      },
      {
        role: "user",
        content: userContent(
          [
            `${writing.extend ? "The clip so far was made from" : "The first frame was made from"}: ${writing.source || "(no prompt recorded)"}`,
            description ? `What the frame shows: ${description}` : "",
            writing.instruction ? `Instruction: ${writing.instruction}` : "",
            story,
            ...taste,
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
  const { text, title, why } = named ? clipName(reply.text) : { text: reply.text };
  const prompt = cleanPrompt(text);
  if (!prompt) throw new AssistantError("unusable reply");
  return {
    prompt,
    thinking: reply.thinking,
    model,
    ...(title ? { title } : {}),
    ...(why ? { why } : {}),
  };
}
