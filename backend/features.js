/** Deployment switches for optional studio features. */
// On by default; STUDIO_ENABLE_INPAINT=0 turns it off.
export const inpaintingEnabled = process.env.STUDIO_ENABLE_INPAINT !== "0";

export const grokEnabled = process.env.STUDIO_ENABLE_GROK !== "0";
export const lorasEnabled = process.env.STUDIO_ENABLE_LORAS !== "0";

// Preset imports and provider downloads are explicitly enabled per instance.
export function presetsEnabled() {
  return process.env.STUDIO_ENABLE_PRESETS === "1";
}

export function modelFamilyEnabled(family, model = "") {
  const tessera = family === "tessera" || /(?:^|[\\/])tessera(?:[-_.]|$)/i.test(model);
  return (family !== "grok" || grokEnabled) && (!tessera || process.env.STUDIO_ENABLE_TESSERA !== "0");
}
