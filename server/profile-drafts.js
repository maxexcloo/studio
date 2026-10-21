// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A checkpoint or diffusion model import becomes an AI-drafted profile and guide (design §4,
 * "Checkpoint or diffusion model"; Phase 5):
 *
 *   1. The family comes from the source's base model (familiesFromMetadata), else the file name.
 *   2. The template is the nearest profile Studio holds for that family whose loader reads the
 *      same kind of file (a checkpoint or a diffusion model), never another AI draft.
 *   3. The draft is the template with this file, the page's recommended steps, CFG, sampler and
 *      scheduler (read by the assistant, else from the page's own words) and its NSFW marker
 *      (from the source; unknown counts as NSFW). The template's own guidance is dropped so the
 *      drafted guide applies.
 *   4. Parts ComfyUI doesn't list (VAE, text encoders) that Studio's catalogue can download join
 *      the import's files, so Download Missing fetches them with the model.
 *   5. The draft is checked with validateProfileText against ComfyUI's object_info before it is
 *      written: without ComfyUI, or with node types it doesn't know, nothing is activated.
 *   6. It is saved as a new profile (origin "ai", AI-Drafted: administrators only until an
 *      administrator approves it in Settings › Profiles), and its guide is drafted from the page
 *      and the template's guide, saved AI-Drafted and bound to the profile.
 *
 * Everything that talks to the outside is injected, so tests need no worker or gateway.
 */
import { catalogueKinds } from './library-catalogue.js';
import { profileBlock, withWrittenBlock } from './profile-block.js';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const loaders = { checkpoints: ['CheckpointLoaderSimple'], diffusion_models: ['UNETLoader', 'UnetLoaderGGUF'] };
const loaderInput = { CheckpointLoaderSimple: 'ckpt_name', UNETLoader: 'unet_name', UnetLoaderGGUF: 'unet_name' };
const folders = { CLIPLoader: 'text_encoders', DualCLIPLoader: 'text_encoders', TripleCLIPLoader: 'text_encoders', VAELoader: 'vae', CLIPVisionLoader: 'clip_vision' };
const comparable = (family) => String(family || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const familyMatches = (template, wanted) => {
  const a = comparable(template);
  return Boolean(a) && wanted.some((family) => { const b = comparable(family); return b && (a === b || a.startsWith(b) || b.startsWith(a)); });
};

/** A profile id from a title: lowercase words joined by dashes, unique among `taken(id)`. */
export function draftId(title, taken = () => false) {
  const base = String(title || 'drafted').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'drafted';
  let id = base;
  for (let n = 2; taken(id); n += 1) id = `${base}-${n}`;
  return id;
}

const samplerWords = [
  [/dpm\+\+\s*2m\s*sde/i, 'dpmpp_2m_sde'], [/dpm\+\+\s*3m\s*sde/i, 'dpmpp_3m_sde'], [/dpm\+\+\s*2s\s*a/i, 'dpmpp_2s_ancestral'],
  [/dpm\+\+\s*sde/i, 'dpmpp_sde'], [/dpm\+\+\s*2m/i, 'dpmpp_2m'], [/euler\s*a(ncestral)?\b/i, 'euler_ancestral'], [/\beuler\b/i, 'euler'],
  [/uni[\s_-]?pc/i, 'uni_pc'], [/\blcm\b/i, 'lcm'], [/\bddim\b/i, 'ddim'], [/\bheun\b/i, 'heun'], [/\bres[_\s-]?multistep\b/i, 'res_multistep']
];
const schedulerWords = [[/karras/i, 'karras'], [/exponential/i, 'exponential'], [/sgm[\s_-]?uniform/i, 'sgm_uniform'], [/\bbeta\b/i, 'beta'], [/\bsimple\b/i, 'simple'], [/\bnormal\b/i, 'normal'], [/\bddim[\s_-]?uniform\b/i, 'ddim_uniform']];

/**
 * Recommended settings a model page states in words ("Steps: 25", "CFG 4.5", "Sampler: DPM++ 2M
 * Karras"), as ComfyUI names. Only what is written; nothing is guessed. Pure.
 */
export function recommendedFromText(text) {
  const page = String(text || '');
  const out = {};
  const steps = /\bsteps?\s*[:=]?\s*(\d{1,3})(?:\s*[-–~]\s*(\d{1,3}))?/i.exec(page) || /\b(\d{1,3})(?:\s*[-–~]\s*(\d{1,3}))?\s*steps\b/i.exec(page);
  if (steps) out.steps = Math.round(steps[2] ? (Number(steps[1]) + Number(steps[2])) / 2 : Number(steps[1]));
  const cfg = /\b(?:cfg(?:\s*scale)?|guidance(?:\s*scale)?)\s*[:=]?\s*(\d{1,2}(?:\.\d+)?)(?:\s*[-–~]\s*(\d{1,2}(?:\.\d+)?))?/i.exec(page);
  if (cfg) out.cfg = cfg[2] ? Math.round(((Number(cfg[1]) + Number(cfg[2])) / 2) * 10) / 10 : Number(cfg[1]);
  const samplerLine = /\bsampler\s*(?:name)?\s*[:=]?\s*([^\n,;]{2,40})/i.exec(page)?.[1] || '';
  const sampler = samplerWords.find(([pattern]) => pattern.test(samplerLine));
  if (sampler) out.sampler = sampler[1];
  const schedulerLine = `${samplerLine} ${/\bschedul(?:er|e)\s*[:=]?\s*([^\n,;]{2,30})/i.exec(page)?.[1] || ''}`;
  const scheduler = schedulerWords.find(([pattern]) => pattern.test(schedulerLine));
  if (scheduler) out.scheduler = scheduler[1];
  return out;
}

/** The node that loads the profile's model: the `model` control's node, else the first model loader. */
function modelLoader(raw) {
  const meta = profileBlock(raw) || {};
  const graph = isObject(raw.graph) ? raw.graph : {};
  const controlled = meta.controls?.model?.node !== undefined ? graph[String(meta.controls.model.node)] : null;
  if (controlled && loaderInput[controlled.class_type]) return controlled;
  return Object.values(graph).find((node) => loaderInput[node?.class_type]) || null;
}

/**
 * The nearest template for a model file: same family, a loader for its folder, not AI-drafted.
 * `templates`: [{id, family, kind, raw, aiDrafted}]. Prefers an exact family over a related one.
 */
export function chooseTemplate(templates, { families = [], folder }) {
  const wanted = loaders[folder] || [];
  const fits = templates.filter((item) => !item.aiDrafted && isObject(item.raw) && familyMatches(item.family, families) && wanted.includes(modelLoader(item.raw)?.class_type));
  const exact = fits.filter((item) => families.some((family) => comparable(family) === comparable(item.family)));
  return [...exact, ...fits].sort((a, b) => (exact.includes(b) - exact.includes(a)) || (b.kind === 'image') - (a.kind === 'image') || a.id.localeCompare(b.id))[0] || null;
}

/** Model files the draft's loaders name besides the model itself: [{file, folder, classType}]. */
export function partsOf(raw, modelFile) {
  const parts = new Map();
  for (const node of Object.values(isObject(raw.graph) ? raw.graph : {})) {
    const folder = folders[node?.class_type];
    if (!folder) continue;
    for (const [key, value] of Object.entries(node.inputs || {})) {
      if (typeof value !== 'string' || !/\.(safetensors|gguf|pt|pth|bin|ckpt|sft)$/i.test(value) || value === modelFile || !/name/.test(key)) continue;
      parts.set(`${folder}/${value}`, { file: value, folder, classType: node.class_type });
    }
  }
  return [...parts.values()];
}

const listed = (info, classType, file) => Object.values(info?.[classType]?.input?.required || {}).concat(Object.values(info?.[classType]?.input?.optional || {}))
  .some((definition) => Array.isArray(definition) && ((Array.isArray(definition[0]) && definition[0].includes(file)) || (Array.isArray(definition[1]?.options) && definition[1].options.includes(file))));

/**
 * Drafts the profile and guide for one import record, in place: `record.resources` gains the
 * parts to download, `record.results` the profile and guide ids, `record.warnings` what to know.
 *
 * deps: templates() → [{id, family, kind, raw, aiDrafted}]; info() → object_info or null;
 * families(baseModel) → family ids; familyFromName(file) → family id; taken(id) → bool;
 * downloadsFor(file, folder) → catalogue download specs; engine (assistant.js) or null;
 * draftedProfile (assistant.js, used without an engine); validate(id, text, {info});
 * create(id, text, {by}) → saves the new AI-drafted profile; guides (profile-store.js guide
 * store); onSaved().
 */
export async function draftProfileFromImport(record, { index = null, by = '' } = {}, deps) {
  const at = index ?? (record.resources || []).findIndex((resource) => ['checkpoint', 'diffusion_model'].includes(resource.role) && !resource.optional);
  const model = record.resources?.[at];
  if (!model || !['checkpoints', 'diffusion_models'].includes(model.want?.folder)) throw new Error('Only a checkpoint or diffusion model gets a profile.');
  const modelFile = model.want.file;
  const families = [...new Set([...(deps.families(record.baseModel || '') || []), ...(deps.familyFromName?.(modelFile) ? [deps.familyFromName(modelFile)] : [])].filter((family) => family && family !== 'custom'))];
  if (!families.length) throw new Error(`Studio can’t tell which family ${record.baseModel || modelFile} belongs to.`);
  const template = chooseTemplate(await deps.templates(), { families, folder: model.want.folder });
  if (!template) throw new Error(`No ${families[0]} profile loads a ${model.want.folder === 'checkpoints' ? 'checkpoint' : 'diffusion model'} to start from. Import a workflow of that family first.`);
  const info = await deps.info().catch(() => null);
  if (!info || !Object.keys(info).length) throw new Error('ComfyUI couldn’t be asked, so the draft wasn’t checked or activated. Try again when the worker answers.');

  // The template as drafts start from it: its model input named in defaults, its own guidance gone.
  const base = withWrittenBlock(structuredClone(template.raw));
  const meta = base.heissUi;
  const loader = modelLoader(base);
  meta.defaults = { ...(meta.defaults || {}), model: loader.inputs[loaderInput[loader.class_type]] };
  delete meta.prompting;
  for (const mode of Object.values(isObject(meta.imageModes) ? meta.imageModes : {})) if (isObject(mode)) delete mode.prompting;
  delete meta.nsfw;

  const id = draftId([record.title, record.version].filter(Boolean).join(' '), deps.taken);
  const sourceText = String(record.sourceText || '');
  const recommended = recommendedFromText(sourceText);
  const nsfw = record.nsfw === false ? false : true;
  let drafted;
  let read = 'page';
  if (deps.engine) {
    const result = await deps.engine.draftProfile({ id, template: base, modelFile, recommended, sourceText, nsfw });
    drafted = result.profile;
    read = result.source === 'assistant' ? 'assistant' : 'page';
  } else drafted = deps.draftedProfile({ id, template: base, modelFile, recommended, nsfw });
  const dmeta = drafted.heissUi;
  dmeta.id = id;
  dmeta.name = [record.title, record.version].filter(Boolean).join(' ').slice(0, 120) || id;
  if (!dmeta.description || dmeta.description === profileBlock(template.raw)?.description) dmeta.description = `Drafted from ${record.links?.civitaiCom || record.links?.hf || record.input?.url || 'an import'}`.slice(0, 300);
  dmeta.nsfw = nsfw;
  const loaderNode = modelLoader(drafted);
  loaderNode.inputs[loaderInput[loaderNode.class_type]] = modelFile;

  // Samplers and schedulers this ComfyUI doesn't offer fall back to the template's.
  const warnings = [];
  for (const [key, input] of [['sampler', 'sampler_name'], ['scheduler', 'scheduler']]) {
    const options = info.KSampler?.input?.required?.[input]?.[0];
    if (dmeta.defaults?.[key] && Array.isArray(options) && !options.includes(dmeta.defaults[key])) {
      warnings.push(`The page recommends the ${key} ${dmeta.defaults[key]}, which this ComfyUI doesn’t offer; the template’s is kept.`);
      if (meta.defaults[key]) dmeta.defaults[key] = meta.defaults[key]; else delete dmeta.defaults[key];
    }
  }

  const text = `${JSON.stringify(drafted, null, 2)}\n`;
  const checked = deps.validate(id, text, { info });
  if (!checked.ok) throw new Error(`The draft didn’t pass Studio’s check: ${checked.errors[0]}`);
  const unknown = [...new Set(Object.values(drafted.graph || {}).map((node) => node?.class_type).filter((type) => type && !info[type]))];
  if (unknown.length) throw new Error(`ComfyUI doesn’t know these node types, so the draft wasn’t activated: ${unknown.join(', ')}.`);

  // Parts ComfyUI doesn't list join the import's files when Studio knows where to get them.
  const have = new Set((record.resources || []).map((resource) => `${resource.want?.folder}/${resource.want?.file}`));
  for (const part of partsOf(drafted, modelFile)) {
    if (listed(info, part.classType, part.file) || have.has(`${part.folder}/${part.file}`)) continue;
    const spec = (deps.downloadsFor(part.file, part.folder) || []).find((item) => /^[a-f0-9]{64}$/i.test(item?.sha256 || ''));
    if (!spec) { warnings.push(`${part.file} isn’t installed and Studio has no download for it. Put it in ComfyUI’s models/${part.folder} folder.`); continue; }
    record.resources.push({
      role: catalogueKinds[part.folder] || 'model', name: spec.label || part.file, version: '', status: 'missing', supported: true, note: 'Needed by the drafted profile',
      want: { file: part.file, folder: part.folder, sha256: spec.sha256.toLowerCase(), bytes: Number(spec.bytes) || 0, source: { provider: /huggingface\.co/.test(spec.url || '') ? 'hf' : 'catalogue', url: spec.url || '' } },
      spec: { id: spec.id, file: part.file, folder: part.folder, label: spec.label || part.file, url: spec.url, sha256: spec.sha256.toLowerCase(), bytes: Number(spec.bytes) || 0 }
    });
    have.add(`${part.folder}/${part.file}`);
  }

  // Saved as the assistant's version; the import record says who asked for it.
  deps.create(id, text, { by: 'assistant', requestedBy: by });
  record.results = { ...(record.results || {}), profileId: id };
  const profileId = `custom:${id}`;

  // The guide: drafted from the page and the template's guide; the family's applies otherwise.
  const nearest = deps.guides.resolve({ id: `custom:${template.id}`, family: template.family, kind: template.kind });
  if (!deps.engine) warnings.push('No guide drafted: the prompt assistant isn’t configured, so the family’s guide applies.');
  else {
    try {
      const nearestPack = nearest ? deps.guides.pack(nearest.packId).pack : null;
      const { guide } = await deps.engine.draftGuide({ profile: { id: profileId, label: dmeta.name, kind: dmeta.kind || template.kind, family: dmeta.family || template.family }, family: dmeta.family || template.family, sourceText, nearest: nearestPack });
      const store = deps.guides.read();
      let packId = id;
      for (let n = 2; store?.packs?.[packId]; n += 1) packId = `${id}-${n}`;
      deps.guides.save(packId, { ...guide, name: guide.name || dmeta.name, sources: [record.links?.civitaiCom || record.links?.hf].filter(Boolean) }, { by: 'assistant', origin: 'ai', aiDrafted: true });
      deps.guides.bind(profileId, packId);
      record.results.guideId = packId;
    } catch (error) { warnings.push(`No guide drafted (${error.message}); the family’s guide applies.`); }
  }
  for (const warning of checked.warnings.filter((item) => !/doesn’t list the/.test(item))) warnings.push(warning);
  record.warnings = [...(record.warnings || []), ...warnings];
  record.draft = { template: template.id, families, settings: read, nsfw };
  await deps.onSaved?.(id);
  return { id, profileId, guideId: record.results.guideId || '', warnings };
}
