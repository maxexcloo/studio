import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseTemplate, draftId, draftProfileFromImport, partsOf, recommendedFromText } from './profile-drafts.js';
import { draftedProfile } from './assistant.js';
import { validateProfileText } from './profile-editor.js';

const sha = (char) => char.repeat(64);
const template = (id, { family = 'krea2', loader = 'UNETLoader', block = 'heissUi', prompting = null } = {}) => ({
  id, family, kind: 'image', aiDrafted: false,
  raw: {
    [block]: { id, name: `Template ${id}`, kind: 'image', family, description: 'The template.', defaults: { steps: 8, cfg: 1, sampler: 'euler', scheduler: 'simple' }, controls: { prompt: { node: '4', input: 'text' }, steps: { node: '5', input: 'steps' } }, ...(prompting ? { prompting } : {}) },
    graph: {
      1: loader === 'CheckpointLoaderSimple' ? { class_type: loader, inputs: { ckpt_name: 'base.safetensors' } } : { class_type: loader, inputs: { unet_name: 'base.safetensors' } },
      2: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3-vl-4b.safetensors' } },
      3: { class_type: 'VAELoader', inputs: { vae_name: 'flux2-vae.safetensors' } },
      4: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
      5: { class_type: 'KSampler', inputs: { steps: 8, sampler_name: 'euler', scheduler: 'simple', model: ['1', 0] } }
    }
  }
});
const info = {
  UNETLoader: { input: { required: { unet_name: [['base.safetensors']] } } },
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [[]] } } },
  CLIPLoader: { input: { required: { clip_name: [['qwen3-vl-4b.safetensors']] } } },
  VAELoader: { input: { required: { vae_name: [[]] } } },
  CLIPTextEncode: { input: { required: { text: ['STRING'] } } },
  KSampler: { input: { required: { steps: ['INT'], sampler_name: [['euler', 'dpmpp_2m']], scheduler: [['simple', 'karras']] } } }
};
const record = (extra = {}) => ({
  id: 'imp-test01', input: { kind: 'civitai-model', url: 'https://civitai.com/models/7' }, title: 'Real Skin', version: 'V3', baseModel: 'Krea 2', nsfw: null,
  links: { civitaiCom: 'https://civitai.com/models/7?modelVersionId=8' }, sourceText: 'Recommended: Steps: 12, CFG: 1.5, Sampler: DPM++ 2M Karras.',
  resources: [{ role: 'diffusion_model', name: 'Real Skin', want: { file: 'real-skin-v3.safetensors', folder: 'diffusion_models', sha256: sha('a'), bytes: 10 }, status: 'missing', spec: { id: 'civitai:8:1' } }],
  results: { catalogueKeys: [] }, ...extra
});
function deps(overrides = {}) {
  const saved = { profiles: {}, packs: {}, bindings: {} };
  const guides = {
    resolve: ({ family }) => family === 'krea2' ? { packId: 'krea2', source: 'family' } : null,
    pack: (id) => ({ pack: { summary: `Pack ${id}.` } }),
    read: () => ({ packs: { krea2: {}, ...saved.packs } }),
    save: (id, pack, options) => { saved.packs[id] = { pack, options }; },
    bind: (profileId, packId) => { saved.bindings[profileId] = packId; }
  };
  return {
    saved,
    templates: async () => [template('krea-fast'), template('krea-ckpt', { loader: 'CheckpointLoaderSimple' }), template('flux-one', { family: 'flux1' }), { ...template('krea-ai'), aiDrafted: true }],
    info: async () => info,
    families: (base) => /krea/i.test(base) ? ['krea2'] : [],
    familyFromName: () => '',
    taken: (id) => id === 'real-skin-v3',
    downloadsFor: (file, folder) => file === 'flux2-vae.safetensors' && folder === 'vae' ? [{ id: 'vae:flux2:0', file, folder, label: 'FLUX.2 VAE', url: 'https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors', sha256: sha('b'), bytes: 336 }] : [],
    engine: null,
    draftedProfile,
    validate: validateProfileText,
    create: (id, text, options) => { saved.profiles[id] = { text, options }; },
    guides,
    onSaved: () => {},
    ...overrides
  };
}

test('page words become ComfyUI settings; nothing is guessed', () => {
  assert.deepEqual(recommendedFromText('Steps: 25, CFG: 4.5, Sampler: DPM++ 2M Karras'), { steps: 25, cfg: 4.5, sampler: 'dpmpp_2m', scheduler: 'karras' });
  assert.deepEqual(recommendedFromText('Use 20-30 steps, cfg 3-5. sampler euler a'), { steps: 25, cfg: 4, sampler: 'euler_ancestral' });
  assert.deepEqual(recommendedFromText('A lovely model.'), {});
});

