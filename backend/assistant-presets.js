// The built-in styles that seed Library › Prompt Styles (prompt-styles.js) in a data folder that has
// none: Improve Prompt's rewrite styles, Animate's themes (prompt-animate.js), then the viewer's
// fixed AI changes, each asked for as a suggestion's request is. An Improve
// Prompt style is an instruction block added after the profile's guide; a guide may replace one
// with its own `presets.<id>` text. Each sets only the tone; the content rule
// (domain/writing-standard.ts) decides how explicit it may be, and an `uncensored` style is only
// for accounts with Uncensored Models.
import { flux3Upsampler } from "./prompt-upsamplers.js";

export const seedStyles = Object.freeze([
  {
    id: "candid",
    kind: "improve",
    enabled: true,
    label: "Candid",
    description: "Natural, unposed photography of real life.",
    instruction:
      "Candid: make it a natural, unposed photograph of real life. Everyday light that fits the place and time, real skin texture and small imperfections, believable lived-in surroundings, people absorbed in what they are doing rather than posing, and simple eye-level framing. Keep it a clear, well-exposed photograph: no blur, grain or accidental-shot effects, no phone-snapshot look unless asked, and no studio polish or glamour words.",
  },
  {
    id: "cinematic",
    kind: "improve",
    enabled: true,
    label: "Cinematic",
    description: "A film still: framing, grade and mood.",
    instruction:
      "Cinematic: write it as a still from a film, a moment caught mid-story. Name the framing and camera angle, dramatic motivated light, the colour grade and the atmosphere, as a cinematographer would.",
  },
  {
    id: "concise",
    kind: "improve",
    enabled: true,
    label: "Concise",
    description: "Short and direct, essentials only.",
    instruction:
      "Concise: tighten it to the essentials: the subject, the details that change the picture, the style and the framing. Drop filler and every repeated or generic quality word. Where the guide sets a minimum length or wants a long caption, keep to that minimum rather than going under it; otherwise write one short sentence (under 30 words) or, where the guide prefers tags, a few comma-separated tags.",
  },
  {
    id: "enhance",
    kind: "improve",
    enabled: true,
    label: "Enhance",
    description: "Richer detail in the guide's own style.",
    instruction:
      "Enhance: keep the prompt's own style and medium and make it clearly richer and more specific in the way the guide recommends: concrete subject detail, the setting, the light and its direction, composition and camera, without changing what is asked for.",
  },
  {
    id: "fix",
    kind: "improve",
    enabled: true,
    label: "Fix Issues",
    description: "Prevents glitches: anatomy, text and muddled scenes.",
    instruction:
      "Fix Issues: rewrite it so the model makes it cleanly, without changing what is asked for. Resolve contradictions and vague or overloaded phrases, give every person and object one clear place and count, describe hands, faces and bodies plainly and naturally, keep any rendered text short and quoted, and drop crowded details that compete for the same space. Keep the subject, style and framing.",
  },
  {
    id: "guide",
    kind: "improve",
    enabled: true,
    label: "Follow Guide",
    description: "Rewritten to the model's prompting guide.",
    instruction:
      "Follow Guide: rewrite it strictly in the format, order, length and wording the prompting guide sets for this model, keeping every subject, detail and style the prompt asks for and adding nothing new.",
  },
  {
    id: "illustration",
    kind: "improve",
    enabled: true,
    label: "Illustration",
    description: "Artwork in one specific medium and style.",
    instruction:
      "Illustration: make it artwork, not a photograph. Use the medium the prompt names, or choose one that suits the subject (such as watercolour, ink, gouache, flat vector, cel-shaded animation or oil paint), and describe its linework, palette, texture and composition. No camera, lens or photographic words.",
  },
  {
    id: "photographic",
    kind: "improve",
    enabled: true,
    label: "Photographic",
    description: "A polished photograph: lens, light and composition.",
    instruction:
      "Photographic: make it a polished, professional photograph of whatever the subject is. Name the kind of shot and a plausible camera and lens (such as a wide-angle landscape, a macro close-up or a 50mm street scene), deliberate light and its direction, a considered composition and crisp, true-to-life materials and textures. No painterly, illustrated or film-still words.",
  },
  {
    id: "portrait",
    kind: "improve",
    enabled: true,
    label: "Portrait",
    description: "A person in focus: face, expression and light.",
    instruction:
      "Portrait: make the person the clear focus of a portrait photograph. Describe the face, expression, hair and clothing specifically, the pose and where they look, flattering light and its direction, a portrait lens with shallow depth of field and a simple background that suits them. Keep real skin texture.",
  },
  {
    id: "spicy",
    kind: "improve",
    enabled: true,
    label: "Spicy",
    description: "Sensual and explicit, for uncensored models.",
    uncensored: true,
    instruction:
      "Spicy: make the scene sensual and explicit, building on the request's own subjects and setting.",
  },
  {
    id: "action",
    kind: "animate",
    enabled: true,
    label: "Action",
    description: "One energetic physical action, with the camera following it.",
    instruction:
      "Action: the subject does one clear, physical, energetic action that this frame sets up, from their pose, the props and the place (spinning, leaping, running, throwing, striking, dancing), with a quick wind-up, a peak that lands by the middle of the clip and a follow-through, the kind of thing this person would do here. Momentum shows in the body and its secondary motion (hair whipping, fabric snapping, splashes, sparks, dust or debris), and the camera moves with it: tracking alongside, whip-panning, a handheld follow or a fast push-in on the impact, at a pace that keeps the motion readable.",
  },
  {
    id: "cinematic",
    kind: "animate",
    enabled: true,
    label: "Cinematic Camera",
    description: "A camera move the subject's action motivates.",
    instruction:
      "Cinematic Camera: a camera move the subject's action motivates carries the shot. The subject does something (turns to look, steps forward, rises, reaches, reacts to someone) and the camera answers it: tracking alongside a walk, arcing around a turn, craning up as they rise, pushing in on a reaction, pulling out to reveal where they are. The move has a speed that matches the action (medium speed while the subject moves, slow only for a held emotional beat) starts with the action and lands on a different framing than it began. The world moves around them: parallax between foreground and background, passers-by, weather and light.",
  },
  {
    id: "dialogue",
    kind: "animate",
    enabled: true,
    label: "Dialogue",
    description: "The people in the frame talk, with lips in sync.",
    instruction:
      "Dialogue: the people in the frame talk. Give one or two short spoken lines, or a quick exchange between two people in the frame, that fit who they are, where they are and what they are doing, each with who says it and how. Speech comes with the body language of talking: lips in sync, a nod, a shrug, a hand lifting to make a point, eyes meeting, and the listener reacting. The camera covers the conversation: a push-in on the speaker, a handheld over-the-shoulder reframe, or a small arc from one speaker to the other. The first line starts within the first couple of seconds, and the clip ends on a reaction: the listener's answer, a laugh or a look. Where no one in the frame can speak, a short voiceover that fits the scene speaks instead.",
  },
  {
    id: "living",
    kind: "animate",
    enabled: true,
    label: "Living Photo",
    description: "The moment keeps rolling like a candid video.",
    instruction:
      "Living Photo: the moment keeps rolling as if the photo were a candid video. Each person carries on with what they are doing in real time, with natural, unposed movement that goes somewhere (a laugh that breaks into a glance away, a sip, brushing hair back, turning to someone, a few steps), and the surroundings keep moving: passers-by, traffic, wind, water, steam, flickering light. Something small but clearly visible changes early (a laugh breaking, a turn, a sip) and the moment settles into a new beat by the end. The camera is handheld with a light natural sway or makes a small reframe as someone moves. No big action or new events.",
  },
  {
    id: "spicy",
    kind: "animate",
    enabled: true,
    label: "Spicy",
    description: "Slow, sensual and explicit, for uncensored models.",
    uncensored: true,
    instruction:
      "Spicy: slow, sensual, explicit motion built from the people, pose and setting already in the frame, with touch and movement whose intensity builds across the beats, natural breathing and shifting weight, and a camera that moves in close or arcs around them.",
  },
  {
    id: "closer",
    kind: "change",
    enabled: true,
    label: "Closer Crop",
    description: "Frame the subject tighter.",
    instruction:
      "Closer Crop: frame the main subject much closer, filling more of the picture, and drop the surroundings the tighter framing leaves out.",
  },
  {
    id: "wider",
    kind: "change",
    enabled: true,
    label: "Wider Shot",
    description: "Pull back to show more of the scene.",
    instruction:
      "Wider Shot: pull back to a wider shot that shows the whole subject and more of the place around them, adding the surroundings it would plausibly reveal.",
  },
  {
    id: "warmer",
    kind: "change",
    enabled: true,
    label: "Warmer Light",
    description: "Golden, warm-toned light.",
    instruction:
      "Warmer Light: change the light to warm, golden tones, as in late afternoon sun or lamplight, with warmer colours and softer shadows.",
  },
  {
    id: "cooler",
    kind: "change",
    enabled: true,
    label: "Cooler Light",
    description: "Cool, blue-toned light.",
    instruction:
      "Cooler Light: change the light to cool, blue tones, as in overcast daylight or early morning, with cooler colours and crisper shadows.",
  },
  {
    id: "night",
    kind: "change",
    enabled: true,
    label: "Night Version",
    description: "The same scene at night.",
    instruction:
      "Night Version: make it the same scene at night, lit by the moon and the light sources that would be there, such as street lamps, windows or a fire.",
  },
  {
    id: "detail",
    kind: "change",
    enabled: true,
    label: "Add Detail",
    description: "Richer textures and small details.",
    instruction:
      "Add Detail: add rich, specific detail to the subject, materials and surroundings, such as textures, small objects and fine surface wear, without changing what the picture shows.",
  },
  {
    id: "simple-background",
    kind: "change",
    enabled: true,
    label: "Simplify Background",
    description: "A plain, uncluttered background.",
    instruction:
      "Simplify Background: replace the background with a plain, uncluttered one in colours that suit the subject, keeping the subject and its light unchanged.",
  },
]);

