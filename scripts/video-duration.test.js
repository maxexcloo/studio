import assert from 'node:assert/strict';
import test from 'node:test';
import { durationOptions, validVideoFrames } from '../src/app/videoDuration.js';
import { snapInteger } from '../server/validation.js';

const profile = {
  family: 'minimax-h3',
  capabilities: { frames: true },
  constraints: { frames: { default: 124, min: 124, max: 362, offset: 5, step: 17 } }
};

test('old saved frame counts are normalised to the profile bounds and frame grid', () => {
  for (const [saved, expected] of [[33, 124], [143, 141], [999, 362]]) {
    const frames = validVideoFrames(profile, saved);
    assert.equal(frames, expected);
    assert.ok(durationOptions(profile, frames, 24).some((option) => option.value === String(frames)));
    assert.equal(snapInteger(frames, 124, profile.constraints.frames), frames);
  }
});

test('both H3 catalogue family names expose the full trained duration range', () => {
  for (const family of ['minimax-h3', 'minimax_h3']) {
    const options = durationOptions({ ...profile, family }, 124, 24);
    assert.deepEqual(options.map((option) => Number(option.value)), [124, 192, 243, 362]);
    for (const option of options) assert.equal(snapInteger(option.value, 124, profile.constraints.frames), Number(option.value));
  }
});

test('a reused valid frame length remains selected between duration presets', () => {
  assert.ok(durationOptions(profile, 141, 24).some((option) => option.value === '141'));
  assert.equal(durationOptions(profile, 141, 24).find((option) => option.value === '141').label, '5.9 Seconds');
});

test('duration choices follow other models frame ranges and offsets without a 240-frame cap', () => {
  const wan = { family: 'wan', capabilities: { frames: true }, constraints: { frames: { min: 1, max: 401, offset: 1, step: 4 } } };
  const options = durationOptions(wan, 81, 16);
  assert.ok(options.some((option) => Number(option.value) > 240));
  for (const option of options) assert.equal(snapInteger(option.value, 81, wan.constraints.frames), Number(option.value));
  assert.deepEqual(durationOptions({ ...wan, capabilities: { frames: false } }, 81, 16), []);
});
