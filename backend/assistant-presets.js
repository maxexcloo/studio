// SPDX-License-Identifier: AGPL-3.0-only
// The prompt assistant's rewrite presets, sorted by label as its menu lists them, with Custom last.
// Each is an instruction block added after the profile's guide; a guide may replace one with its own
// `presets.<id>` text. Each sets only the tone; the content rule (domain/writing-standard.ts)
// decides how explicit it may be, and Spicy is only for accounts with Uncensored Models.
import { flux3Upsampler } from "./prompt-upsamplers.js";

export const assistantPresets = Object.freeze([
  {
    id: "candid",
    label: "Candid",
    description: "Natural, unposed photography of real life.",
    instruction:
      "Candid: make it a natural, unposed photograph of real life. Everyday light that fits the place and time, real skin texture and small imperfections, believable lived-in surroundings, people absorbed in what they are doing rather than posing, and simple eye-level framing. Keep it a clear, well-exposed photograph: no blur, grain or accidental-shot effects, no phone-snapshot look unless asked, and no studio polish or glamour words.",
  },
  {
    id: "cinematic",
    label: "Cinematic",
    description: "A film still: framing, grade and mood.",
    instruction:
      "Cinematic: write it as a still from a film, a moment caught mid-story. Name the framing and camera angle, dramatic motivated light, the colour grade and the atmosphere, as a cinematographer would.",
  },
  {
    id: "concise",
    label: "Concise",
    description: "Short and direct, essentials only.",
    instruction:
      "Concise: tighten it to the essentials: the subject, the details that change the picture, the style and the framing. Drop filler and every repeated or generic quality word. Where the guide sets a minimum length or wants a long caption, keep to that minimum rather than going under it; otherwise write one short sentence (under 30 words) or, where the guide prefers tags, a few comma-separated tags.",
  },
  {
    id: "enhance",
    label: "Enhance",
    description: "Richer detail in the guide’s own style.",
    instruction:
      "Enhance: keep the prompt’s own style and medium and make it clearly richer and more specific in the way the guide recommends: concrete subject detail, the setting, the light and its direction, composition and camera, without changing what is asked for.",
  },
  {
    id: "illustration",
    label: "Illustration",
    description: "Artwork in one specific medium and style.",
    instruction:
      "Illustration: make it artwork, not a photograph. Use the medium the prompt names, or choose one that suits the subject (such as watercolour, ink, gouache, flat vector, cel-shaded animation or oil paint), and describe its linework, palette, texture and composition. No camera, lens or photographic words.",
  },
  {
    id: "photographic",
    label: "Photographic",
    description: "A polished photograph: lens, light and composition.",
    instruction:
      "Photographic: make it a polished, professional photograph of whatever the subject is. Name the kind of shot and a plausible camera and lens (such as a wide-angle landscape, a macro close-up or a 50mm street scene), deliberate light and its direction, a considered composition and crisp, true-to-life materials and textures. No painterly, illustrated or film-still words.",
  },
  {
    id: "portrait",
    label: "Portrait",
    description: "A person in focus: face, expression and light.",
    instruction:
      "Portrait: make the person the clear focus of a portrait photograph. Describe the face, expression, hair and clothing specifically, the pose and where they look, flattering light and its direction, a portrait lens with shallow depth of field and a simple background that suits them. Keep real skin texture.",
  },
  {
    id: "spicy",
    label: "Spicy",
    description: "Sensual and explicit, for uncensored models.",
    spicy: true,
    instruction:
      "Spicy: make the scene sensual and explicit, building on the request’s own subjects and setting.",
  },
  {
    id: "custom",
    label: "Custom",
    description: "Your own instruction.",
    custom: true,
    instruction:
      "Custom: apply the person’s instruction below in full. Where it changes a subject, detail or style, it overrides keeping them; keep everything else as asked.",
  },
]);

export const defaultPreset = "enhance";

// A Custom instruction's length limit.
export const maxInstructionCharacters = 500;

export function assistantPreset(id) {
  return assistantPresets.find((preset) => preset.id === id) || null;
}

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
