/** Deployment switches for optional studio features. */
// On by default; STUDIO_ENABLE_INPAINT=0 turns it off.
export const inpaintingEnabled = process.env.STUDIO_ENABLE_INPAINT !== "0";

export const grokEnabled = process.env.STUDIO_ENABLE_GROK !== "0";
export const lorasEnabled = process.env.STUDIO_ENABLE_LORAS !== "0";

// Preset imports and provider downloads are explicitly enabled per instance.
export function presetsEnabled() {
  return process.env.STUDIO_ENABLE_PRESETS === "1";
}

export function builtInProfilesEnabled() {
  if (process.env.STUDIO_ENABLE_BUILTIN_PROFILES !== undefined)
    return process.env.STUDIO_ENABLE_BUILTIN_PROFILES !== "0";
  return !process.env.STUDIO_CONFIG_DIR;
}

export function modelFamilyEnabled(family, model = "") {
  const kroma = family === "kroma" || /(?:^|[\\/])kroma(?:[-_.]|$)/i.test(model);
  return (family !== "grok" || grokEnabled) && (!kroma || process.env.STUDIO_ENABLE_KROMA !== "0");
}
