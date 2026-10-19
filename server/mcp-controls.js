// SPDX-License-Identifier: AGPL-3.0-only
// Which Generate arguments a profile lets MCP adjust; fixed controls are never advertised.
import { defaultGenerationCount } from './generation-defaults.js';
import { loraCompatibility, strengthRange } from './lora-policy.js';

const fixedRange = (range) => Boolean(range) && Number.isFinite(range.min) && range.min === range.max;
const rangeOf = (range, fallback, fallbackDefault) => {
  const value = { ...fallback, ...(range && typeof range === 'object' ? Object.fromEntries(['min', 'max', 'step'].filter(key => Number.isFinite(range[key])).map(key => [key, range[key]])) : {}) };
  return Number.isFinite(fallbackDefault) ? { ...value, default: fallbackDefault } : value;
};
/** ComfyUI skips the unconditional pass at exactly CFG 1, so a negative prompt has no effect there. */
export const cfgIgnoresNegative = (cfg) => Number.isFinite(Number(cfg)) && Math.abs(Number(cfg) - 1) < 1e-6;

/** Adjustable Generate controls in the order agents should consider them, with ranges, options and defaults. */
export function mcpControls(profile) {
  const caps = profile.capabilities || {};
  const constraints = profile.constraints || {};
  const defaults = profile.defaults || {};
  const options = profile.options || {};
  const controls = {};
  for (const key of ['width', 'height']) if (!fixedRange(constraints[key])) controls[key] = rangeOf(constraints[key], { min: 64 }, defaults[key]);
  controls.count = { min: 1, max: 4, default: defaultGenerationCount, note: 'Each output is a separate job.' };
  if (caps.seed !== false) controls.seed = { min: 0 };
  if (caps.steps !== false && !fixedRange(constraints.steps)) controls.steps = rangeOf(constraints.steps, { min: 1 }, defaults.steps);
  const cfgAdjustable = Boolean(caps.cfg) && !fixedRange(constraints.cfg);
  if (cfgAdjustable) controls.cfg = rangeOf(constraints.cfg, { min: 0, max: 100 }, defaults.cfg);
  if (caps.negativePrompt && (cfgAdjustable || !cfgIgnoresNegative(defaults.cfg))) {
    controls.negative_prompt = cfgIgnoresNegative(defaults.cfg) ? { note: 'Has no effect at cfg 1; set cfg above 1 with it.' } : {};
  }
  if (caps.denoise) controls.denoise = rangeOf(constraints.denoise, { min: 0, max: 1 }, defaults.denoise);
  for (const key of ['sampler', 'scheduler']) {
    const list = options[`${key}s`];
    if (caps[key] && Array.isArray(list) && list.length > 1) controls[key] = { options: list, ...(defaults[key] ? { default: defaults[key] } : {}) };
  }
  if (caps.lora !== false && Array.isArray(options.loras) && options.loras.length) controls.loras = { max: profile.maxLoras || 8, note: 'Choose names from this profile’s loras list.' };
  const slots = profile.mediaInputs || [];
  if (slots.length) controls.reference_asset_ids = { max: slots.length, slots: slots.map(slot => slot.id) };
  if (slots.length && profile.aspectPolicy === 'reference' && String(profile.workflow || '').startsWith('family:')) controls.reference_role = { options: ['edit', 'reference'], note: 'Requires reference_asset_ids.' };
  if (profile.kind === 'image') {
    controls.upscale_quality = { options: ['fast', 'balanced', 'high'] };
    controls.face_detail = { note: 'Requires upscale_quality.' };
  }
  return controls;
}

/** The value a fixed control always uses, when the profile states one. */
function fixedValue(profile, field) {
  const key = { negative_prompt: 'negative' }[field] || field;
  const range = profile.constraints?.[key];
  if (fixedRange(range)) return range.min;
  if (['sampler', 'scheduler'].includes(field) && profile.options?.[`${field}s`]?.length === 1) return profile.options[`${field}s`][0];
  return undefined;
}

