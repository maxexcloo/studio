import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseProfile, profilesForTier, summaryOf, takesFirstFrame, tierOf } from './mcp-tiers.js';

test('tiers come from the label segment, and untiered labels are standard', () => {
  assert.equal(tierOf({ label: 'Krea 2 Turbo · Super Fast · 2 Steps' }), 'turbo');
  assert.equal(tierOf({ label: 'Qwen-Image 2.1 Turbo · Fast · 8 Steps' }), 'fast');
  assert.equal(tierOf({ label: 'MiniMax H3 · Quality · 50 Steps' }), 'quality');
  assert.equal(tierOf({ label: 'Grok Imagine Video · Standard · Cloud' }), 'standard');
  assert.equal(tierOf({ label: 'Grok Imagine Video 1.5 · Cloud' }), 'standard');
  assert.deepEqual(profilesForTier([{ id: 'a', label: 'A · Quality' }, { id: 'b', label: 'B · Fast' }], 'standard').map(profile => profile.id), ['a']);
});

test('summaries keep the first sentence within a line', () => {
  assert.equal(summaryOf({ description: 'Generate draft previews from text. Small faces lose detail.' }), 'Generate draft previews from text.');
  assert.equal(summaryOf({ description: 'x'.repeat(200) }).length, 120);
});

test('the chosen profile prefers the default, then its family, then unrestricted profiles', () => {
  const profiles = [
    { id: 'restricted', label: 'R · Fast', family: 'other', restricted: true },
    { id: 'plain', label: 'P · Fast', family: 'other' },
    { id: 'kin', label: 'K · Fast', family: 'qwen', restricted: true },
    { id: 'default', label: 'D · Quality', family: 'qwen' }
  ];
  assert.equal(chooseProfile(profiles, { kind: 'image', defaultId: 'default' }).id, 'default');
  assert.equal(chooseProfile(profiles, { kind: 'image', tier: 'fast', defaultId: 'default' }).id, 'kin');
  assert.equal(chooseProfile(profiles, { kind: 'image', tier: 'fast', defaultId: 'missing' }).id, 'plain');
  assert.throws(() => chooseProfile(profiles, { kind: 'image', tier: 'turbo' }), /Available image tiers: quality, standard, fast\./);
  assert.throws(() => chooseProfile([], { kind: 'video' }), /No ready video profile/);
});

test('animating prefers a fast first-frame profile unless a tier or a first-frame default is given', () => {
  const frame = [{ id: 'reference', kind: 'image', label: 'Optional First Frame' }];
  const reference = [{ id: 'reference', kind: 'image', label: 'Reference Image' }];
  // Shaped like the Bento H3 catalogue: Ref2VA, FL2VA and text-only profiles across tiers.
  const profiles = [
    { id: 'ref-fast', label: 'H3 Ref · Fast · 8 Steps', family: 'h3', mediaInputs: reference },
    { id: 'fl-quality', label: 'H3 FL · Quality · 20 Steps', family: 'h3', mediaInputs: frame },
    { id: 'tuned-quality', label: 'H3 Tuned · Quality · 20 Steps', family: 'h3', restricted: true, mediaInputs: frame },
    { id: 'fl-fast', label: 'H3 FL · Fast · 8 Steps', family: 'h3', mediaInputs: frame },
    { id: 'text', label: 'H3 · Quality · 50 Steps', family: 'h3', mediaInputs: [] }
  ];
  assert.equal(takesFirstFrame(profiles[1]), true);
  assert.equal(takesFirstFrame(profiles[0]), false);
  assert.equal(takesFirstFrame({ mediaInputs: [{ id: 'reference', role: 'start', label: 'Start image' }] }), true);
  const animate = (options) => chooseProfile(profiles, { kind: 'video', references: 1, firstFrame: true, ...options }).id;
  assert.equal(animate({ defaultId: 'text' }), 'fl-fast');
  assert.equal(animate({ defaultId: 'ref-fast' }), 'fl-fast');
  assert.equal(animate({ defaultId: 'fl-quality' }), 'fl-quality');
  assert.equal(animate({ defaultId: 'text', tier: 'quality' }), 'fl-quality');
  // Without a first-frame profile, any profile that takes the image still animates it.
  assert.equal(chooseProfile(profiles.filter(profile => !takesFirstFrame(profile)), { kind: 'video', references: 1, firstFrame: true }).id, 'ref-fast');
});
