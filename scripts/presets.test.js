import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { outputProfile } from '../src/app/outputReuse.js';

const source = fs.readFileSync(new URL('../src/app/presets.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { presetFit } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('split diffusion imports associate exact installed weights rather than an unrelated family workflow', () => {
  const item = { type: 'image', model: 'recorded.safetensors', civitai: { resources: [{ folder: 'diffusion_models', file: 'recorded.safetensors', status: 'missing' }] } };
  const profiles = [{ id: 'other', kind: 'image', family: 'qwen_image_21', model: 'other.safetensors' }, { id: 'exact', kind: 'image', family: 'qwen_image_21', model: 'recorded.safetensors' }];
  assert.equal(outputProfile(profiles, item).id, 'exact');
  assert.equal(outputProfile(profiles.slice(0, 1), item), undefined);
});

test('preset application blocks unavailable architectures and missing source encoders', () => {
  const preset = { prompt: 'A landscape', negative: '', settings: {}, warnings: [], resources: [{ folder: 'diffusion_models', file: 'model.safetensors', profileId: 'exact' }, { folder: 'text_encoders', file: 'encoder.safetensors' }] };
  const profile = { id: 'exact', ready: false, capabilities: {} };
  const blocked = presetFit(preset, profile);
  assert.ok(blocked.blockers.some((message) => /compatible model parts or ComfyUI nodes/.test(message)));
  assert.ok(blocked.blockers.some((message) => /source text encoders/.test(message)));
  const ready = presetFit({ ...preset, resources: preset.resources.map((resource) => ({ ...resource, localName: resource.file })) }, { ...profile, ready: true });
  assert.deepEqual(ready.blockers, []);
});
