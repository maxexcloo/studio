/** Keep the model and action on the title, with settings on the second line. */
export function modelName(profile) {
  const raw = String(profile?.displayName || profile?.label || 'No Model');
  const [lead, ...details] = raw.split(/\s*·\s*/);
  const precision = [];
  let name = lead.replace(/\[(FP\d+|BF\d+|INT\d+[^\]]*|W\d+A\d+)\]/gi, (_, value) => { precision.push(value.replace(/\s+ConvRot/gi, '')); return ''; })
    .replace(/\s+/g, ' ').trim();
  let action = details.find((detail) => /^(Generate|Edit|Reference|Non-Reference|Animate Image)$/i.test(detail));
  if (/^Minimax H3 Singularity Ref2va Pruned V([\d.]+) Int8$/i.test(name)) {
    name = name.replace(/^Minimax H3 Singularity Ref2va Pruned V([\d.]+) Int8$/i, 'MiniMax H3 Singularity v$1');
    precision.push('INT8');
    action = 'Animate Image';
  }
  if (action === 'Reference') action = profile?.kind === 'video' ? 'Animate Image' : 'Edit';
  if (action === 'Non-Reference') action = 'Generate';
  if (!action && / Image Edit$/.test(name)) {
    name = name.replace(/ Edit$/, '');
    action = 'Edit';
  }
  if (!action && / Image To Video$/.test(name)) {
    name = name.replace(/Image To Video$/, 'Video');
    action = 'Animate Image';
  }
  if (/\s+KV\b/.test(name)) {
    name = name.replace(/\s+KV\b/, '');
    precision.push('KV Cache');
  }
  const settings = details.filter((detail) => !/^(Generate|Edit|Reference|Non-Reference|Animate Image|Standard|Default|Distilled|Stock)$/i.test(detail))
    .filter((detail) => !(profile?.family === 'grok' && /\bSteps\b/i.test(detail)))
    .filter((detail) => !(String(profile?.family || '').replace(/-/g, '_') === 'minimax_h3' && detail === 'MiniMax H3'))
    .flatMap((detail) => detail.replace(/\s*\(≈([\d.]+)\s*s\)/g, ' · ~$1 s').split(' · '));
  if (profile?.family !== 'grok' && profile?.defaults?.steps && !settings.some((detail) => /\bSteps\b/i.test(detail))) settings.push(`${profile.defaults.steps} Steps`);
  if (action === 'Generate' && profile?.imageModes?.generate && profile.imageModes.reference) action = undefined;
  return { name: `${name || lead}${action ? ` · ${action}` : ''}`, detail: [...precision, ...settings].join(' · ') || profile?.familyName || profile?.family || '' };
}

const familyNames = {
  checkpoint: 'Checkpoint',
  flux2_klein_9b: 'FLUX',
  flux3_klein: 'FLUX',
  grok: 'Grok',
  ideogram4: 'Ideogram',
  krea2: 'Krea',
  minimax_h3: 'MiniMax',
  qwen_image_21: 'Qwen',
  wan: 'Wan',
  z_image: 'Z-Image',
  zimage: 'Z-Image',
};

export function modelFamily(profile) {
  if (!profile) return '';
  const family = String(profile.family || '').replace(/-/g, '_');
  const name = familyNames[family] || profile.familyName || (family && family !== 'custom' ? profile.family : 'Other Workflows');
  const variant = [profile.baseModel, profile.displayName, profile.label].filter(Boolean).join(' ');
  const fineTune = { krea2: /tessera|serendipity/i, qwen_image_21: /noct[ _-]*q/i, minimax_h3: /singularity|fused|dmad/i }[family];
  return fineTune?.test(variant) ? name + ' (Fine Tunes)' : name;
}

const catalogueCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Sort the visible model name before recipe details, with a stable identity tie-break. */
export function compareModelNames(a, b) {
  const left = modelName({ ...a, label: a.name || a.label });
  const right = modelName({ ...b, label: b.name || b.label });
  return catalogueCollator.compare(left.name, right.name) || catalogueCollator.compare(left.detail, right.detail) || catalogueCollator.compare(a.id, b.id);
}

/** Stock and imported profiles share family headings and keep their own identities. */
export function modelGroups(profiles) {
  const groups = new Map();
  for (const profile of profiles) {
    const family = modelFamily(profile);
    if (!groups.has(family)) groups.set(family, []);
    groups.get(family).push(profile);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([label, rows]) => ({
    id: `family:${label}`,
    label,
    rows: rows.sort(compareModelNames),
  }));
}

/** Metadata titles take precedence; the exact file name remains the identity. */
export function loraName(name, info) {
  const title = typeof info?.title === 'string' ? info.title.trim() : '';
  return title || String(name).split(/[\\/]/).pop().replace(/\.(safetensors|ckpt|pt|bin)$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Keep files without compatibility metadata visible while excluding known mismatches. */
export function modelLoras(options, fitOf, all = false) {
  return all ? options : options.filter((name) => fitOf(name) !== 'other');
}

export { loraCompatibility } from '../../server/lora-policy.js';

/** Prefer model variant metadata; imported recipes can identify acceleration by name or step count. */
export function workflowSpeed(workflow, profile) {
  const variant = String(profile?.variant || '').toLowerCase();
  if (/^(raw|base|dev|dedistilled)$/.test(variant)) return 'standard';
  const names = [variant, profile?.variantLabel, workflow.name].filter(Boolean).join(' ').replace(/de[- ]?distilled/gi, '');
  if (/\b(flash|turbo|distill(?:ed)?|schnell|lightning|hyper|lcm|pcm|tcd|dmd2?|pdd)\b/i.test(names)) return 'flash';
  const steps = Number(workflow.defaults?.steps);
  return steps > 0 && steps <= 8 && workflow.family !== 'grok' ? 'flash' : 'standard';
}

export function profileMatchesFilters(profile, filters, favourites = []) {
  if (filters.favourites && !(profile.recipeProfiles || [profile]).some((item) => favourites.includes(item.id))) return false;
  if (filters.speed && !(profile.recipeProfiles || [profile]).some((item) => workflowSpeed({ ...item, name: item.displayName || item.label }, item) === filters.speed)) return false;
  return true;
}
