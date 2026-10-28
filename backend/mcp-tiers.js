// SPDX-License-Identifier: AGPL-3.0-only
// Speed tiers for MCP: read from the tier segment of a profile label such as "Krea 2 Turbo · Super Fast · 2 Steps".

import { isCloudProfile } from "./cloud-profiles.js";
import { canonicalProfileId, profileAliasBackend } from "./profile-store.js";

export const mcpTiers = ["quality", "standard", "fast", "turbo"];

/** A provider-backed cloud profile (Grok). MCP never chooses one by itself. */
export { isCloudProfile };
// "grok" anywhere; "cloud" only as a request for it ("in the cloud", "a cloud model"), so "a cloud over the hills" stays local.
const cloudWords =
  /\bgrok\b|\b(?:in|on|via|use|using|with|through|to)\s+(?:the\s+)?cloud\b|\bcloud\s+(?:models?|profiles?|videos?|images?|generation|version)\b/i;
/** Whether the user's request asks for the cloud: "grok", or "cloud" as a request for it. */
export const asksForCloud = (request) =>
  cloudWords.test(String(request || "").replace(/[-_]/g, " "));
/** Whether a model name or profile_id names the cloud: "grok", "cloud" or a grok-* id. */
const namesCloud = (name) => /\b(?:grok|cloud)\b/i.test(String(name || "").replace(/[-_]/g, " "));
/** The profiles MCP may pick from a request or name: cloud ones only when it asks for the cloud. */
export const localUnlessAsked = (profiles, { request, name } = {}) =>
  asksForCloud(request) || namesCloud(name)
    ? profiles
    : profiles.filter((profile) => !isCloudProfile(profile));
/**
 * What MCP says instead of sending video to the cloud while the local video worker is down. It names Grok
 * only when the account may use a cloud profile; with none granted, there is nothing to offer.
 */
export const localVideoUnavailable = (cloudOffered = false) =>
  `Local video is unavailable right now: the video worker is offline. ${cloudOffered ? "Tell the user; they can ask for Grok to make it in the cloud instead." : "Tell the user to try again later."}`;
/** Without a tier, chat picks the quickest everyday tier: Fast, then Super Fast, Standard and Quality. */
const preferredTiers = ["fast", "turbo", "standard", "quality"];
const labels = { "super fast": "turbo", fast: "fast", quality: "quality", standard: "standard" };

/** A profile's tier; a label without a tier segment counts as standard. */
export function tierOf(profile) {
  for (const segment of String(profile?.label || "").split("·")) {
    const tier = labels[segment.trim().toLowerCase()];
    if (tier) return tier;
  }
  return "standard";
}

// A tier with no profile falls back to its neighbour: Standard to Quality, Super Fast to Fast.
const fallbackTiers = { standard: "quality", turbo: "fast" };
/** Profiles for a tier. Standard falls back to Quality and turbo (Super Fast) to Fast when the tier has none. */
export function profilesForTier(profiles, tier) {
  const matching = profiles.filter((profile) => tierOf(profile) === tier);
  return matching.length || !fallbackTiers[tier]
    ? matching
    : profiles.filter((profile) => tierOf(profile) === fallbackTiers[tier]);
}

// "Turbo" in chat means quick, and a distilled Fast profile is what most people mean by it, so the two speed tiers list together.
const nearTiers = {
  turbo: ["turbo", "fast"],
  fast: ["fast", "turbo"],
  standard: ["standard"],
  quality: ["quality"],
};
/** Profiles for a tier as Models lists them: the tier itself first, then the neighbouring speed tier, each in catalogue order. */
export function profilesNearTier(profiles, tier) {
  const tiers = nearTiers[tier] || [tier];
  const listed = tiers.flatMap((item) => profiles.filter((profile) => tierOf(profile) === item));
  if (!listed.length && fallbackTiers[tier]) return profilesForTier(profiles, tier);
  return [...new Set(listed)];
}

