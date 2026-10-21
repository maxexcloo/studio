import assert from 'node:assert/strict';
import test from 'node:test';
import { asksForCloud, chooseProfile, familyMatches, isCloudProfile, localUnlessAsked, findProfile, nameWords, profileFromRequest, withinFamily, profilesForTier, profilesNearTier, searchProfiles, takesFirstFrame, tierOf } from './mcp-tiers.js';

test('tiers come from the label segment, and untiered labels are standard', () => {
  assert.equal(tierOf({ label: 'Krea 2 Turbo · Super Fast · 2 Steps' }), 'turbo');
  assert.equal(tierOf({ label: 'Qwen-Image 2.1 Turbo · Fast · 8 Steps' }), 'fast');
  assert.equal(tierOf({ label: 'MiniMax H3 · Quality · 50 Steps' }), 'quality');
  assert.equal(tierOf({ label: 'Grok Imagine Video · Standard · Cloud' }), 'standard');
  assert.equal(tierOf({ label: 'Grok Imagine Video 1.5 · Cloud' }), 'standard');
  assert.deepEqual(profilesForTier([{ id: 'a', label: 'A · Quality' }, { id: 'b', label: 'B · Fast' }], 'standard').map(profile => profile.id), ['a']);
});

test('a profile is found by id, then by a unique id or label match ignoring case and punctuation', () => {
  const profiles = [{ id: 'krea-2-turbo', label: 'Krea 2 Turbo · Super Fast · 2 Steps' }, { id: 'krea-2', label: 'Krea 2 · Quality · 30 Steps' }, { id: 'qwen-image', label: 'Qwen-Image · Fast' }];
  assert.equal(findProfile(profiles, 'krea-2')?.id, 'krea-2');
  assert.equal(findProfile(profiles, 'Krea 2 Turbo')?.id, 'krea-2-turbo');
  assert.equal(findProfile(profiles, 'QWEN_image')?.id, 'qwen-image');
  assert.equal(findProfile(profiles, 'qwen')?.id, 'qwen-image', 'a unique partial match');
  assert.equal(findProfile(profiles, 'krea'), null, 'an ambiguous partial match across unknown families finds nothing');
  assert.equal(findProfile(profiles, ''), null);
});

test('the chosen profile prefers the default, then its family, then unrestricted profiles', () => {
  const profiles = [
    { id: 'restricted', label: 'R · Fast', family: 'other', restricted: true },
    { id: 'plain', label: 'P · Fast', family: 'other' },
    { id: 'kin', label: 'K · Fast', family: 'qwen', restricted: true },
    { id: 'default', label: 'D · Quality', family: 'qwen' }
  ];
  // Without a tier, Fast leads; the default's family wins within it.
  assert.equal(chooseProfile(profiles, { kind: 'image', defaultId: 'default' }).id, 'kin');
  assert.equal(chooseProfile(profiles, { kind: 'image', tier: 'quality', defaultId: 'default' }).id, 'default');
  assert.equal(chooseProfile(profiles, { kind: 'image', tier: 'fast', defaultId: 'default' }).id, 'kin');
  assert.equal(chooseProfile(profiles, { kind: 'image', tier: 'fast', defaultId: 'missing' }).id, 'plain');
  // Super Fast falls back to Fast; a tier with neither names what is available.
  assert.equal(chooseProfile(profiles, { kind: 'image', tier: 'turbo', defaultId: 'default' }).id, 'kin');
  assert.throws(() => chooseProfile(profiles.filter(profile => profile.id !== 'default'), { kind: 'image', tier: 'quality' }), /Available image tiers: fast, turbo\./);
  assert.throws(() => chooseProfile([], { kind: 'video' }), /No ready video profile/);
});

test('animating prefers a fast first-frame profile unless a tier is given', () => {
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
  assert.equal(animate({ defaultId: 'fl-quality' }), 'fl-fast');
  assert.equal(animate({ defaultId: 'text', tier: 'quality' }), 'fl-quality');
  // Without a first-frame profile, any profile that takes the image still animates it.
  assert.equal(chooseProfile(profiles.filter(profile => !takesFirstFrame(profile)), { kind: 'video', references: 1, firstFrame: true }).id, 'ref-fast');
});

