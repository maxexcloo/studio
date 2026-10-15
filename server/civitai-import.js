import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { modelFolders } from './comfy.js';
import { civitaiAssetUrl, civitaiJson, isCivitaiHost } from './civitai-access.js';

const samplers = {
  'DPM++ 2M': 'dpmpp_2m', 'DPM++ 2M SDE': 'dpmpp_2m_sde', 'DPM++ 2S a': 'dpmpp_2s_ancestral',
  'DPM++ 3M SDE': 'dpmpp_3m_sde', 'DPM++ SDE': 'dpmpp_sde', DDIM: 'ddim', DPM2: 'dpm_2',
  'DPM2 a': 'dpm_2_ancestral', Euler: 'euler', 'Euler a': 'euler_ancestral', Heun: 'heun', LCM: 'lcm', LMS: 'lms', UniPC: 'uni_pc'
};
const schedules = { Automatic: 'normal', Beta: 'beta', Exponential: 'exponential', Karras: 'karras', 'SGM Uniform': 'sgm_uniform', Simple: 'simple', Uniform: 'normal' };
const folders = { Checkpoint: 'checkpoints', LORA: 'loras', LoCon: 'loras', VAE: 'vae' };
const hashes = new Map();

export function civitaiLink(value, kind = 'images') {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error(`Paste a Civitai ${kind === 'images' ? 'image' : 'model'} link.`); }
  const match = url.pathname.match(new RegExp(`^/${kind}/([1-9]\\d*)(?:/[^/]*)?/?$`));
  if (url.protocol !== 'https:' || !isCivitaiHost(url.hostname) || url.username || url.password || url.port || url.hash || !match
    || [...url.searchParams.keys()].some((key) => key !== 'modelVersionId')) throw new Error(`Use a link from civitai.com/${kind}/… or civitai.red/${kind}/… without credentials.`);
  const id = Number(match[1]);
  const versionId = url.searchParams.has('modelVersionId') ? Number(url.searchParams.get('modelVersionId')) : null;
  if (!Number.isSafeInteger(id) || (versionId !== null && (!Number.isSafeInteger(versionId) || versionId < 1))) throw new Error('The Civitai link has an invalid ID.');
  return { id, versionId };
}

function number(value, min, max) {
  if (value === null || value === undefined || value === '') return undefined;
  const result = Number(value);
  return Number.isFinite(result) && result >= min && result <= max ? result : undefined;
}