/** Profiles in preferred tier order (Fast first), keeping catalogue order within a tier. */
export function fastestFirst(profiles) {
  const rank = (profile) => preferredTiers.indexOf(tierOf(profile));
  return [...profiles].sort((left, right) => rank(left) - rank(right));
}

/** The profiles of the first preferred tier that has any. */
function fastestTier(profiles) {
  for (const tier of preferredTiers) {
    const matching = profiles.filter((profile) => tierOf(profile) === tier);
    if (matching.length) return matching;
  }
  return profiles;
}

const squash = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
/**
 * Words of a name or query, lowercased, with a bare number joined to the word before it,
 * so "flux 3", "flux3" and "FLUX.3" all read as flux3.
 */
export function nameWords(value) {
  const words = [];
  for (const part of String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)) {
    if (/^\d+$/.test(part) && /[a-z]$/.test(words.at(-1) || "")) words[words.length - 1] += part;
    else words.push(part);
  }
  return words;
}
// Speed words in a query say which tier is wanted rather than naming a model.
const speedWords = {
  turbo: "turbo",
  super: "turbo",
  draft: "turbo",
  fast: "fast",
  quick: "fast",
  quality: "quality",
  best: "quality",
  hq: "quality",
  standard: "standard",
};
/** Words that ask for a speed rather than name a model. */
export const speedWordList = new Set(Object.keys(speedWords));
const profileNames = (profile) =>
  [profile.id, profile.label, profile.displayName, profile.family].filter(Boolean);
/**
 * How well a profile answers a free-text query: null when a model word ("flux 3", "moss") is missing
 * from its id, label or family. Speed words never name a model ("Turbo" in a label does not count);
 * they only rank by tier, so "moss turbo" means MOSS's fastest profile.
 */
function queryScore(profile, words) {
  const own = new Set(profileNames(profile).flatMap(nameWords));
  const joined = profileNames(profile).map(squash).join(" ");
  // Longer words also match inside a name, so "klein" finds flux3klein and "tessera" finds Tesserafine.
  const has = (word) => own.has(word) || (word.length > 2 && joined.includes(word));
  let score = 0;
  for (const word of words) {
    const speed = speedWords[word];
    if (!speed) {
      if (!has(word)) return null;
      continue;
    }
    if ((nearTiers[speed] || [speed]).includes(tierOf(profile)))
      score += tierOf(profile) === speed ? 2 : 1;
  }
  return score;
}
/**
 * Profiles a free-text query names, best first: every model word must match (fuzzily, so "flux 3",
 * "flux3", "FLUX.3" and "klein" all find FLUX.3 [klein]); speed words such as "turbo" or "fast" rank.
 * A query without a model word names nothing.
 */
export function searchProfiles(profiles, query) {
  return scoredSearch(profiles, query).map((item) => item.profile);
}
function scoredSearch(profiles, query) {
  const words = nameWords(query);
  if (!words.some((word) => !speedWords[word])) return [];
  const scored = fastestFirst(profiles)
    .map((profile) => ({ profile, score: queryScore(profile, words) }))
    .filter((item) => item.score !== null);
  return scored.sort((left, right) => right.score - left.score);
}
/**
 * The profile a name means: its id, then an id, label or family match ignoring case and punctuation,
 * then a partial match, then every model word of a query such as "turbo flux 3". Several matches from
 * one family ("flux 3" for every FLUX.3 profile) resolve to its fastest profile, or the one a speed
 * word picks within it; matches across families find nothing.
 */
