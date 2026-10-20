import { compatibleLoras as sharedCompatibleLoras } from '../../server/lora-policy.js';

const key = (value) => typeof value === 'string' ? value.trim().replaceAll('\\', '/').toLowerCase() : '';
const aliases = (profile) => [profile.id, profile.model, profile.baseModel, profile.defaults?.model, profile.defaults?.modelName].map(key).filter(Boolean);
const basename = (value) => value.split('/').pop();

/** Recorded identity wins; a family or shared workflow alone does not identify weights. */
export function outputProfile(profiles = [], item = {}) {
  const candidates = profiles.filter((profile) => profile.kind === item.type && profile.ready !== false);
  const settings = item.settings || {};
  const imported = item.civitai?.resources?.find((resource) => ['checkpoints', 'diffusion_models'].includes(resource.folder));
  if (item.civitai && (!imported || imported.status === 'conflict')) return undefined;
  const saved = candidates.find((profile) => key(profile.id) === key(settings.profileId) && key(settings.profileId));
  if (saved) return saved;
  const names = (imported ? [imported.localName, imported.file] : [item.model, settings.model, settings.modelName]).map(key).filter(Boolean);
  const exact = [...new Set(names.flatMap((name) => candidates.filter((profile) => aliases(profile).includes(name))))];
  const workflow = candidates.filter((profile) => key(settings.workflow) && key(profile.workflow) === key(settings.workflow));
  const sameWorkflow = exact.find((profile) => workflow.includes(profile));
  if (sameWorkflow) return sameWorkflow;
  // A built-in workflow may be shared by every installed file in its family.
  if (workflow.length === 1 && !names.length && !key(settings.workflow).startsWith('family:')) return workflow[0];
  if (exact.length) return exact[0];
  const fileNames = names.filter((name) => /\.(safetensors|ckpt|gguf|pt)$/.test(name)).map(basename);
  const files = candidates.filter((profile) => aliases(profile).some((alias) => fileNames.includes(basename(alias))));
  const distinctFiles = new Set(files.map((profile) => key(profile.baseModel || profile.defaults?.model || profile.model)));
  if (distinctFiles.size === 1) return files[0];
  const labelled = candidates.filter((profile) => [profile.displayName, profile.label].map(key).some((label) => label && ![key(profile.family), key(profile.familyName)].includes(label) && names.includes(label)));
  return labelled.length === 1 ? labelled[0] : undefined;
}

/** Snap within the valid grid, including grids with a non-zero origin (video frames). */
export function reuseNumber(value, fallback, range = {}, defaultStep) {
  const step = Number(range.step || defaultStep);
  const offset = Number(range.offset || 0);
  const min = Number.isFinite(Number(range.min)) ? Number(range.min) : -Number.MAX_SAFE_INTEGER;
  const max = Number.isFinite(Number(range.max)) ? Number(range.max) : Number.MAX_SAFE_INTEGER;
  const number = Number.isFinite(Number(value)) && value !== '' && value != null ? Number(value) : Number(fallback);
  if (!Number.isFinite(number)) return undefined;
  if (!(step > 0)) return Math.max(min, Math.min(max, number));
  const low = Math.ceil((min - offset) / step);
  const high = Math.floor((max - offset) / step);
  if (low > high) return undefined;
  return Number((Math.max(low, Math.min(high, Math.round((number - offset) / step))) * step + offset).toFixed(8));
}

/** Foreign model parts must never overwrite the selected model's usable defaults. */
export function normaliseReusedSettings(profile, item, { available = {}, fallback = false, current = {}, loraInfos = {} } = {}) {
  const recorded = item.settings || {};
  const defaults = profile.defaults || {};
  const result = {};
  const dimensions = { width: recorded.width || item.width, height: recorded.height || item.height };
  for (const name of ['cfg', 'denoise', 'duration', 'fps', 'frames', 'height', 'steps', 'width']) {
    const conventional = { cfg: 1, denoise: 0.65, duration: 6, fps: 16, frames: 16, height: 1024, steps: 20, width: 1024 };
    const limits = { cfg: { min: 0, max: 100 }, denoise: { min: 0, max: 1 }, duration: { min: 1, max: 120 }, fps: { min: 1, max: 240 }, frames: { min: 1, max: 4096 }, height: { min: 64, max: 4096 }, steps: { min: 1, max: 1000 }, width: { min: 64, max: 4096 } };
    const value = name in dimensions ? dimensions[name] : recorded[name];
    result[name] = reuseNumber(value, defaults[name] ?? current[name] ?? conventional[name], { ...limits[name], ...profile.constraints?.[name] }, name === 'width' || name === 'height' ? 8 : undefined);
  }
  if (profile.aspectPolicy === 'fixed') {
    result.width = reuseNumber(defaults.width, current.width || 1024, profile.constraints?.width, 8);
    result.height = reuseNumber(defaults.height, current.height || 1024, profile.constraints?.height, 8);
  }
  const optionNames = { clipType: 'clipTypes', resolution: 'resolutions', sampler: 'samplers', scheduler: 'schedulers', textEncoder: 'textEncoders', vae: 'vaes', weightDtype: 'weightDtypes' };
  for (const [name, optionName] of Object.entries(optionNames)) {
    const options = profile.options?.[optionName] || available[optionName] || [];
    const preferred = fallback ? (defaults[name] ?? current[name]) : (recorded[name] ?? defaults[name] ?? current[name]);
    result[name] = String(options.length && !options.includes(preferred) ? (options.includes(defaults[name]) ? defaults[name] : options[0]) : preferred ?? '');
  }
  result.textEncoders = (profile.encoderSlots || []).map((slot, index) => {
    const preferred = fallback ? slot.default : recorded.textEncoders?.[index] || recorded.textEncoder || slot.default;
    return slot.options?.length && !slot.options.includes(preferred) ? slot.default || slot.options[0] : preferred;
  });
  if (!profile.encoderSlots?.length && result.textEncoder) result.textEncoders = [result.textEncoder];
  const offered = fallback || !profile.capabilities?.lora ? [] : (recorded.loras || []).filter((lora) => !profile.options?.loras?.length || profile.options.loras.includes(lora.name));
  // A LoRA made for another model family never comes back with the settings (the item keeps its record).
  const { loras: compatible, removed } = compatibleLoras(offered, profile, loraInfos);
  result.loras = compatible.slice(0, profile.maxLoras || 8);
  result.removedLoras = removed;
  result.hasImageInput = Boolean(profile.mediaInputs?.some((input) => input.kind === 'image') || (profile.kind === 'image' && (profile.capabilities?.startImage || profile.capabilities?.imageToImage)));
  return result;
}

/** The LoRAs a profile can take: those whose files say another family ("other") are left out and counted. */
export function compatibleLoras(loras = [], profile, loraInfos = {}) {
  // The server refuses the same LoRAs on submit (server/lora-policy.js).
  const { loras: kept, dropped } = sharedCompatibleLoras(loras, loraInfos, profile);
  return { loras: kept, removed: dropped };
}

/** "Removed 1 incompatible LoRA", or nothing. */
export function removedLorasNote(count) {
  return count ? `Removed ${count} incompatible ${count === 1 ? 'LoRA' : 'LoRAs'}` : '';
}
