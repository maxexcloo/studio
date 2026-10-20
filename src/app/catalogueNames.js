/**
 * A profile's name is "Title · Tier · N Steps[ · tags]" (the profiles repo's
 * convention): the title shows as it is, the rest on the second line. A
 * workflow without its steps in the name gets them from its defaults.
 */
export function modelName(profile) {
  const raw = String(profile?.displayName || profile?.label || 'No Model');
  const [lead, ...details] = raw.split(/\s*·\s*/);
  const settings = details.flatMap((detail) => detail.replace(/\s*\(≈([\d.]+)\s*s\)/g, ' · ~$1 s').split(' · ')).filter(Boolean);
  if (profile?.family !== 'grok' && profile?.defaults?.steps && !settings.some((detail) => /\bSteps?\b/i.test(detail))) settings.push(`${profile.defaults.steps} Steps`);
  return { name: lead.trim() || raw, detail: settings.join(' · ') || profile?.familyName || profile?.family || '' };
}

// Group headings: one per family, fine tunes included (Tessera and Tesserafine under Krea 2, Vesper Q under Qwen-Image 2.1, Singularity and 10Eros under MiniMax H3).
const familyNames = {
  boogu: 'Boogu',
  checkpoint: 'Checkpoint',
  flux: 'FLUX',
  flux2_klein_4b: 'FLUX',
  flux2_klein_9b: 'FLUX',
  flux3: 'FLUX',
  flux3_klein: 'FLUX',
  grok: 'Grok',
  ideogram4: 'Ideogram 4',
  krea2: 'Krea 2',
  minimax_h3: 'MiniMax H3',
  moss_image: 'MOSS Image',
  qwen_image_21: 'Qwen-Image 2.1',
  sdxl: 'SDXL',
  wan: 'Wan',
  z_image: 'Z-Image Turbo',
  zimage: 'Z-Image Turbo',
};

export function modelFamily(profile) {
  if (!profile) return '';
  const family = String(profile.family || '').replace(/-/g, '_');
  return familyNames[family] || profile.familyName || (family && family !== 'custom' ? profile.family : 'Other Workflows');
}

/** Specific family names for adapter filters, independent of broader model group headings. */
export function modelFamilyLabel(profile) {
  const family = String(profile?.family || '').replace(/-/g, '_');
  const labels = {
    boogu: 'Boogu', flux2_klein_4b: 'FLUX.2 Klein 4B', flux2_klein_9b: 'FLUX.2 Klein 9B',
    flux3: 'FLUX.3 Klein', flux3_klein: 'FLUX.3 Klein', ideogram4: 'Ideogram 4', krea2: 'Krea 2',
    minimax_h3: 'MiniMax H3', moss_image: 'MOSS Image', qwen_image_21: 'Qwen-Image 2.1',
    z_image: 'Z-Image', zimage: 'Z-Image',
  };
  return profile?.familyName || labels[family] || familyNames[family] || (family && family !== 'custom' ? family : '');
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
