/** Deployment switches for optional studio features. */
// On by default; HEISS_ENABLE_INPAINT=0 turns it off.
export const inpaintingEnabled = process.env.HEISS_ENABLE_INPAINT !== '0';

export const grokEnabled = process.env.HEISS_ENABLE_GROK !== '0';
export const lorasEnabled = process.env.HEISS_ENABLE_LORAS !== '0';

export function builtInProfilesEnabled() {
  return process.env.HEISS_ENABLE_BUILTIN_PROFILES !== '0';
}

export function modelFamilyEnabled(family, model = '') {
  const tessera = family === 'tessera' || /(?:^|[\\/])tessera(?:[-_.]|$)/i.test(model);
  return (family !== 'grok' || grokEnabled) && (!tessera || process.env.HEISS_ENABLE_TESSERA !== '0');
}