test('cloud profiles join only when the words ask for Grok or the cloud', () => {
  const local = { id: 'local', kind: 'video', family: 'minimax_h3', label: 'H3 · Fast' };
  const grok = { id: 'grok-video', kind: 'video', family: 'grok', label: 'Grok Video · Cloud' };
  assert.equal(isCloudProfile(grok), true);
  assert.equal(isCloudProfile(local), false);
  assert.deepEqual(localUnlessAsked([local, grok], { request: 'a wave' }).map(profile => profile.id), ['local']);
  // "cloud" as scenery stays local; as a request for the cloud it allows it.
  assert.equal(asksForCloud('a cloud over the hills'), false);
  for (const request of ['a wave, with grok', 'make it in the cloud', 'use a cloud model']) assert.equal(asksForCloud(request), true, request);
  assert.deepEqual(localUnlessAsked([local, grok], { request: 'a wave on Grok' }).map(profile => profile.id), ['local', 'grok-video']);
  assert.deepEqual(localUnlessAsked([local, grok], { name: 'grok-video' }).map(profile => profile.id), ['local', 'grok-video']);
  assert.deepEqual(localUnlessAsked([local, grok], { name: 'h3 fast' }).map(profile => profile.id), ['local']);
});

test('without a tier the order is Fast, Super Fast, Standard, Quality', () => {
  const profiles = [
    { id: 'q', label: 'Q · Quality' },
    { id: 's', label: 'S · Standard' },
    { id: 't', label: 'T · Super Fast' },
    { id: 'f', label: 'F · Fast' }
  ];
  const pick = (list) => chooseProfile(list, { kind: 'image', defaultId: 'q' }).id;
  assert.equal(pick(profiles), 'f');
  assert.equal(pick(profiles.slice(0, 3)), 't');
  assert.equal(pick(profiles.slice(0, 2)), 's');
  assert.equal(pick(profiles.slice(0, 1)), 'q');
  assert.equal(chooseProfile(profiles, { kind: 'image', tier: 'quality' }).id, 'q', 'an explicit tier still wins');
});

test('a family name such as "flux 3" picks its fastest profile, and an exact id still wins', () => {
  const profiles = [
    { id: 'custom:bento-image-flux3-klein-base-int8', label: 'FLUX.3 [klein] Base · Quality · 50 Steps', family: 'flux3_klein' },
    { id: 'custom:bento-image-flux3-klein-distilled-int8', label: 'FLUX.3 [klein] Distilled · Fast · 16 Steps', family: 'flux3_klein' },
    { id: 'flux-2-klein', label: 'Flux.2 Klein 9B · Fast', family: 'flux2_klein' }
  ];
  for (const name of ['flux 3', 'flux3', 'FLUX.3', 'FLUX.3 [klein]', 'flux3 klein']) assert.equal(findProfile(profiles, name)?.id, 'custom:bento-image-flux3-klein-distilled-int8', name);
  assert.equal(findProfile(profiles, 'custom:bento-image-flux3-klein-base-int8')?.id, 'custom:bento-image-flux3-klein-base-int8');
  assert.equal(findProfile(profiles, 'FLUX.3 Base')?.id, 'custom:bento-image-flux3-klein-base-int8', 'every model word matches');
  assert.equal(findProfile(profiles, 'klein'), null, 'matches across families stay ambiguous');
});

