/**
 * System prompts for prompt upsamplers: small language models some image
 * models are meant to run behind, which turn a short request into the long,
 * literal caption the model was trained on (see `upsampler` in the family
 * catalogue). The defaults use the makers' wording.
 */

import { promptInstruction } from "./prompt-instructions.js";

// FLUX 3 Image Klein: black-forest-labs/flux-3-image-klein, src/flux3/pup_prompts.json ("t2i", "i2i"), 2026-10-17.
export const flux3Upsampler = {
  get text() {
    return promptInstruction("flux3-text");
  },
  get edit() {
    return promptInstruction("flux3-edit");
  },
};
