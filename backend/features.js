/** Deployment switches for optional studio features. */
// Preset imports and provider downloads are explicitly enabled per instance.
export function presetsEnabled() {
  return process.env.STUDIO_ENABLE_PRESETS === "1";
}