// The Bento image catalogue as deployed (ai/config/studio/workflows): id, label and family.
const bento = [
  ['custom:bento-image-boogu-base', 'Boogu Image Base · Quality · 50 Steps · Text Only · FP8 Scaled', 'boogu'],
  ['custom:bento-image-boogu-edit-turbo', 'Boogu Image Edit Turbo · Fast · 4 Steps · 1–3 References', 'boogu'],
  ['custom:bento-image-boogu-edit', 'Boogu Image Edit · Quality · 25 Steps · Single-Reference Edit · INT8 ConvRot', 'boogu'],
  ['custom:bento-image-boogu-turbo', 'Boogu Image Turbo · Fast · 4 Steps · Text Only · INT8 ConvRot · Hotfix (~4s)', 'boogu'],
  ['custom:bento-image-fernwood-v5-int8-fast', 'fernwood V5 · Fast · 8 Steps · Optional Reference · INT8 ConvRot', 'krea2'],
  ['custom:bento-image-fernwood-v5-int8', 'fernwood V5 · Quality · 12 Steps · Optional Reference · INT8 ConvRot', 'krea2'],
  ['custom:bento-image-flux-2-klein-base-9b-fp8', 'FLUX.2 [klein] 9B Base · Quality · 50 Steps · Optional 3 References · FP8', 'flux2_klein_9b'],
  ['custom:bento-image-flux3-klein-base-int8', 'FLUX.3 [klein] Base · Quality · 50 Steps · Optional 10 References · INT8 ConvRot', 'flux3_klein'],
  ['custom:bento-image-flux3-klein-distilled-int8', 'FLUX.3 [klein] Distilled · Fast · 16 Steps · Optional 10 References · INT8 ConvRot (~15s)', 'flux3_klein'],
  ['custom:bento-image-ideogram4-int8-convrot', 'Ideogram 4 · Quality · 20 Steps · JSON Prompt · INT8 ConvRot', 'ideogram4'],
  ['custom:bento-image-klein9b-kv-fp8', 'FLUX.2 [klein] 9B KV · Fast · 4 Steps · Optional Reference · FP8', 'flux2_klein_9b'],
  ['custom:bento-image-krea2-turbo-fast2', 'Krea 2 Turbo · Super Fast · 2 Steps · Text Only · INT8 ConvRot · 2-Step LoRA', 'krea2'],
  ['custom:bento-image-krea2-turbo-int8-convrot', 'Krea 2 Turbo · Quality · 8 Steps · Optional Reference · INT8 ConvRot', 'krea2'],
  ['custom:bento-image-tessera-turbo-w8a8-quality', 'Tessera V0.3.1 Turbo OPD · Quality · 12 Steps · Optional Reference · W8A8', 'krea2'],
  ['custom:bento-image-tessera-turbo-w8a8', 'Tessera V0.3.1 Turbo OPD · Fast · 8 Steps · Optional Reference · W8A8', 'krea2'],
  ['custom:bento-image-tesserafine-turbo-int8-convrot-quality', 'Tesserafine Turbo V1.0 · Quality · 12 Steps · Optional Reference · INT8', 'krea2'],
  ['custom:bento-image-tesserafine-turbo-int8-convrot', 'Tesserafine Turbo V1.0 · Fast · 8 Steps · Optional Reference · INT8', 'krea2'],
  ['custom:bento-image-moss-base-dmd8', 'MOSS Image Base · Fast · 8 Steps · Text Only · INT8 ConvRot · DMD8 LoRA', 'moss_image'],
  ['custom:bento-image-moss-sft', 'MOSS Image SFT · Quality · 50 Steps · Text Only · INT8 ConvRot', 'moss_image'],
  ['custom:bento-image-qwen-image-2-1-int8-convrot', 'Qwen-Image 2.1 · Quality · 40 Steps · Optional 3 References · INT8 ConvRot', 'qwen_image_21'],
  ['custom:bento-image-qwen21-turbo-int8', 'Qwen-Image 2.1 Turbo · Fast · 8 Steps · Optional Reference · INT8 ConvRot', 'qwen_image_21'],
  ['custom:bento-image-radiance-flux3-klein-base', 'FLUX.3 [klein] Base · Quality · 50 Steps · Optional Reference · FP8 · Radiance', 'flux3_klein'],
  ['custom:bento-image-radiance-flux3-klein', 'FLUX.3 [klein] Distilled · Fast · 16 Steps · Optional Reference · FP8 · Radiance', 'flux3_klein'],
  ['custom:bento-image-radiance-krea2-raw', 'Krea 2 Raw · Quality · 28 Steps · Text Only · FP8 · Radiance', 'krea2'],
  ['custom:bento-image-radiance-krea2-turbo', 'Krea 2 Turbo · Fast · 8 Steps · Text Only · FP8 · Radiance', 'krea2'],
  ['custom:bento-image-radiance-vesperq-v4', 'Vesper Q V4 · Quality · 25 Steps · Optional Reference · FP8 · Radiance (~32s)', 'qwen_image_21'],
  ['custom:bento-image-radiance-qwen21', 'Qwen-Image 2.1 · Quality · 40 Steps · Optional Reference · FP8 · Radiance', 'qwen_image_21'],
  ['custom:bento-image-radiance-turbo', 'Qwen-Image 2.1 Turbo Lite · Fast · 8 Steps · Optional Reference · FP8 · Radiance', 'qwen_image_21'],
  ['custom:bento-image-z-image-turbo-int8-convrot', 'Z-Image Turbo · Fast · 8 Steps · Optional Reference · INT8 ConvRot', 'zimage']
].map(([id, label, family]) => ({ id, label, family, kind: 'image' }));