export function imagePreset(image) {
  if (!image || !Number.isSafeInteger(image.id) || image.id < 1 || (image.type && !['image', 'video'].includes(image.type))) throw new Error('Choose an image or video on Civitai.');
  const metadata = image.meta && typeof image.meta === 'object' ? image.meta : {};
  const meta = Object.hasOwn(metadata, 'meta') ? metadata.meta && typeof metadata.meta === 'object' ? metadata.meta : {} : metadata;
  const warnings = [];
  const settings = {};
  for (const [key, raw, min, max] of [['cfg', meta.cfgScale ?? meta['CFG scale'], 0, 100], ['height', String(meta.Size || '').split('x')[1] ?? image.height, 64, 16384], ['steps', meta.steps ?? meta.Steps, 1, 10000], ['width', String(meta.Size || '').split('x')[0] || image.width, 64, 16384]]) {
    const value = number(raw, min, max);
    if (value !== undefined) settings[key] = value;
  }
  const seed = meta.seed ?? meta.Seed;
  if (image.type === 'video') {
    for (const [key, raw, min, max] of [['fps', meta.fps ?? meta.frameRate, 1, 240], ['frames', meta.frames ?? meta.frameCount, 1, 100000]]) {
      const value = number(raw, min, max);
      if (value !== undefined) settings[key] = value;
    }
  }
  if (/^\d{1,20}$/.test(String(seed ?? '')) && (typeof seed !== 'number' || Number.isSafeInteger(seed))) settings.seed = String(seed);
  else if (seed !== undefined) warnings.push('The source seed could not be read exactly; a random seed will be used.');
  const rawSampler = String(meta.sampler || meta.Sampler || '');
  const sampler = rawSampler.replace(/ (Karras|Exponential)$/i, '');
  if (Object.hasOwn(samplers, sampler)) settings.sampler = samplers[sampler];
  else if (sampler) warnings.push(`Sampler “${sampler}” needs a manual choice.`);
  const schedule = String(meta['Schedule type'] || meta.scheduler || rawSampler.match(/ (Karras|Exponential)$/i)?.[1] || '');
  const scheduler = Object.entries(schedules).find(([name]) => name.toLowerCase() === schedule.toLowerCase())?.[1];
  if (scheduler) settings.scheduler = scheduler;
  else if (schedule) warnings.push(`Schedule “${schedule}” needs a manual choice.`);
  if (!Object.keys(meta).length) warnings.push('This image has no generation metadata. You can save its source, but its settings cannot be recovered.');
  const resources = (Array.isArray(meta.civitaiResources) ? meta.civitaiResources : []).filter((item) => Number.isSafeInteger(item?.modelVersionId) && item.modelVersionId > 0).map((item) => ({ versionId: item.modelVersionId, weight: number(item.weight, -10, 10) ?? null }));
  for (const item of Array.isArray(meta.resources) ? meta.resources : []) {
    const versionId = Number(item?.modelVersionId);
    if (Number.isSafeInteger(versionId) && versionId > 0 && !resources.some((entry) => entry.versionId === versionId)) resources.push({ versionId, weight: number(item.weight, -10, 10) ?? null });
    else if (/^[a-f0-9]{8,64}$/i.test(item?.hash || '')) resources.push({ hash: item.hash, weight: number(item.weight, -10, 10) ?? null });
  }
  // Some upload tools retain only the flattened version IDs.
  for (const versionId of Array.isArray(image.modelVersionIds) ? image.modelVersionIds : []) {
    if (Number.isSafeInteger(versionId) && versionId > 0 && !resources.some((item) => item.versionId === versionId)) resources.push({ versionId, weight: null });
  }
  if (resources.length > 24) throw new Error('This image references too many resources to import.');
  if (!resources.length) warnings.push('No exact model versions were supplied. Choose a model before using this preset.');
  if (meta.clipSkip && Number(meta.clipSkip) !== 1) warnings.push(`CLIP skip ${meta.clipSkip} needs a matching workflow.`);
  if (!resources.length) {
    const named = [
      ...(Array.isArray(meta.models) ? meta.models : meta.Model ? [meta.Model] : []).map((name) => ({ name, type: 'Checkpoint' })),
      ...(Array.isArray(meta.vaes) ? meta.vaes : []).map((name) => ({ name, type: 'VAE' })),
      ...(Array.isArray(meta.additionalResources) ? meta.additionalResources : []),
      ...String(meta.prompt || '').matchAll(/<lora:([^:>]+):([^>]+)>/gi)
    ];
    for (const item of named) {
      const rawName = Array.isArray(item) ? item[1] : item?.name;
      if (typeof rawName !== 'string' || !rawName.trim()) continue;
      const file = path.basename(path.win32.basename(rawName.trim()));
      const rawType = Array.isArray(item) ? 'lora' : String(item.type || '').toLowerCase();
      const type = ['lora', 'locon'].includes(rawType) ? 'LORA' : rawType === 'vae' ? 'VAE' : rawType === 'checkpoint' || rawType === 'model' ? 'Checkpoint' : 'Unknown';
      const folder = folders[type] || '';
      if (!folder || resources.some((resource) => resource.folder === folder && resource.file === file)) continue;
      resources.push({ versionId: `name:${folder}:${file}`, file, folder, name: file, nameOnly: true, supported: false, type, weight: type === 'LORA' ? number(Array.isArray(item) ? item[2] : item.strength ?? item.weight, -10, 10) ?? null : null, note: 'No exact source version or checksum was supplied. Match a local filename or supply a model link to download it.' });
    }
    if (resources.length) warnings.push('Some source files are identified only by name. Filename matches do not verify the exact version.');
  }
  if (resources.length > 24) throw new Error('This image references too many resources to import.');
  if (Object.keys(meta).some((key) => /hires|controlnet|adetailer|denois/i.test(key))) warnings.push('Additional processing was recorded. Its workflow is not included in this preset.');
  const originalPrompt = String(meta.prompt || '').slice(0, 50000);
  if (/<lora:/i.test(originalPrompt) && !resources.length) warnings.push('LoRA tags were found without exact resource versions; resolve them manually.');
  let previewUrl = '';
  try { previewUrl = civitaiAssetUrl(image.url).href; } catch { /* No preview is still an importable preset. */ }
  if (meta.sampler && !settings.scheduler && !schedule) warnings.push('No sampling schedule was recorded; the selected workflow’s default will be used.');
  return {
    id: String(image.id), name: `Civitai ${image.id}`, sourceUrl: `https://civitai.com/images/${image.id}`, type: image.type || 'image',
    previewUrl, creator: String(image.username || '').slice(0, 100), baseModel: String(image.baseModel || '').slice(0, 100),
    prompt: originalPrompt.replace(/<lora:[^>]+>/gi, '').trim(), negative: String(meta.negativePrompt || '').slice(0, 50000),
    resources, settings, sourceMetadata: meta, warnings
  };
}

