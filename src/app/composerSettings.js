// Prompts and private reference assets belong to their space, never to these
// persistent image/video settings.
const settingKeys = [
  'model', 'textEncoder', 'textEncoders', 'vae', 'clipType', 'weightDtype',
  'width', 'height', 'steps', 'cfg', 'denoise', 'inpaintStrength',
  'inpaintFeather', 'seed', 'count', 'frames', 'fps', 'duration', 'resolution', 'sampler', 'scheduler',
  'loras', 'customSize'
];

export function composerSettings(value = {}) {
  return Object.fromEntries(settingKeys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
}

export function modeSettings(draft = {}) {
  const saved = draft.modeSettings || {};
  const settings = Object.fromEntries(['image', 'video'].filter((mode) => saved[mode]).map((mode) => [mode, composerSettings(saved[mode])]));
  const active = draft.mode === 'video' ? 'video' : 'image';
  settings[active] = { ...settings[active], ...composerSettings(draft) };
  return settings;
}

export function modePrompts(draft = {}) {
  const prompts = Object.fromEntries(['image', 'video'].map((mode) => [mode, {
    prompt: String(draft.modePrompts?.[mode]?.prompt || ''),
    negative: String(draft.modePrompts?.[mode]?.negative || '')
  }]));
  const active = draft.mode === 'video' ? 'video' : 'image';
  prompts[active] = { prompt: String(draft.prompt || ''), negative: String(draft.negative || '') };
  return prompts;
}

export function reusedNegative(value, current) {
  return String(value || '').trim() ? String(value) : current;
}

export function canRestoreLoras(requestRevision, currentRevision, found) {
  return Boolean(found) && requestRevision === currentRevision;
}

export function modeReferences(draft = {}) {
  const state = (value = {}) => ({
    assets: Array.isArray(value.assets) ? value.assets : [],
    image: String(value.image || ''),
    id: String(value.id || ''),
    name: String(value.name || '')
  });
  const saved = draft.modeReferences || {};
  const references = { image: state(saved.image), video: state(saved.video) };
  const active = draft.mode === 'video' ? 'video' : 'image';
  if (draft.referenceAssets || draft.startImageId) references[active] = state({ assets: draft.referenceAssets, id: draft.startImageId, name: draft.startImageName });
  return references;
}

export function savedModeReferences(references) {
  return Object.fromEntries(Object.entries(references).map(([kind, value]) => [kind, {
    ...value,
    image: '',
    name: String(value.id || '').startsWith('vault:') ? 'Hidden image' : value.name,
    assets: value.assets.map(({ slot, asset }) => asset.privacyDomain === 'vault' || asset.source === 'vault'
      ? { slot, asset: { id: asset.id, source: 'vault', privacyDomain: 'vault', galleryItemId: asset.galleryItemId, name: 'Hidden image', mime: '', width: 0, height: 0, size: 0, createdAt: '', thumbnailUrl: '' } }
      : { slot, asset })
  }]));
}