export function findProfile(profiles, value) {
  const id = canonicalProfileId(value);
  const exact = profiles.find((profile) => profile.id === id);
  // An old per-backend id of a combined profile names its backend too (`namedBackend`).
  const backend = exact?.backend ? profileAliasBackend(value) : "";
  if (exact) return backend ? { ...exact, namedBackend: backend } : exact;
  const key = squash(value);
  if (!key) return null;
  const names = (profile) =>
    [
      profile.id,
      profile.label,
      profile.displayName,
      String(profile.label || "").split("·")[0],
      profile.family,
    ]
      .map(squash)
      .filter(Boolean);
  const oneFamily = (found) =>
    found.length > 1 &&
    found[0].family &&
    found.every((profile) => profile.family === found[0].family);
  for (const pick of [
    (profile) => names(profile).includes(key),
    (profile) => names(profile).some((name) => name.includes(key)),
  ]) {
    const found = profiles.filter(pick);
    if (found.length === 1) return found[0];
    if (oneFamily(found)) return fastestFirst(found)[0];
  }
  // The model words decide the family; speed words only choose within it, never across families.
  const found = searchProfiles(profiles, value);
  return found.length === 1 || oneFamily(found) ? found[0] : null;
}

/** A profile whose first image slot starts the video, so an image can be animated from its first frame. */
export function takesFirstFrame(profile) {
  const slot = profile?.mediaInputs?.[0];
  return (
    Boolean(slot) &&
    (slot.role === "start" || /\b(?:first frame|start image)\b/i.test(String(slot.label || "")))
  );
}

/** Whether a profile's image slots take this many references. */
const fits = (profile, references) => {
  const slots = profile.mediaInputs || [];
  return references <= slots.length && slots.filter((slot) => slot.required).length <= references;
};

/**
 * The profiles Studio may use when Generate names a kind and tier instead of a profile_id: without a
 * tier, the first preferred tier (Fast, Super Fast, Standard, Quality) that fits. `firstFrame`
 * (animating an image) prefers first-frame profiles. `profiles` is already limited to this account's
 * ready profiles of the kind.
 */
export function choicePool(profiles, { kind, tier, references = 0, firstFrame = false }) {
  if (!profiles.length) throw new Error(`No ready ${kind} profile is available to this account.`);
  const usable = (tier ? profilesForTier(profiles, tier) : profiles).filter((profile) =>
    fits(profile, references),
  );
  if (!usable.length) {
    const available = mcpTiers.filter((item) => profilesForTier(profiles, item).length);
    throw new Error(
      `No ready ${kind} profile${tier ? ` in the ${tier} tier` : ""} is available to this account${references ? ` for ${references} reference${references > 1 ? "s" : ""}` : ""}. Available ${kind} tiers: ${available.join(", ")}.`,
    );
  }
  const frames = firstFrame ? usable.filter(takesFirstFrame) : [];
  const pool = frames.length ? frames : usable;
  return tier ? pool : fastestTier(pool);
}

/** The pool’s usual pick: the deployment default, then its family, then censored before uncensored, then catalogue order. */
export function chooseProfile(profiles, { defaultId, ...options }) {
  const fallback = profiles.find((profile) => profile.id === defaultId);
  const score = (profile) =>
    [
      profile.id === defaultId,
      Boolean(fallback?.family) && profile.family === fallback.family,
      !profile.uncensored,
    ].reduce((total, value) => total * 2 + Number(value), 0);
  return choicePool(profiles, options).reduce((best, profile) =>
    score(profile) > score(best) ? profile : best,
  );
}

// From a wanted tier, the order of the nearest others.
const tierDistance = {
  turbo: ["turbo", "fast", "standard", "quality"],
  fast: ["fast", "turbo", "standard", "quality"],
  standard: ["standard", "quality", "fast", "turbo"],
  quality: ["quality", "standard", "fast", "turbo"],
};
const tierNames = { turbo: "Super Fast", fast: "Fast", standard: "Standard", quality: "Quality" };
/**
 * A named profile moved to the wanted tier within its own family: the family's profile in that tier,
 * otherwise its nearest tier with a note to pass on. Never another family; without a family the
 * profile stays as named.
 */