export function versionResource(version, weight = 1) {
  if (!Number.isSafeInteger(version?.id) || version.id < 1) throw new Error('Civitai did not return a model version.');
  const folder = Object.hasOwn(folders, version.model?.type) ? folders[version.model.type] : '';
  const files = (version.files || []).filter((file) => file.type === 'Model' && /\.(safetensors|gguf)$/i.test(file.name || '') && path.basename(file.name) === file.name && !file.name.includes('\\') && !/[\x00-\x1f]/.test(file.name));
  const file = files.find((item) => item.primary) || files[0];
  const sha256 = /^[a-f0-9]{64}$/i.test(file?.hashes?.SHA256 || '') ? file.hashes.SHA256.toLowerCase() : '';
  const spec = folder && file && sha256 ? {
    id: `civitai:${version.id}:${file.id}`, file: file.name, folder, label: String(version.model?.name || file.name).slice(0, 200),
    // Construct the endpoint from IDs rather than trusting a URL from metadata.
    url: `https://civitai.com/api/download/models/${version.id}?type=Model&format=${/\.gguf$/i.test(file.name) ? 'GGUF' : 'SafeTensor'}${file.metadata?.fp ? `&fp=${encodeURIComponent(file.metadata.fp)}` : ''}${file.metadata?.size ? `&size=${encodeURIComponent(file.metadata.size)}` : ''}`,
    sha256, bytes: Number(file.sizeKB || 0) * 1024
  } : null;
  return {
    versionId: version.id, weight, name: String(version.model?.name || version.name || version.id).slice(0, 200),
    version: String(version.name || '').slice(0, 200), type: String(version.model?.type || 'Unknown'), baseModel: String(version.baseModel || ''),
    sourceUrl: `https://civitai.com/models/${version.modelId}?modelVersionId=${version.id}`,
    file: file?.name || '', folder, sha256, bytes: spec?.bytes || 0, supported: Boolean(spec), spec,
    note: !folder ? 'This resource type needs a separate workflow.' : !spec ? 'No supported file with a published SHA-256 is available.' : '',
    trainedWords: (Array.isArray(version.trainedWords) ? version.trainedWords : []).map(String).slice(0, 30)
  };
}