/** Custom… is built in rather than a record, by kind: it frames the person's own instruction. */
export const customStyles = Object.freeze({
  improve: {
    id: "custom",
    kind: "improve",
    label: "Custom",
    description: "Your own instruction.",
    custom: true,
    enabled: true,
    instruction:
      "Custom: apply the person's instruction below in full. Where it changes a subject, detail or style, it overrides keeping them; keep everything else as asked.",
  },
  animate: {
    id: "custom",
    kind: "animate",
    label: "Custom",
    description: "Your own instruction.",
    custom: true,
    enabled: true,
    instruction:
      "Custom: the person's instruction decides what happens. Make it happen with what is in the frame, and build the beats, camera and any sound around it without changing it. Bring in only what the instruction names, entering naturally (from out of frame, through a door) rather than appearing from nowhere.",
  },
});

export const defaultPreset = "enhance";

// A Custom instruction's length limit.
export const maxInstructionCharacters = 500;

/**
 * Words about speed, quality tier, model, size, aspect or count: settings, not scene. The rewrite
 * instructions name them and the eval scorer checks no rewrite adds them.
 */
export const settingWords = Object.freeze([
  "turbo",
  "super fast",
  "draft mode",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "2k",
  "4k",
  "megapixel",
  "two images",
  "three images",
  "aspect ratio",
]);

/**
 * Families meant to run behind a maker's prompt upsampler: Enhance uses the maker's system prompt
 * verbatim (prompt-upsamplers.js), so the caption matches what the model was trained on.
 */
const upsamplers = { flux3: flux3Upsampler, flux3_klein: flux3Upsampler };
const familyKey = (family) => String(family || "").replace(/-/g, "_");

export function familyUpsampler(profile) {
  return upsamplers[familyKey(profile?.family)] || null;
}
