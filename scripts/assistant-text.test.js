import assert from 'node:assert/strict';
import test from 'node:test';
import { insertTriggers, missingTriggers, removeTriggers, saysAny, stillWritten } from '../src/app/assistantText.js';

test('a suggested LoRA puts its missing triggers at the start, once', () => {
  assert.deepEqual(insertTriggers('a cabin at dusk', ['glowfx', 'neon style']), { prompt: 'glowfx, neon style, a cabin at dusk', inserted: ['glowfx', 'neon style'] });
  assert.deepEqual(insertTriggers('a GLOWFX cabin', ['glowfx']), { prompt: 'a GLOWFX cabin', inserted: [] });
  assert.deepEqual(insertTriggers('', ['glowfx']).prompt, 'glowfx');
  assert.deepEqual(missingTriggers('glowfx, a cabin', ['glowfx', ' ', 'mist']), ['mist']);
});

test('Remove Trigger Words takes the words and their commas, nothing else', () => {
  assert.equal(removeTriggers('glowfx, neon style, a cabin at dusk', ['glowfx', 'neon style']), 'a cabin at dusk');
  assert.equal(removeTriggers('a cabin, glowfx, at dusk', ['glowfx']), 'a cabin, at dusk');
  assert.equal(removeTriggers('a cabin at dusk, glowfx', ['glowfx']), 'a cabin at dusk');
  assert.equal(removeTriggers('glowfxy cabin', ['glowfx']), 'glowfxy cabin', 'only whole words');
  assert.equal(saysAny('A Glowfx cabin', ['glowfx']), true);
});

test('a prompt counts as the assistant’s while most of its words remain', () => {
  assert.equal(stillWritten('A cabin at dusk, warm light', 'A cabin at dusk with warm light'), true);
  assert.equal(stillWritten('A lighthouse', 'A cabin at dusk with warm light'), false);
  assert.equal(stillWritten('', 'A cabin'), false);
});