export function withinFamily(profiles, profile, tier) {
  if (!tier || !profile || tierOf(profile) === tier) return { profile, note: "" };
  const family = profile.family
    ? profiles.filter((item) => item.family === profile.family && item.kind === profile.kind)
    : [profile];
  for (const item of tierDistance[tier] || [tier]) {
    const match =
      item === tierOf(profile) ? profile : family.find((candidate) => tierOf(candidate) === item);
    if (!match) continue;
    if (item === tier) return { profile: match, note: "" };
    const name = String(match.label || match.id)
      .split("·")[0]
      .trim();
    return {
      profile: match,
      note: `${name} has no ${tierNames[tier]} profile; used ${match.label || match.id}. Tell the user. `,
    };
  }
  return { profile, note: "" };
}

// Words most profile names share, which say nothing about the model.
const genericWords = new Set([
  "image",
  "images",
  "video",
  "videos",
  "model",
  "models",
  "profile",
  "custom",
  "bento",
  "steps",
  "step",
  "the",
  "a",
  "an",
]);
/**
 * Profiles that share a model word with a name that matched nothing, so a miss lists the family the
 * user meant ("moss xl" lists MOSS) instead of unrelated models. Empty when no model word matches.
 */
export function familyMatches(profiles, value) {
  const words = nameWords(value).filter((word) => !speedWords[word] && !genericWords.has(word));
  return fastestFirst(profiles).filter((profile) => {
    const own = new Set(profileNames(profile).flatMap(nameWords));
    const joined = profileNames(profile).map(squash).join(" ");
    return words.some((word) => own.has(word) || (word.length > 3 && joined.includes(word)));
  });
}

// Label and family words too common to name a model on their own.
const notAliases = new Set([
  ...genericWords,
  ...Object.keys(speedWords),
  "base",
  "edit",
  "raw",
  "max",
  "ref",
  "sft",
  "distilled",
  "lite",
  "cloud",
  "text",
  "only",
  "optional",
  "reference",
  "single",
  "uncensored",
]);
/** Words that name a profile's model: its family id's words and its label's first word, with and without a version digit ("krea2", "krea"). */
function aliases(profile) {
  const words = [
    ...nameWords(String(profile.family || "").replace(/_/g, " ")),
    nameWords(String(profile.label || "").split("·")[0])[0],
  ].filter(Boolean);
  return new Set(
    words
      .flatMap((word) => [word, word.replace(/\d+$/, "")])
      .filter((word) => word.length > 2 && !/^\d/.test(word) && !notAliases.has(word)),
  );
}
/**
 * The profile a request names when Generate has no profile_id ("six baby ducks, fast moss"): a model
 * or family alias of exactly one family, resolved within it by the request's model and speed words,
 * then moved to `tier` within the family. Null when no family, or several, are named.
 */
export function profileFromRequest(profiles, request, tier) {
  const words = nameWords(request);
  // Adjacent words joined too, so "Z-Image" finds zimage.
  const terms = new Set([
    ...words,
    ...words.slice(1).map((word, index) => `${words[index]}${word}`),
  ]);
  const named = new Map();
  for (const profile of profiles) {
    const hits = [...aliases(profile)].filter((alias) => terms.has(alias));
    if (hits.length)
      named.set(profile.family || profile.id, [
        ...(named.get(profile.family || profile.id) || []),
        { profile, hits },
      ]);
  }
  if (named.size !== 1) return null;
  const [entries] = named.values();
  const family = entries.map((entry) => entry.profile);
  // The request's words that also name something in the family ("radiance", "tesserafine"), plus its speed words.
  const familyWords = new Set(
    family.flatMap((profile) => profileNames(profile).flatMap(nameWords)),
  );
  const query = [
    ...new Set([
      ...entries.flatMap((entry) => entry.hits),
      ...[...terms].filter((word) => familyWords.has(word) && !notAliases.has(word)),
    ]),
    ...words.filter((word) => speedWords[word]),
  ].join(" ");
  // Within the family, a profile's own name ("tesserafine") narrows further; otherwise its speed words choose.
  const found =
    findProfile(family, query) || searchProfiles(family, query)[0] || fastestFirst(family)[0];
  const moved = withinFamily(profiles, found, tier);
  return {
    ...moved,
    note: `Used ${moved.profile.label || moved.profile.id}, the model the request names. ${moved.note}`,
  };
}