test('ids are unique and templates are the nearest same-family profile with the same loader', () => {
  assert.equal(draftId('Real Skin V3', (id) => ['real-skin-v3', 'real-skin-v3-2'].includes(id)), 'real-skin-v3-3');
  assert.equal(draftId('  ***  '), 'drafted');
  const templates = [template('krea-fast'), template('krea-ckpt', { loader: 'CheckpointLoaderSimple' }), { ...template('krea-ai'), aiDrafted: true }, template('flux3-k', { family: 'flux3_klein' })];
  assert.equal(chooseTemplate(templates, { families: ['krea2'], folder: 'diffusion_models' }).id, 'krea-fast');
  assert.equal(chooseTemplate(templates, { families: ['krea2'], folder: 'checkpoints' }).id, 'krea-ckpt');
  assert.equal(chooseTemplate(templates, { families: ['flux3'], folder: 'diffusion_models' }).id, 'flux3-k', 'a related family name matches');
  assert.equal(chooseTemplate(templates, { families: ['sdxl'], folder: 'checkpoints' }), null);
  assert.deepEqual(partsOf(template('x').raw, 'base.safetensors').map((part) => part.file), ['qwen3-vl-4b.safetensors', 'flux2-vae.safetensors']);
});

test('a checkpoint import drafts an NSFW-by-default profile with the page’s settings and queues its missing parts', async () => {
  const d = deps();
  const target = record();
  const result = await draftProfileFromImport(target, { by: 'admin-1' }, d);
  assert.deepEqual([result.id, result.profileId], ['real-skin-v3-2', 'custom:real-skin-v3-2']);
  const { text, options } = d.saved.profiles['real-skin-v3-2'];
  assert.equal(options.by, 'assistant');
  const raw = JSON.parse(text);
  assert.ok(raw.heissUi, 'written as heissUi');
  assert.deepEqual([raw.heissUi.id, raw.heissUi.name, raw.heissUi.nsfw, raw.heissUi.family], ['real-skin-v3-2', 'Real Skin V3', true, 'krea2'], 'unknown NSFW counts as NSFW');
  assert.deepEqual([raw.heissUi.defaults.model, raw.heissUi.defaults.steps, raw.heissUi.defaults.cfg, raw.heissUi.defaults.sampler, raw.heissUi.defaults.scheduler], ['real-skin-v3.safetensors', 12, 1.5, 'dpmpp_2m', 'karras']);
  assert.equal(raw.graph['1'].inputs.unet_name, 'real-skin-v3.safetensors');
  assert.match(raw.heissUi.description, /Drafted from https:\/\/civitai\.com/);
  // The VAE ComfyUI lacks joins the import with its download; the installed encoder doesn't.
  assert.deepEqual(target.resources.map((resource) => [resource.want.file, resource.role, resource.status, Boolean(resource.spec)]), [['real-skin-v3.safetensors', 'diffusion_model', 'missing', true], ['flux2-vae.safetensors', 'vae', 'missing', true]]);
  assert.equal(target.resources[1].spec.sha256, sha('b'));
  assert.deepEqual(target.results, { catalogueKeys: [], profileId: 'real-skin-v3-2' });
  assert.match(target.warnings.join(' '), /No guide drafted: the prompt assistant isn’t configured/);
  assert.deepEqual(target.draft, { template: 'krea-fast', families: ['krea2'], settings: 'page', nsfw: true });
});

test('a source that says safe is not NSFW, and the template’s own guidance is dropped for the drafted guide', async () => {
  const engine = {
    draftProfile: async (input) => ({ profile: draftedProfile({ ...input, read: { name: 'Ignored Name', steps: 20 } }), source: 'assistant' }),
    draftGuide: async ({ nearest, profile }) => ({ guide: { summary: `Drafted for ${profile.id} from ${nearest.summary}`, rules: [] } })
  };
  const d = deps({ engine, templates: async () => [template('owned', { block: 'studio', prompting: { id: 'own', summary: 'Own.' } })] });
  const target = record({ nsfw: false });
  await draftProfileFromImport(target, {}, d);
  const raw = JSON.parse(d.saved.profiles['real-skin-v3-2'].text);
  assert.equal(raw.studio, undefined, 'a studio template is written as heissUi');
  assert.deepEqual([raw.heissUi.nsfw, raw.heissUi.prompting, raw.heissUi.name, raw.heissUi.defaults.steps], [false, undefined, 'Real Skin V3', 20]);
  assert.deepEqual(d.saved.packs['real-skin-v3-2'].options, { by: 'assistant', origin: 'ai', aiDrafted: true });
  assert.equal(d.saved.packs['real-skin-v3-2'].pack.summary, 'Drafted for custom:real-skin-v3-2 from Pack krea2.');
  assert.deepEqual(d.saved.bindings, { 'custom:real-skin-v3-2': 'real-skin-v3-2' });
  assert.deepEqual([target.results.guideId, target.draft.settings], ['real-skin-v3-2', 'assistant']);
});

