// SPDX-License-Identifier: AGPL-3.0-only
// The prompt assistant's rewrite presets. Each is an instruction block added after the profile's
// guide; a guide may replace one with its own `presets.<id>` text. Spicy runs on the separate,
// uncensored model an administrator chooses, and only for accounts with Uncensored Models.
import { flux3Upsampler } from "./prompt-upsamplers.js";

export const assistantPresets = Object.freeze([
  {
    id: "enhance",
    label: "Enhance",
    description: "Richer detail in the guide’s own style.",
    instruction:
      "Enhance: make the prompt clearly richer and more specific in the way the guide recommends: concrete subject detail, the setting, the light and its direction, composition and camera, without changing what is asked for.",
  },
  {
    id: "spicy",
    label: "Spicy",
    description: "Sensual and explicit, for uncensored models.",
    spicy: true,
    instruction:
      "Spicy: make the scene sensual and explicit where the request allows it, with frank, specific wording about bodies, clothing and poses. Every person is an adult. Keep the request’s subjects and setting.",
  },
  {
    id: "photographic",
    label: "Photographic",
    description: "A real photograph: camera, lens and light.",
    instruction:
      "Photographic: write it as a real photograph. Name the kind of shot, a plausible camera and lens, the light and its direction, and true-to-life materials and textures. No painterly or illustrated words.",
  },
  {
    id: "cinematic",
    label: "Cinematic",
    description: "A film still: framing, grade and mood.",
    instruction:
      "Cinematic: write it as a still from a film. Name the framing and camera angle, dramatic motivated light, the colour grade and the atmosphere, as a cinematographer would.",
  },
  {
    id: "concise",
    label: "Concise",
    description: "Short and direct, essentials only.",
    instruction:
      "Concise: cut it to the essentials only: the subject, its key details, the style and the framing, as one short sentence (under 25 words) or, where the guide prefers tags, a few comma-separated tags. Drop filler, scene-setting that adds nothing and every repeated or generic quality word. It should be much shorter than the input.",
  },
  {
    id: "candid",
    label: "Candid",
    description: "Real life: an unposed, everyday snapshot.",
    instruction:
      "Candid (real life): make it an unposed, everyday snapshot, as if taken on a phone. Natural, imperfect light, ordinary surroundings with a few real-world specifics, people caught mid-moment rather than posing. No studio polish or glamour words.",
  },
]);

export const defaultPreset = "enhance";

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