test('on the Bento catalogue, turbo lists Super Fast then the distilled Fast profiles, and model words find FLUX.3', () => {
  const tiers = Object.fromEntries(bento.map(profile => [profile.id.replace('custom:bento-image-', ''), tierOf(profile)]));
  assert.equal(tiers['krea2-turbo-fast2'], 'turbo');
  assert.equal(tiers['flux3-klein-distilled-int8'], 'fast');
  assert.equal(tiers['flux3-klein-base-int8'], 'quality');
  const turbo = profilesNearTier(bento, 'turbo').map(profile => profile.id);
  assert.equal(turbo[0], 'custom:bento-image-krea2-turbo-fast2', 'Super Fast leads');
  assert.ok(turbo.includes('custom:bento-image-flux3-klein-distilled-int8'));
  assert.ok(!turbo.includes('custom:bento-image-flux3-klein-base-int8'));
  assert.deepEqual(profilesNearTier(bento, 'fast').slice(0, 2).map(tierOf), ['fast', 'fast']);
  for (const name of ['turbo flux 3', 'flux 3 turbo', 'flux3', 'FLUX.3', 'fast flux 3', 'FLUX.3 [klein] distilled']) assert.equal(findProfile(bento, name)?.id, 'custom:bento-image-flux3-klein-distilled-int8', name);
  assert.equal(findProfile(bento, 'flux 3 quality')?.id, 'custom:bento-image-flux3-klein-base-int8');
  // From LibreChat: the first try named the Radiance runtime too.
  for (const name of ['turbo radiance flux 3', 'radiance flux3 fast', 'Radiance FLUX.3 [klein]']) assert.equal(findProfile(bento, name)?.id, 'custom:bento-image-radiance-flux3-klein', name);
  assert.equal(findProfile(bento, 'radiance flux 3 quality')?.id, 'custom:bento-image-radiance-flux3-klein-base');
  assert.equal(findProfile(bento, 'krea 2 turbo super fast')?.id, 'custom:bento-image-krea2-turbo-fast2');
  assert.equal(findProfile(bento, 'turbo klein'), null, 'speed words never choose between families');
  assert.equal(findProfile(bento, 'tesserafine')?.id, 'custom:bento-image-tesserafine-turbo-int8-convrot', 'one family resolves to its Fast profile');
  assert.equal(findProfile(bento, 'klein'), null, 'FLUX.2 and FLUX.3 both say klein');
  const klein = searchProfiles(bento, 'klein');
  assert.deepEqual(new Set(klein.map(profile => profile.family)), new Set(['flux3_klein', 'flux2_klein_9b']));
  assert.equal(tierOf(klein[0]), 'fast', 'fastest first');
  assert.deepEqual(searchProfiles(bento, 'turbo'), [], 'speed words alone name no model');
  assert.deepEqual(nameWords('FLUX.3 [klein]'), ['flux3', 'klein']);
  assert.deepEqual(nameWords('flux 3'), ['flux3']);
});

