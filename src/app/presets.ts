import type { Profile } from './types';

export type PresetResource = {
  versionId: number | string; weight: number | null; name: string; nameOnly?: boolean; version?: string; type: string; baseModel?: string;
  sourceUrl?: string; file?: string; folder?: string; bytes?: number; supported: boolean; note?: string;
  status?: 'installed' | 'missing' | 'conflict' | 'unsupported'; localName?: string; profileId?: string;
};
export type ImagePreset = {
  type?: 'image' | 'video';
  id: string; name: string; sourceUrl: string; thumbnailUrl: string; creator: string; baseModel: string;
  prompt: string; negative: string; resources: PresetResource[]; savedAt?: string; galleryItemId?: string; downloadWarnings?: string[];
  settings: { cfg?: number; fps?: number; frames?: number; height?: number; sampler?: string; scheduler?: string; seed?: string; steps?: number; width?: number };
  warnings: string[];
};

export function presetFit(preset: ImagePreset, profile?: Profile) {
  const warnings = [...preset.warnings];
  const blockers: string[] = [];
  const loras = preset.resources.filter((item) => item.folder === 'loras');
  if (!profile) blockers.push('Choose an installed model.');
  if (preset.resources.some((item) => item.status === 'unsupported' && !item.nameOnly)) blockers.push('Some resources need a separate workflow.');
  if (preset.resources.some((item) => item.status === 'unsupported' && item.nameOnly)) blockers.push('Some source files need a local filename match or a model link.');
  if (loras.some((item) => !item.localName)) blockers.push('Download the missing LoRAs first.');
  if (loras.some((item) => item.weight === null)) blockers.push('The source did not include all LoRA weights.');
  if (loras.length && profile && !profile.capabilities.lora) blockers.push('This workflow does not accept LoRAs.');
  const loraLimit = Math.min(8, profile?.maxLoras ?? 8);
  if (loras.length > loraLimit) blockers.push(`This workflow accepts ${loraLimit} LoRAs.`);
  if (profile && loras.some((item) => profile.options?.loras && !profile.options.loras.includes(item.localName || ''))) blockers.push('This workflow cannot load all of the source LoRAs.');
  const checkpoint = preset.resources.find((item) => item.folder === 'checkpoints');
  if (checkpoint && profile && checkpoint.profileId !== profile.id) warnings.push('You are using a different model or workflow from the source image.');
  const bases = new Set(preset.resources.filter((item) => item.folder === 'checkpoints' || item.folder === 'loras').map((item) => item.baseModel).filter(Boolean));
  if (bases.size > 1) warnings.push('The source resources name different base models. Check their compatibility.');
  if (!preset.prompt) blockers.push('This image has no prompt to apply.');
  const settings = { ...preset.settings };
  if (profile) {
    for (const key of ['sampler', 'scheduler'] as const) {
      const values = profile.options?.[key === 'sampler' ? 'samplers' : 'schedulers'];
      if (settings[key] && values && !values.includes(settings[key]!)) {
        warnings.push(`This workflow does not support ${settings[key]}; its default will be used.`);
        delete settings[key];
      }
    }
    for (const key of ['cfg', 'height', 'steps', 'width'] as const) {
      const value = settings[key];
      if (value === undefined) continue;
      const range = profile.constraints?.[key] || {};
      const step = range.step || (key === 'width' || key === 'height' ? 8 : key === 'cfg' ? 0.1 : 1);
      const adjusted = Math.max(range.min ?? (key === 'cfg' ? 0 : 1), Math.min(range.max ?? 16384, Math.round(value / step) * step));
      if (adjusted !== value) warnings.push(`${key === 'cfg' ? 'CFG' : key[0].toUpperCase() + key.slice(1)} will use ${adjusted}, within this workflow’s limits.`);
      settings[key] = adjusted;
    }
    if (preset.negative && profile.capabilities.negativePrompt === false) warnings.push('This workflow does not use a negative prompt.');
    const maxPrompt = profile.constraints?.prompt?.max;
    if (maxPrompt && preset.prompt.length > maxPrompt) warnings.push(`The prompt will be shortened to this workflow’s ${maxPrompt} character limit.`);
    if (preset.resources.some((item) => item.folder === 'vae' && (!item.localName || !profile.capabilities.vae))) blockers.push('The source VAE cannot be applied with this workflow.');
  }
  return { blockers: [...new Set(blockers)], loras, settings, warnings: [...new Set(warnings)] };
}
