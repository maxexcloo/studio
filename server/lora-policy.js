const constraintKeys = ['baseModels', 'conditionings', 'profileIds'];
const familyId = (value) => {
  const id = String(value || '').replace(/-/g, '_');
  return id === 'flux3_klein' ? 'flux3' : id;
};
const basename = (value) => String(value || '').split(/[\\/]/).pop();

/** Explicit publisher targets refine family compatibility; unverified variants stay unknown. */
export function loraCompatibility(info, profile) {
  const family = familyId(profile?.family);
  if (!info?.families?.length || !family || family === 'custom') return 'unknown';
  if (!info.families.some((value) => familyId(value) === family)) return 'other';
  const constraints = info.compatibility;
  if (!constraints) return 'fits';
  const model = profile?.baseModel || profile?.defaults?.model || profile?.model;
  const context = {
    baseModels: /^custom:/.test(String(model || '')) ? '' : basename(model),
    conditionings: profile?.recipe?.conditioning,
    profileIds: profile?.id,
  };
  let unknown = false;
  for (const key of constraintKeys) {
    if (!Object.hasOwn(constraints, key)) continue;
    if (!context[key]) { unknown = true; continue; }
    const allowed = constraints[key] || [];
    if (!allowed.some((value) => (key === 'baseModels' ? basename(value) : value) === context[key])) {
      if (constraints.unlisted === 'other') return 'other';
      unknown = true;
    }
  }
  return unknown ? 'unknown' : 'fits';
}

/** Only explicit full publisher bounds replace existing controls; recommendations stay prose. */
export function strengthRange(info) {
  const range = info?.strengthRange;
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min >= range.max) return null;
  if (!Number.isFinite(range.step) || range.step <= 0 || range.step > range.max - range.min) return null;
  return {
    min: range.min, max: range.max, step: range.step,
    ...(Number.isFinite(range.default) && range.default >= range.min && range.default <= range.max ? { default: range.default } : {}),
  };
}

export function compatibilityNote(info, profile) {
  if (!info?.compatibility) return '';
  const fit = loraCompatibility(info, profile);
  return fit === 'unknown' ? 'Compatibility has not been verified for this model variant.'
    : fit === 'other' ? 'This LoRA does not support the selected model variant.' : '';
}
