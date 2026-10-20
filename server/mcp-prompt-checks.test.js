import assert from 'node:assert/strict';
import test from 'node:test';
import { exactPromptInstructions, fullBodyPerson } from './mcp-prompt-checks.js';

test('a full-body or wide shot of a person counts; portraits and empty scenes do not', () => {
  for (const prompt of [
    'Full body photo of a woman in a red coat on a city street',
    'A full-length portrait of a man in a tuxedo',
    'Wide shot of a couple walking on the beach at dusk',
    'long shot, two girls on a bridge',
    'A fashion model shown head to toe against a white wall',
    'A boy standing in a field of sunflowers',
    'People standing at a bus stop in the rain'
  ]) assert.equal(fullBodyPerson(prompt), true, prompt);
  for (const prompt of [
    'Close-up portrait of a woman with freckles',
    'Wide shot of a mountain valley at sunrise',
    'A lighthouse standing on a cliff',
    'Headshot of a man in a suit',
    ''
  ]) assert.equal(fullBodyPerson(prompt), false, prompt);
});

test('an exact prompt with generation instructions is refused with the count to pass', () => {
  const refusal = exactPromptInstructions('Generate five distinct amateur-snapshot variations of this scene, each with a different angle: a woman reading in a café');
  assert.match(refusal, /^exact_prompt is for a finished prompt only/);
  assert.match(refusal, /count: 5 \(1–10 per call\)/);
  assert.match(refusal, /"five distinct amateur-snapshot variations"/);
  assert.match(exactPromptInstructions('Make 3 images of a red fox in snow'), /count: 3 /);
  assert.match(exactPromptInstructions('A red fox in snow. Please create two versions'), /count: 2 /);
  assert.match(exactPromptInstructions('Four candid variations: a red fox in snow'), /count: 4 /);
  // Without a number the refusal still says to pass count.
  assert.match(exactPromptInstructions('Variations of this scene: a red fox in snow'), /count \(the number of images\)/);
  assert.match(exactPromptInstructions('Same mood of this scene: a red fox in snow'), /exact_prompt is for a finished prompt only/);
  // Each clear meta-instruction is refused on its own.
  for (const [prompt, count] of [
    ['Generate 4 photos of a lighthouse at night', 4],
    ['Create six pictures of a quiet harbour', 6],
    ['make two different versions of a red fox in snow', 2],
    ['Generate me three images of a cat', 3],
    ['Eight variations, a red fox in snow', 8],
    ['A red fox in snow, a few variations please', 0],
    ['A red fox in snow, of this scene', 0]
  ]) assert.match(exactPromptInstructions(prompt), count ? new RegExp(`count: ${count} `) : /count \(the number of images\)/, prompt);
});

test('finished prompts pass as exact prompts', () => {
  for (const prompt of [
    'A red fox in snow, soft morning light, 35mm film',
    'Three friends laughing at a dinner table, candid snapshot',
    'Two cats on a sofa',
    'A woman making five pancakes in a sunny kitchen',
    'An egg, exactly',
    'Create two cats on a sofa',
    'Make a red car at dusk',
    'Generate a lighthouse on a cliff at night',
    'Make three dogs run across a beach',
    'Two variants of tulips in a vase',
    'A woman holding two photos of her family',
    'Variation in light across a mountain ridge'
  ]) assert.equal(exactPromptInstructions(prompt), '', prompt);
});