test('the family decides and speed words only choose within it: "moss turbo" is MOSS, never Boogu Turbo', () => {
  // MOSS has no Super Fast profile; Boogu has "Turbo" in its labels, which must not win.
  assert.equal(findProfile(bento, 'moss turbo')?.id, 'custom:bento-image-moss-base-dmd8');
  assert.equal(findProfile(bento, 'turbo moss')?.id, 'custom:bento-image-moss-base-dmd8');
  assert.equal(findProfile(bento, 'moss quality')?.id, 'custom:bento-image-moss-sft');
  assert.equal(findProfile(bento, 'turbo radiance flux 3')?.id, 'custom:bento-image-radiance-flux3-klein');
  assert.equal(findProfile(bento, 'flux 3 quality')?.id, 'custom:bento-image-flux3-klein-base-int8');
  assert.equal(findProfile(bento, 'krea turbo')?.id, 'custom:bento-image-krea2-turbo-fast2', "turbo is the family's fastest");
  // An explicit tier the family lacks takes its nearest tier, with a note; never another family.
  const moss = bento.find(profile => profile.id === 'custom:bento-image-moss-sft');
  const moved = withinFamily(bento, moss, 'turbo');
  assert.equal(moved.profile.id, 'custom:bento-image-moss-base-dmd8');
  assert.equal(moved.note, 'MOSS Image Base has no Super Fast profile; used MOSS Image Base · Fast · 8 Steps · Text Only · INT8 ConvRot · DMD8 LoRA. Tell the user. ');
  assert.deepEqual(withinFamily(bento, moss, 'quality'), { profile: moss, note: '' });
  assert.equal(withinFamily(bento, moss, 'fast').note, '', 'an exact tier needs no note');
  // A miss lists the family the name points at, not unrelated models.
  assert.deepEqual(familyMatches(bento, 'moss xl turbo').map(profile => profile.id), ['custom:bento-image-moss-base-dmd8', 'custom:bento-image-moss-sft']);
  assert.deepEqual(familyMatches(bento, 'sdxl turbo'), []);
});

test('a model named only in the request ("six baby ducks, fast moss") is used when profile_id is missing', () => {
  const pick = (request, tier) => profileFromRequest(bento, request, tier)?.profile.id;
  assert.equal(pick('six individual photos of baby ducks, fast moss'), 'custom:bento-image-moss-base-dmd8');
  assert.equal(pick('baby ducks with MOSS', 'quality'), 'custom:bento-image-moss-sft');
  assert.equal(pick('a cat, tesserafine'), 'custom:bento-image-tesserafine-turbo-int8-convrot', "a model's own name narrows within its family");
  assert.equal(pick('a fox, turbo radiance flux 3'), 'custom:bento-image-radiance-flux3-klein');
  assert.equal(pick('a cat on Z-Image'), 'custom:bento-image-z-image-turbo-int8-convrot');
  assert.equal(pick('a fast red car at night'), undefined, 'no model named');
  assert.equal(pick('flux portrait'), undefined, 'FLUX.2 and FLUX.3 are both flux');
  assert.equal(pick('moss or qwen, a pond'), undefined, 'two families named');
  assert.match(profileFromRequest(bento, 'ducks, moss', 'turbo').note, /^Used MOSS Image Base · Fast .*, the model the request names\. MOSS Image Base has no Super Fast profile/);
});

// Access tiers above media: the admin tools (mcp-admin.js) and who gets them (mcp.js adminScope).
test('admin tools go to administrator accounts by their own token, and through the gateway only with the switch on', async () => {
  const { adminScope } = await import('./mcp.js');
  const administrator = { userId: 'a', role: 'administrator', authenticated: true };
  const user = { userId: 'u', role: 'user', authenticated: true };
  assert.equal(adminScope({ account: administrator }), true, 'a direct administrator MCP token');
  assert.equal(adminScope({ account: user }), false, 'an ordinary account');
  assert.equal(adminScope({ account: null }), false, 'the shared key without an account');
  assert.equal(adminScope({ account: administrator, gateway: true }), false, 'a gateway-linked administrator, switch off by default');
  assert.equal(adminScope({ account: administrator, gateway: true, gatewayAdminTools: () => true }), true, 'with Chat Gateway Admin Tools on');
  assert.equal(adminScope({ account: user, gateway: true, gatewayAdminTools: () => true }), false, 'never an ordinary gateway account');
  assert.equal(adminScope({ account: { ...administrator, authenticated: false } }), false);
});
