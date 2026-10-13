/** Keep the model and action on the title, with settings on the second line. */
export function modelName(profile) {
  const raw = String(profile?.displayName || profile?.label || 'No Model');
  const [lead, ...details] = raw.split(/\s*·\s*/);
  const precision = [];
  let name = lead.replace(/\[(FP\d+|BF\d+|INT\d+[^\]]*|W\d+A\d+)\]/gi, (_, value) => { precision.push(value.replace(/\s+ConvRot/gi, '')); return ''; })
    .replace(/\[klein\]/gi, 'Klein').replace(/Qwen-Image/g, 'Qwen Image').replace(/\s+/g, ' ').trim();
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
  if (!action && profile?.kind) action = 'Generate';
  return { name: `${name || lead}${action ? ` · ${action}` : ''}`, detail: [...precision, ...settings].join(' · ') || profile?.familyName || profile?.family || '' };
}

const familyNames = {
  checkpoint: 'Checkpoint',
  flux2_klein_9b: 'FLUX.2 Klein 9B',
  grok: 'Grok Imagine',
  ideogram4: 'Ideogram 4',
  krea2: 'Krea 2',
  minimax_h3: 'MiniMax H3',
  qwen_image_21: 'Qwen Image 2.1',
  wan: 'Wan Video',
  z_image: 'Z-Image',
  zimage: 'Z-Image',
};

export function modelFamily(profile) {
  if (!profile) return '';
  const family = String(profile.family || '').replace(/-/g, '_');
  return familyNames[family] || profile.familyName || (family && family !== 'custom' ? profile.family : 'Other Workflows');
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
    rows: rows.sort((a, b) => (a.displayName || a.label || '').localeCompare(b.displayName || b.label || '')),
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

/** Compare explicit family identifiers, including hyphen/underscore aliases. */
export function loraCompatibility(info, profile) {
  const family = String(profile?.family || '').replace(/-/g, '_');
  if (!info?.families?.length || !family || family === 'custom') return 'unknown';
  return info.families.some((value) => value.replace(/-/g, '_') === family) ? 'fits' : 'other';
}