export async function importCivitaiImage(value, { json = civitaiJson } = {}) {
  const { id } = civitaiLink(value);
  const response = await json(`images?imageId=${id}&withMeta=true&nsfw=true`);
  const image = response.items?.find((item) => item.id === id);
  if (!image) throw new Error('That image is unavailable. Check its link and your Civitai token.');
  const preset = imagePreset(image);
  const resources = [];
  // Keep provider requests bounded and avoid bursting a large LoRA stack.
  for (const item of preset.resources) {
    if (item.nameOnly) { resources.push(item); continue; }
    try {
      const resource = versionResource(await json(item.hash ? `model-versions/by-hash/${item.hash}` : `model-versions/${item.versionId}`), item.weight);
      if (!resources.some((entry) => entry.versionId === resource.versionId)) resources.push(resource);
    }
    catch { resources.push({ ...item, versionId: item.versionId || `hash:${item.hash}`, name: item.versionId ? `Version ${item.versionId}` : 'Unresolved Resource', type: 'Unknown', supported: false, note: 'This resource is unavailable or requires access.' }); }
  }
  return { ...preset, resources };
}

/** Only candidate files are hashed; cached hashes are invalidated when the file changes. */
async function hashFile(file) {
  const stat = await fs.promises.stat(file);
  const key = `${file}|${stat.size}|${stat.mtimeMs}`;
  if (!hashes.has(key)) {
    const promise = (async () => {
      const hash = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
      return hash.digest('hex');
    })();
    hashes.set(key, promise);
    promise.catch(() => hashes.delete(key));
    if (hashes.size > 512) hashes.delete(hashes.keys().next().value);
  }
  return hashes.get(key);
}

export async function matchResources(preset, { profiles = [], loras = [], vaes = [] } = {}, { foldersFor = modelFolders } = {}) {
  const resources = [];
  for (const resource of preset.resources) {
    let localName = '';
    let profileId = '';
    let conflict = false;
    const candidates = resource.folder === 'loras' ? loras : resource.folder === 'vae' ? vaes
      : profiles.filter((item) => item.kind === (preset.type || 'image')).flatMap((item) => [item.defaults?.model, item.model, item.baseModel]).filter(Boolean);
    for (const name of [...new Set(candidates)]) {
      if (typeof name !== 'string' || path.isAbsolute(name) || name.split(/[\\/]/).includes('..')) continue;
      const modelDirs = resource.folder === 'checkpoints'
        ? [...foldersFor('checkpoints', ['checkpoints']), ...foldersFor('diffusion_models', ['diffusion_models', 'unet'])]
        : resource.folder ? foldersFor(resource.folder, [resource.folder]) : [];
      for (const dir of modelDirs) {
        const file = path.join(dir, name);
        try {
          const stat = await fs.promises.stat(file);
          const sameName = path.basename(name) === resource.file;
          // Civitai rounds sizeKB; use a small tolerance to find renamed files.
          if (!stat.isFile() || (!sameName && (!resource.bytes || Math.abs(stat.size - resource.bytes) > 2048))) continue;
          if (resource.nameOnly && sameName) { localName = name; break; }
          if (resource.sha256 && await hashFile(file) === resource.sha256) { localName = name; break; }
          if (sameName) conflict = true;
        } catch { /* Try another configured model folder. */ }
      }
      if (localName) break;
    }
    if (localName && resource.folder === 'checkpoints') profileId = profiles.find((item) => item.kind === (preset.type || 'image') && [item.defaults?.model, item.model, item.baseModel].includes(localName))?.id || '';
    const { spec, ...publicResource } = resource;
    resources.push({ ...publicResource, conflict, localName, profileId, ...(resource.nameOnly && localName ? { note: 'Matched by filename only; the exact version is unverified.' } : {}), status: localName ? 'installed' : conflict ? 'conflict' : resource.supported ? 'missing' : 'unsupported' });
  }
  return { ...preset, resources };
}
