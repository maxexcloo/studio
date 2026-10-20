// SPDX-License-Identifier: AGPL-3.0-only
// Speed tiers for MCP: read from the tier segment of a profile label such as "Krea 2 Turbo · Super Fast · 2 Steps".
import { isLocalVideoProfile } from './comfy-backends.js';

export const mcpTiers = ['quality', 'standard', 'fast', 'turbo'];
/** Without a tier, chat picks the quickest everyday tier: Fast, then Super Fast, Standard and Quality. */
export const preferredTiers = ['fast', 'turbo', 'standard', 'quality'];
const labels = { 'super fast': 'turbo', fast: 'fast', quality: 'quality', standard: 'standard' };

/** A profile's tier; a label without a tier segment counts as standard. */
export function tierOf(profile) {
  for (const segment of String(profile?.label || '').split('·')) {
    const tier = labels[segment.trim().toLowerCase()];
    if (tier) return tier;
  }
  return 'standard';
}

/** Profiles for a tier. Standard falls back to Quality when no profile is standard. */
export function profilesForTier(profiles, tier) {
  const matching = profiles.filter(profile => tierOf(profile) === tier);
  return matching.length || tier !== 'standard' ? matching : profiles.filter(profile => tierOf(profile) === 'quality');
}

/** Profiles in preferred tier order (Fast first), keeping catalogue order within a tier. */
export function fastestFirst(profiles) {
  const rank = (profile) => preferredTiers.indexOf(tierOf(profile));
  return [...profiles].sort((left, right) => rank(left) - rank(right));
}

/** The profiles of the first preferred tier that has any. */
function fastestTier(profiles) {
  for (const tier of preferredTiers) {
    const matching = profiles.filter(profile => tierOf(profile) === tier);
    if (matching.length) return matching;
  }
  return profiles;
}

const squash = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
/**
 * The profile a name means: its id, then an id, label or family match ignoring case and punctuation,
 * then a partial match. Several matches from one family ("flux 3" for every FLUX.3 profile) resolve
 * to its fastest profile; matches across families find nothing.
 */
export function findProfile(profiles, value) {
  const exact = profiles.find(profile => profile.id === value);
  if (exact) return exact;
  const key = squash(value);
  if (!key) return null;
  const names = (profile) => [profile.id, profile.label, profile.displayName, String(profile.label || '').split('·')[0], profile.family].map(squash).filter(Boolean);
  for (const pick of [profile => names(profile).includes(key), profile => names(profile).some(name => name.includes(key))]) {
    const found = profiles.filter(pick);
    if (found.length === 1) return found[0];
    if (found.length > 1 && found[0].family && found.every(profile => profile.family === found[0].family)) return fastestFirst(found)[0];
  }
  return null;
}

/** A profile whose first image slot starts the video, so an image can be animated from its first frame. */
export function takesFirstFrame(profile) {
  const slot = profile?.mediaInputs?.[0];
  return Boolean(slot) && (slot.role === 'start' || /\b(?:first frame|start image)\b/i.test(String(slot.label || '')));
}

/** Whether a profile's image slots take this many references. */
const fits = (profile, references) => {
  const slots = profile.mediaInputs || [];
  return references <= slots.length && slots.filter(slot => slot.required).length <= references;
};

/**
 * The profile Studio uses when Generate names a kind and tier instead of a profile_id. Without a
 * tier, the first preferred tier (Fast, Super Fast, Standard, Quality) that fits. Within it, the
 * deployment default, then its family, then unrestricted, then catalogue order. `firstFrame`
 * (animating an image) prefers first-frame profiles. `profiles` is already limited to this
 * account's ready profiles of the kind.
 */
export function chooseProfile(profiles, { kind, tier, defaultId, references = 0, firstFrame = false }) {
  if (!profiles.length) throw new Error(`No ready ${kind} profile is available to this account.`);
  const fallback = profiles.find(profile => profile.id === defaultId);
  const usable = (tier ? profilesForTier(profiles, tier) : profiles).filter(profile => fits(profile, references));
  if (!usable.length) {
    const available = mcpTiers.filter(item => profilesForTier(profiles, item).length);
    throw new Error(`No ready ${kind} profile${tier ? ` in the ${tier} tier` : ''} is available to this account${references ? ` for ${references} reference${references > 1 ? 's' : ''}` : ''}. Available ${kind} tiers: ${available.join(', ')}.`);
  }
  const frames = firstFrame ? usable.filter(takesFirstFrame) : [];
  let pool = frames.length ? frames : usable;
  if (!tier) pool = fastestTier(pool);
  const score = (profile) => [profile.id === defaultId, Boolean(fallback?.family) && profile.family === fallback.family, !profile.restricted].reduce((total, value) => total * 2 + Number(value), 0);
  return pool.reduce((best, profile) => score(profile) > score(best) ? profile : best);
}

/**
 * The video profile to use while the local video worker is unavailable: a ready profile
 * that runs elsewhere (a provider-backed cloud profile), fits the references and, when
 * animating, starts from an image. The requested tier wins when one matches, otherwise
 * Standard. Null when the account has no such profile, so the usual choice and error apply.
 */
export function chooseRemoteVideo(profiles, { tier, defaultId, references = 0, firstFrame = false }) {
  const remote = profiles.filter(profile => !isLocalVideoProfile(profile) && fits(profile, references)
    && (!firstFrame || takesFirstFrame(profile) || Boolean({ ...profile, ...profile.imageModes?.reference }.capabilities?.startImage)));
  if (!remote.length) return null;
  const preferred = [tier, 'standard'].find(item => item && profilesForTier(remote, item).length);
  return chooseProfile(remote, { kind: 'video', tier: preferred, defaultId, references });
}
