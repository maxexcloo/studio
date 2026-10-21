import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import zlib from 'node:zlib';
import { a1111Recipe, civitaiJsonRecipe, comfyRecipe, comfySampling, exifText, imageFormat, imageRecipe, parseSettingsLine, readImageMetadata, workflowGraph } from './image-metadata.js';
import { withPngText } from './png-text.js';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/images/${name}`, import.meta.url));
const recipeOf = (name) => imageRecipe(readImageMetadata(fixture(name)));

test('formats are told apart by their first bytes, and anything else is refused', () => {
  assert.equal(imageFormat(fixture('a1111.png')), 'png');
  assert.equal(imageFormat(fixture('comfyui.webp')), 'webp');
  assert.equal(imageFormat(fixture('a1111.jpg')), 'jpeg');
  assert.equal(imageFormat(Buffer.from('GIF89a-not-a-supported-image')), null);
  assert.equal(readImageMetadata(Buffer.from('<svg></svg>          ')), null);
});

test('A1111 parameters: prompt, negative, settings, the model and LoRAs with their hashes', () => {
  const recipe = recipeOf('a1111.png');
  assert.equal(recipe.source, 'a1111');
  assert.equal(recipe.prompt, 'a watercolour fox in a misty forest, soft light', 'LoRA tags leave the prompt');
  assert.equal(recipe.negative, 'blurry, lowres');
  assert.equal(recipe.negativeUsed, true);
  assert.deepEqual(recipe.settings, { steps: 28, cfg: 6.5, width: 832, height: 1216, seed: '1234567890', sampler: 'dpmpp_2m', scheduler: 'karras' });
  assert.deepEqual(recipe.resources.map(({ role, name, hash, strength }) => [role, name, hash, strength]), [
    ['checkpoint', 'dreamshaper_8', '0123456789', undefined],
    ['lora', 'watercolour-v2', 'abcdef0123', 0.8],
    ['lora', 'detail-tweaker', '9876543210', 0.4]
  ]);
  assert.deepEqual(recipe.approximate, []);
  assert.equal(recipe.extraProcessing, false);
});

test('the same A1111 text in a JPEG EXIF UserComment (UTF-16) reads the same', () => {
  const metadata = readImageMetadata(fixture('a1111.jpg'));
  assert.deepEqual([metadata.format, metadata.width, metadata.height], ['jpeg', 64, 48]);
  assert.deepEqual(imageRecipe(metadata), recipeOf('a1111.png'));
});

test('Civitai parameters: exact versions from Civitai resources, approximations named', () => {
  const recipe = recipeOf('civitai.png');
  assert.equal(recipe.source, 'civitai');
  assert.deepEqual(recipe.resources.map(({ role, name, versionId, strength }) => [role, name, versionId, strength]), [['checkpoint', 'Juggernaut XL', 101, undefined], ['lora', 'Film Grain', 202, 0.7]]);
  assert.deepEqual(recipe.settings, { steps: 30, cfg: 4, width: 1024, height: 1024, seed: '42', sampler: 'euler' });
  assert.deepEqual(recipe.approximate, ['No sampling schedule was recorded; the workflow’s default will be used']);
  assert.deepEqual(recipe.warnings, ['CLIP skip 2 needs a matching workflow.']);
});

test('Civitai JSON (an EXIF UserComment or API meta)', () => {
  const recipe = civitaiJsonRecipe(JSON.stringify({ prompt: 'a cat <lora:fur:0.5>', negativePrompt: 'dog', seed: 7, steps: 25, cfgScale: 5, sampler: 'Euler a', 'Schedule type': 'Karras', Size: '768x512', resources: [{ type: 'model', name: 'Base', hash: 'ABCDEF1234' }, { type: 'lora', name: 'fur', hash: '0011223344', weight: 0.5 }], hires_fix: true }));
  assert.equal(recipe.prompt, 'a cat');
  assert.deepEqual(recipe.settings, { steps: 25, cfg: 5, width: 768, height: 512, seed: '7', sampler: 'euler_ancestral', scheduler: 'karras' });
  assert.deepEqual(recipe.resources.map(({ role, hash, strength }) => [role, hash, strength]), [['checkpoint', 'abcdef1234', undefined], ['lora', '0011223344', 0.5]]);
  assert.equal(recipe.extraProcessing, true, 'recorded hires processing');
  assert.equal(civitaiJsonRecipe('{"unrelated": true}'), null);
});

test('ComfyUI prompt graph: text through links, a zeroed negative, sizes and every loader', () => {
  const recipe = recipeOf('comfyui.png');
  assert.equal(recipe.source, 'comfyui');
  assert.equal(recipe.prompt, 'a red bicycle leaning on a stone wall');
  assert.equal(recipe.negative, '');
  assert.equal(recipe.negativeUsed, false, 'ConditioningZeroOut means no negative was used');
  assert.deepEqual(recipe.settings, { steps: 20, cfg: 1, seed: '987654321', sampler: 'euler', scheduler: 'simple', width: 1024, height: 768 });
  assert.deepEqual(recipe.resources.map(({ role, file, strength }) => [role, file, strength]), [
    ['diffusion_model', 'flux1-dev-fp8.safetensors', undefined], ['vae', 'ae.safetensors', undefined],
    ['text_encoder', 't5xxl_fp8_e4m3fn.safetensors', undefined], ['text_encoder', 'clip_l.safetensors', undefined], ['lora', 'film-grain-v3.safetensors', 0.6]
  ]);
});

test('ComfyUI in a WebP (EXIF Make and Model) and a workflow without its prompt graph', () => {
  assert.deepEqual(recipeOf('comfyui.webp'), recipeOf('comfyui.png'));
  const workflow = recipeOf('workflow-only.png');
  assert.equal(workflow.prompt, 'a red bicycle leaning on a stone wall');
  assert.deepEqual(workflow.settings, recipeOf('comfyui.png').settings);
  assert.deepEqual(workflow.resources.map((item) => item.file), ['flux1-dev-fp8.safetensors']);
  assert.equal(workflowGraph('not json'), null);
});

test('SamplerCustomAdvanced graphs read their guider, noise, sampler and sigmas', () => {
  const recipe = comfyRecipe({
    1: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['2', 0], guider: ['3', 0], sampler: ['4', 0], sigmas: ['5', 0], latent_image: ['6', 0] } },
    2: { class_type: 'RandomNoise', inputs: { noise_seed: 11 } },
    3: { class_type: 'CFGGuider', inputs: { cfg: 3.5, positive: ['7', 0], negative: ['8', 0], model: ['9', 0] } },
    4: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'res_multistep' } },
    5: { class_type: 'BasicScheduler', inputs: { scheduler: 'beta', steps: 12, denoise: 1 } },
    6: { class_type: 'EmptyLatentImage', inputs: { width: 640, height: 640, batch_size: 1 } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: ['10', 0] } },
    8: { class_type: 'CLIPTextEncode', inputs: { text: 'ugly' } },
    9: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sdxl/juggernaut.safetensors' } },
    10: { class_type: 'PrimitiveStringMultiline', inputs: { value: 'a castle' } },
    11: { class_type: 'UpscaleModelLoader', inputs: { model_name: '4x.pth' } }
  });
  assert.equal(recipe.prompt, 'a castle');
  assert.equal(recipe.negative, 'ugly');
  assert.deepEqual(recipe.settings, { steps: 12, cfg: 3.5, seed: '11', sampler: 'res_multistep', scheduler: 'beta', width: 640, height: 640 });
  assert.deepEqual(recipe.resources.map(({ role, file }) => [role, file]), [['checkpoint', 'juggernaut.safetensors']]);
  assert.equal(recipe.extraProcessing, true, 'an upscale model is processing Studio can’t redo');
});

test('Studio’s own PNG round-trips: the parameters lead and the graph gives full file names', () => {
  const recipe = recipeOf('studio.png');
  assert.equal(recipe.source, 'studio');
  assert.equal(recipe.prompt, 'a lighthouse at dusk, long exposure');
  assert.deepEqual(recipe.settings, { steps: 20, cfg: 1, seed: '555', sampler: 'euler', scheduler: 'simple', width: 1024, height: 768 });
  const [model, lora] = recipe.resources;
  assert.deepEqual([model.role, model.file, model.hash], ['diffusion_model', 'flux1-dev-fp8.safetensors', '1a2b3c4d5e']);
  assert.deepEqual([lora.role, lora.file, lora.hash, lora.strength], ['lora', 'film-grain-v3.safetensors', '5e4d3c2b1a', 0.6]);
  assert.deepEqual(recipe.resources.slice(2).map((item) => item.file), ['ae.safetensors', 't5xxl_fp8_e4m3fn.safetensors', 'clip_l.safetensors']);
});

test('an image without metadata has no recipe; compressed PNG text still reads', () => {
  assert.equal(recipeOf('plain.png'), null);
  // zTXt: keyword, 0, method, deflated text.
  const png = fixture('plain.png');
  const body = Buffer.concat([Buffer.from('parameters\0\0', 'latin1'), zlib.deflateSync(Buffer.from('a boat\nSteps: 4, Seed: 1, Size: 64x64', 'latin1'))]);
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write('zTXt', 4, 'latin1');
  const at = png.length - 12;
  const zipped = Buffer.concat([png.subarray(0, at), head, body, Buffer.alloc(4), png.subarray(at)]);
  assert.deepEqual(imageRecipe(readImageMetadata(zipped)).settings, { steps: 4, width: 64, height: 64, seed: '1' });
  // iTXt (UTF-8) as withPngText writes non-Latin text.
  const utf = withPngText(png, 'parameters', 'ein Fuchs im Schnee ✨\nSteps: 9');
  assert.equal(imageRecipe(readImageMetadata(utf)).prompt, 'ein Fuchs im Schnee ✨');
});

test('a recipe without a generation size takes the image’s own, and says so', () => {
  const recipe = imageRecipe({ width: 64, height: 48, text: { parameters: 'a dog\nSteps: 5, Seed: 3' } });
  assert.deepEqual([recipe.settings.width, recipe.settings.height], [64, 48]);
  assert.match(recipe.approximate.at(-1), /size is the image’s own/);
});

test('settings lines keep quoted values and JSON whole', () => {
  assert.deepEqual(parseSettingsLine('Steps: 20, Lora hashes: "a: 1, b: 2", Civitai resources: [{"type":"lora","name":"x, y"}], Hashes: {"model": "abc"}, Seed: 5'), {
    Steps: '20', 'Lora hashes': 'a: 1, b: 2', 'Civitai resources': '[{"type":"lora","name":"x, y"}]', Hashes: '{"model": "abc"}', Seed: '5'
  });
  assert.equal(a1111Recipe(''), null);
});

test('A1111 samplers map to ComfyUI’s, and unknown ones are named for a manual choice', () => {
  assert.deepEqual(comfySampling('DPM++ 2M Karras'), { sampler: 'dpmpp_2m', scheduler: 'karras', approximate: [] });
  assert.deepEqual(comfySampling('Euler a', 'SGM Uniform'), { sampler: 'euler_ancestral', scheduler: 'sgm_uniform', approximate: [] });
  assert.deepEqual(comfySampling('Restart', 'Align Your Steps'), { sampler: '', scheduler: '', approximate: ['Sampler “Restart” needs a manual choice', 'Schedule “Align Your Steps” needs a manual choice'] });
  assert.deepEqual(comfySampling('euler'), { sampler: 'euler', scheduler: '', approximate: ['No sampling schedule was recorded; the workflow’s default will be used'] });
});

test('EXIF text tolerates junk and little-endian blocks', () => {
  assert.deepEqual(exifText(Buffer.from('nonsense')), {});
  assert.deepEqual(exifText(null), {});
  // Little-endian TIFF with one ImageDescription.
  const text = Buffer.from('hello\0', 'latin1');
  const tiff = Buffer.alloc(8 + 2 + 12 + 4 + text.length);
  tiff.write('II', 0, 'latin1'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4); tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x010e, 10); tiff.writeUInt16LE(2, 12); tiff.writeUInt32LE(text.length, 14); tiff.writeUInt32LE(26, 18);
  text.copy(tiff, 26);
  assert.deepEqual(exifText(tiff), { imageDescription: 'hello' });
});