test('nothing is activated without ComfyUI, with unknown nodes, an unknown family or no template', async () => {
  await assert.rejects(draftProfileFromImport(record(), {}, deps({ info: async () => null })), /ComfyUI couldn’t be asked/);
  const unknownNode = deps({ templates: async () => { const item = template('krea-fast'); item.raw.graph['6'] = { class_type: 'MysteryNode', inputs: {} }; return [item]; } });
  await assert.rejects(draftProfileFromImport(record(), {}, unknownNode), /doesn’t know these node types.*MysteryNode/);
  assert.deepEqual(unknownNode.saved.profiles, {});
  await assert.rejects(draftProfileFromImport(record({ baseModel: 'Mystery' }), {}, deps()), /can’t tell which family/);
  await assert.rejects(draftProfileFromImport(record({ baseModel: 'Krea 2' }), {}, deps({ templates: async () => [template('flux-one', { family: 'flux1' })] })), /No krea2 profile loads a diffusion model/);
  const lora = record({ resources: [{ role: 'lora', want: { file: 'x.safetensors', folder: 'loras' } }] });
  await assert.rejects(draftProfileFromImport(lora, {}, deps()), /Only a checkpoint or diffusion model/);
  // A sampler this ComfyUI lacks falls back to the template's, with a warning.
  const odd = record({ sourceText: 'Sampler: Heun' });
  await draftProfileFromImport(odd, {}, deps());
  assert.match(odd.warnings.join(' '), /sampler heun, which this ComfyUI doesn’t offer/);
});

test('the import engine drafts a checkpoint on import, records a failure as a warning and drafts again on request', async (t) => {
  const { default: fs } = await import('node:fs');
  const { default: os } = await import('node:os');
  const { default: path } = await import('node:path');
  const { createImportEngine, createImportStore, publicImport } = await import('./library-imports.js');
  const { detectLink } = await import('./library-sources.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-draft-imports-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const resolved = { title: 'Real Skin', version: 'V3', baseModel: 'Krea 2', type: 'Checkpoint', nsfw: null, links: {}, sourceText: 'Steps: 12', resources: record().resources.map(({ status: _status, ...resource }) => ({ ...resource, supported: true, note: '' })), entry: null };
  let fail = true;
  const calls = [];
  const engine = createImportEngine({
    store: createImportStore({ dataDir: dir, log: {} }), detect: detectLink, catalogue: { edit: () => {} },
    resolveCivitai: async () => structuredClone(resolved), resolveHf: async () => { throw new Error('unused'); },
    inspect: async () => ({ status: 'missing' }), downloads: () => ({ active: null, queued: [], recent: [] }), startDownload: async () => ({}),
    importImage: async () => { throw new Error('unused'); }, resolvePreset: async () => null,
    draftProfile: async (target, options) => {
      calls.push([target.sourceText, options]);
      if (fail) throw new Error('ComfyUI couldn’t be asked');
      target.results.profileId = 'real-skin-v3';
    }
  });
  const created = await engine.create('https://civitai.com/models/7?modelVersionId=8', { by: 'admin-1' });
  assert.notEqual(created.state, 'failed', 'a draft failure never fails the import');
  assert.deepEqual(created.warnings, ['No profile drafted: ComfyUI couldn’t be asked']);
  assert.deepEqual(calls, [['Steps: 12', { by: 'admin-1', index: 0 }]]);
  assert.equal(publicImport(created).sourceText, undefined, 'the page text stays on the server');
  fail = false;
  const drafted = await engine.draft(created.id, { by: 'admin-1' });
  assert.deepEqual([drafted.results.profileId, drafted.warnings], ['real-skin-v3', []]);
  await assert.rejects(engine.draft(created.id), /already drafted a profile/);
});
