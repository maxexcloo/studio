// SPDX-License-Identifier: AGPL-3.0-only
// Speed tiers for MCP: read from the tier segment of a profile label such as "Krea 2 Turbo · Super Fast · 2 Steps".

export const mcpTiers = ['quality', 'standard', 'fast', 'turbo'];
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

/** The first sentence of a profile's description, for compact lists. */
export function summaryOf(profile, length = 120) {
  const text = String(profile?.description || '').replace(/\s+/g, ' ').trim();
  const sentence = /^.*?[.!?](?=\s|$)/.exec(text)?.[0] || text;
  return sentence.length > length ? `${sentence.slice(0, length - 1)}…` : sentence;
}

/** A profile whose first image slot starts the video, so an image can be animated from its first frame. */
export function takesFirstFrame(profile) {
  const slot = profile?.mediaInputs?.[0];
  return Boolean(slot) && (slot.role === 'start' || /\b(?:first frame|start image)\b/i.test(String(slot.label || '')));
}

/**
 * The profile Studio uses when Generate names a kind and tier instead of a profile_id:
 * the deployment default when it fits, then its family, then unrestricted, then catalogue order.
 * `firstFrame` (animating an image) prefers first-frame profiles and, without a tier or a
 * first-frame deployment default, the fast tier. `profiles` is already limited to this
 * account's ready profiles of the kind.
 */
export function chooseProfile(profiles, { kind, tier, defaultId, references = 0, firstFrame = false }) {
  if (!profiles.length) throw new Error(`No ready ${kind} profile is available to this account.`);
  const fallback = profiles.find(profile => profile.id === defaultId);
  const usable = (tier ? profilesForTier(profiles, tier) : profiles).filter(profile => {
    const slots = profile.mediaInputs || [];
    return references <= slots.length && slots.filter(slot => slot.required).length <= references;
  });
  if (!usable.length) {
    const available = mcpTiers.filter(item => profilesForTier(profiles, item).length);
    throw new Error(`No ready ${kind} profile${tier ? ` in the ${tier} tier` : ''} is available to this account${references ? ` for ${references} reference${references > 1 ? 's' : ''}` : ''}. Available ${kind} tiers: ${available.join(', ')}.`);
  }
  let pool = usable;
  const frames = firstFrame ? usable.filter(takesFirstFrame) : [];
  if (frames.length) {
    // A chat follow-up wants a quick animation, so Fast first-frame profiles lead unless a tier or the default says otherwise.
    const fast = tier || frames.some(profile => profile.id === defaultId) ? [] : profilesForTier(frames, 'fast');
    pool = fast.length ? fast : frames;
  }
  const score = (profile) => [profile.id === defaultId, Boolean(fallback?.family) && profile.family === fallback.family, !profile.restricted].reduce((total, value) => total * 2 + Number(value), 0);
  return pool.reduce((best, profile) => score(profile) > score(best) ? profile : best);
}
