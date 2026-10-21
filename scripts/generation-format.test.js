import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/app/format.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  // A data URL has no base for relative imports, so point format.ts's one helper import at its file.
  .replace("from './partNames'", `from '${new URL('../src/app/partNames.js', import.meta.url)}'`);
const { assistantSummary, fullGenerationText, generationDetailEntries, settingsText } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const item = {
  type: 'video', model: 'custom:grok-video-standard', prompt: 'A hot-air balloon', width: 1280, height: 720,
  settings: { modelName: 'grok-imagine-video', steps: 20, cfg: 8, sampler: 'euler', scheduler: 'simple', seed: '397422498', duration: 6, resolution: '720p' }
};

test('legacy Grok outputs hide unused diffusion fields in summaries, copies and detail rows', () => {
  const labels = generationDetailEntries(item).flatMap((section) => section.rows.map(([label]) => label));
  for (const label of ['Steps', 'CFG', 'Sampler', 'Scheduler']) assert.ok(!labels.includes(label));
  assert.ok(labels.includes('Duration'));
  assert.ok(labels.includes('Resolution'));
  for (const text of [settingsText(item), fullGenerationText(item)]) assert.doesNotMatch(text, /(?:Steps|CFG|Sampler|Scheduler):/i);
  assert.match(settingsText(item), /grok-imagine-video/);
  assert.match(settingsText(item), /1280×720/);
});

test('diffusion model metadata retains the sampling fields', () => {
  const diffusion = { ...item, settings: { ...item.settings, modelName: 'flux-dev.safetensors' } };
  const labels = generationDetailEntries(diffusion).flatMap((section) => section.rows.map(([label]) => label));
  for (const label of ['Steps', 'CFG', 'Sampler', 'Scheduler']) assert.ok(labels.includes(label));
  assert.match(settingsText(diffusion), /Steps: 20.*CFG: 8.*Sampler: euler \(simple\)/);
  assert.match(fullGenerationText(diffusion), /steps: 20/);
});


test('Radiance references do not advertise unsupported denoise settings', () => {
  const reference = { type: 'image', referenceImage: 'reference', settings: { modelName: 'qwen-image.rad', denoise: 0.6 } };
  assert.doesNotMatch(settingsText(reference), /Denoise:/);
  assert.ok(!generationDetailEntries(reference).flatMap((section) => section.rows.map(([label]) => label)).includes('Denoise'));
  const ordinary = { ...reference, settings: { ...reference.settings, modelName: 'qwen.safetensors' } };
  assert.match(settingsText(ordinary), /Denoise:/);
});

test('Details say when the prompt assistant wrote the prompt, and which suggested LoRAs were chosen', () => {
  const written = { type: 'image', prompt: 'A cabin', width: 512, height: 512, settings: {}, assistant: { preset: 'cinematic', source: 'chat', lorasSuggested: ['styles/glow.safetensors'] } };
  assert.equal(assistantSummary(written), 'Assistant in Chat · Cinematic');
  assert.equal(assistantSummary({ assistant: { preset: 'enhance', source: 'ui' } }), 'Assistant · Enhance');
  assert.equal(assistantSummary({}), '');
  const prompt = generationDetailEntries(written, { lora: (file) => file === 'styles/glow.safetensors' ? 'Glow' : file }).find((section) => section.title === 'Prompt');
  assert.deepEqual(prompt.rows, [['Suggested LoRAs', 'Glow'], ['Written By', 'Assistant in Chat · Cinematic']]);
  assert.equal(generationDetailEntries({ ...written, assistant: undefined }).some((section) => section.title === 'Prompt'), false);
});