/** Rejects a supplied control the profile does not let MCP adjust, naming it and the adjustable alternatives. */
export function assertAdjustable(profile, args) {
  const controls = mcpControls(profile);
  const adjustable = Object.keys(controls).join(', ');
  for (const field of ['width', 'height', 'seed', 'steps', 'cfg', 'negative_prompt', 'denoise', 'sampler', 'scheduler', 'loras', 'reference_asset_ids', 'reference_role', 'upscale_quality']) {
    const value = args[field];
    if (value === undefined || (Array.isArray(value) && !value.length) || controls[field]) continue;
    if (field === 'negative_prompt' && value === '') continue;
    const fixed = fixedValue(profile, field);
    if (fixed !== undefined && fixed === value) continue;
    let reason = fixed !== undefined ? ` It is fixed at ${fixed}.` : '';
    if (field === 'negative_prompt') reason = profile.capabilities?.negativePrompt
      ? ' This profile runs at cfg 1 (guidance-distilled), where a negative prompt has no effect. Describe what you want positively in the prompt instead.'
      : ' This profile has no negative prompt input (guidance-distilled). Describe what you want positively in the prompt instead.';
    throw new Error(`${field} cannot be adjusted for ${profile.label || profile.id}.${reason} Adjustable controls: ${adjustable}.`);
  }
  for (const field of ['width', 'height', 'steps', 'cfg', 'denoise']) {
    const value = args[field];
    const range = controls[field];
    if (value === undefined || !range) continue;
    if (!Number.isFinite(value) || (Number.isFinite(range.min) && value < range.min) || (Number.isFinite(range.max) && value > range.max)) throw new Error(`Choose ${field} from ${range.min ?? 0} to ${range.max ?? 'the profile maximum'} for this profile.`);
  }
  for (const field of ['sampler', 'scheduler']) if (args[field] !== undefined && controls[field] && !controls[field].options.includes(args[field])) throw new Error(`Choose ${field} from: ${controls[field].options.join(', ')}.`);
  if (args.negative_prompt && controls.negative_prompt && cfgIgnoresNegative(args.cfg ?? profile.defaults?.cfg)) {
    throw new Error(`negative_prompt has no effect at cfg 1 for ${profile.label || profile.id}. Set cfg above 1 (up to ${controls.cfg?.max ?? 'its maximum'}) together with negative_prompt, or describe what you want positively in the prompt instead.`);
  }
  return controls;
}

const clip = (value, length) => {
  const textValue = String(value || '').replace(/\s+/g, ' ').trim();
  return textValue.length > length ? `${textValue.slice(0, length - 1)}…` : textValue;
};

/** Profile-compatible optional LoRAs, described from the same metadata as the studio's LoRA picker. */
export function mcpLoras(profile, infos = {}, { query = '', limit = 40 } = {}) {
  if (profile.capabilities?.lora === false) return { loras: [], total: 0 };
  const needle = String(query || '').trim().toLowerCase();
  const entries = [];
  for (const name of profile.options?.loras || []) {
    const info = infos[name];
    // Infrastructure weights cannot enter the optional stack, and other architectures never fit.
    if (['acceleration', 'supporting'].includes(info?.role)) continue;
    const fit = loraCompatibility(info, profile);
    if (fit === 'other') continue;
    const range = strengthRange(info);
    const entry = {
      name,
      ...(info?.title ? { title: clip(info.title, 120) } : {}),
      ...(info?.description ? { description: clip(info.description, 280) } : {}),
      ...(info?.triggers?.length ? { trigger_words: info.triggers.slice(0, 12) } : {}),
      strength: range ? { recommended: range.default ?? 0.7, min: range.min, max: range.max } : { recommended: 0.7 },
      ...(info?.base ? { trained_for: info.base } : {}),
      ...(info?.sourceUrl ? { source_url: info.sourceUrl } : {}),
      ...(info?.note ? { note: clip(info.note, 200) } : {}),
      ...(fit === 'unknown' ? { compatibility: 'unverified' } : {})
    };
    if (needle && ![name, entry.title, entry.description, ...(entry.trigger_words || [])].some(value => String(value || '').toLowerCase().includes(needle))) continue;
    entries.push(entry);
  }
  // Verified fits first, then by name; the studio picker ranks the same way.
  entries.sort((left, right) => Number(Boolean(left.compatibility)) - Number(Boolean(right.compatibility)) || left.name.localeCompare(right.name));
  return { loras: entries.slice(0, limit), total: entries.length };
}
