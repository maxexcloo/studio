import assert from "node:assert/strict";
import test from "node:test";

import {
  animateProfile,
  dreamFrames,
  dreamVideoProfile,
  startFrameSize,
} from "./animate-profile.js";

const slot = (label) => [{ id: "reference", kind: "image", label }];
const video = (id, label, extra = {}) => ({
  id,
  label,
  kind: "video",
  mediaInputs: slot("Optional First Frame"),
  defaults: { width: 1344, height: 768 },
  constraints: {
    width: { min: 256, max: 2048, step: 32 },
    height: { min: 256, max: 2048, step: 32 },
  },
  ...extra,
});
const grok = video("grok-video", "Grok Video · Cloud", {
  family: "grok",
  provider: "cliproxyapi",
  mediaInputs: slot("Reference Image"),
  defaults: { width: 1280, height: 720, duration: 6 },
  constraints: undefined,
});
const profiles = [
  video("text-video", "Text Video · Fast", { mediaInputs: [] }),
  video("fl-quality", "H3 FL · Quality"),
  video("fl-fast", "H3 FL · Fast"),
  grok,
];
const choose = (options, list = profiles) =>
  animateProfile(list, { defaultId: "fl-quality", width: 1024, height: 1536, ...options });

test("Animate takes the account's Local default, else a local first-frame profile at Fast unless Quality is asked", () => {
  const choice = choose({ localRunning: true });
  assert.equal(choice.profile.id, "fl-fast");
  assert.deepEqual([choice.cloud, choice.note, choice.tier], [false, "", "fast"]);
  assert.deepEqual(choice.size, { width: 832, height: 1248 });
  assert.equal(choose({ localRunning: true, tier: "quality" }).profile.id, "fl-quality");
  assert.deepEqual(choice.offers, { cloud: true, local: true });
  assert.equal(
    choose({ localRunning: true, preferred: { local: "fl-quality" } }).profile.id,
    "fl-quality",
  );
  // A Local default that can't animate gives way to the usual pick.
  assert.equal(choose({ localRunning: true, preferred: { local: "gone" } }).profile.id, "fl-fast");
});

test("Animate prefers available Radiance unless a profile or Cloud preference takes precedence", () => {
  const radiance = video("radiance-motion", "Radiance Motion", { backend: "radiance" });
  const models = [...profiles, radiance];
  const state = { localRunning: true, preferRadiance: true };
  assert.equal(choose(state, models).profile.id, radiance.id);
  assert.equal(choose({ ...state, prefer: "cloud" }, models).profile.id, grok.id);
  const selected = choose({ ...state, prefer: "cloud", profileId: "fl-fast" }, models);
  assert.equal(selected.profile.id, "fl-fast");
  assert.deepEqual(selected.size, { width: 832, height: 1248 });
  const parked = [...profiles, { ...radiance, availability: "parked" }];
  assert.equal(choose(state, parked).profile.id, "fl-fast");
  assert.throws(() => choose({ ...state, profileId: "text-video" }, models), /unavailable/);
});

test("Picking Cloud or Local GPU takes only that pool, and Local refuses rather than fall back", () => {
  // Cloud goes to Grok without a note, even while local video runs.
  const cloud = choose({ localRunning: true, where: "cloud" });
  assert.deepEqual([cloud.profile.id, cloud.note], ["grok-video", ""]);
  assert.equal(choose({ localRunning: true, where: "local" }).profile.id, "fl-fast");
  // A stopped worker refuses with its reason, and the refusal still says what is offered.
  assert.throws(
    () => choose({ localRunning: false, localParked: true, where: "local" }),
    (error) =>
      /^Local video is stopped\.$/.test(error.message) && error.offers.local && error.offers.cloud,
  );
  const offline = profiles.map((p) => (p.family ? p : { ...p, availability: "offline" }));
  assert.throws(
    () => choose({ localRunning: true, where: "local" }, offline),
    /^Error: Local video isn't running\.$/,
  );
  assert.throws(
    () => choose({ localRunning: true, where: "local" }, [grok]),
    (error) => /No local video model/.test(error.message) && !error.offers.local,
  );
});

test("A preferred Cloud runs on Grok, and on the local profile when the account has no Grok", () => {
  const cloud = choose({ localRunning: true, prefer: "cloud" });
  assert.deepEqual([cloud.profile.id, cloud.cloud, cloud.note], ["grok-video", true, ""]);
  const local = choose(
    { localRunning: true, prefer: "cloud" },
    profiles.filter((profile) => profile !== grok),
  );
  assert.deepEqual(
    [local.profile.id, local.note],
    ["fl-fast", "Cloud isn't available to this account, so this runs on H3 FL · Fast."],
  );
});

test("Animate goes to a granted Grok profile while local video is stopped and keeps the source aspect", () => {
  const choice = choose({ localRunning: false, width: 500, height: 1000 });
  assert.equal(choice.profile.id, "grok-video");
  assert.equal(choice.cloud, true);
  assert.equal(choice.note, "Local video isn't running, so this runs on Grok Video · Cloud.");
  assert.deepEqual(choice.size, { width: 679, height: 1358 }, "1:2 at about 1280×720 pixels");
  // Profiles of a worker that did not answer never count as running.
  const offline = profiles.map((p) => (p.family ? p : { ...p, availability: "offline" }));
  assert.equal(choose({ localRunning: true }, offline).profile.id, "grok-video");
});

test("Animate refuses clearly when neither local video nor Grok is available", () => {
  const local = profiles.filter((profile) => profile !== grok);
  assert.throws(
    () => choose({ localRunning: false }, local),
    /^Error: Local video isn't running and cloud video isn't available/,
  );
  assert.throws(
    () => choose({ localRunning: true, where: "cloud" }, local),
    (error) => /Cloud video isn't available/.test(error.message) && !error.offers.cloud,
  );
  assert.throws(
    () => choose({ localRunning: true }, [profiles[0]]),
    /No video model can animate images/,
  );
});

test("A video framed by its start frame draws at the frame's proportions unless the frame only guides", () => {
  const framed = video("fl-fast", "H3 FL · Fast", {
    aspectPolicy: "reference",
    mediaInputs: [
      { id: "reference", kind: "image", role: "start" },
      { id: "end", kind: "image", role: "end" },
    ],
  });
  const run = (extra) => ({
    kind: "video",
    width: 1344,
    height: 768,
    referenceAssets: [{ slot: "reference", width: 683, height: 1024 }],
    ...extra,
  });
  assert.deepEqual(startFrameSize(framed, run()), { width: 832, height: 1248 });
  assert.equal(startFrameSize(framed, run({ referenceRole: "reference" })), null);
  assert.equal(
    startFrameSize(framed, run({ referenceAssets: [{ slot: "end", width: 683, height: 1024 }] })),
    null,
  );
  assert.equal(startFrameSize({ ...framed, aspectPolicy: "manual" }, run()), null);
});

test("Dream videos mix the ready models, stay on their selected side and extend on the source model", () => {
  const dream = (options) =>
    dreamVideoProfile(profiles, {
      backend: "local",
      defaultId: "fl-quality",
      localRunning: true,
      unavailable: new Set(),
      ...options,
    });
  assert.equal(dream().profile.id, "fl-quality");
  const offered = [];
  const chosen = dream({
    choose: (candidates) => {
      offered.push(...candidates.map(({ id }) => id));
      return candidates.at(-1);
    },
  });
  // Every local profile that takes a still is a candidate; text-only and Cloud ones aren't.
  assert.deepEqual(offered, ["fl-quality", "fl-fast"]);
  assert.equal(chosen.profile.id, "fl-fast");
  assert.equal(dream({ unavailable: new Set(["fl-quality"]) }).profile.id, "fl-fast");
  assert.equal(dream({ extend: "fl-fast", choose: () => profiles[1] }).profile.id, "fl-fast");
  assert.equal(dream({ backend: "cloud", localRunning: false }).profile.id, "grok-video");
  assert.throws(() => dream({ extend: "grok-video" }), {
    message: "The source video's model isn't ready.",
  });
  assert.throws(() => dream({ localRunning: false }), { message: "Local video isn't running." });
  assert.throws(
    () => dreamVideoProfile([profiles[1]], { backend: "cloud", unavailable: new Set() }),
    { message: "Cloud video isn't available to this account." },
  );
});

test("Dream clips run 5 to 8 seconds within the profile's frame grid", () => {
  const clip = (frames, fps = 24, grid = { min: 17, max: 161, step: 8, offset: 1 }) =>
    dreamFrames({ defaults: { frames, fps }, constraints: { frames: grid } });
  assert.equal(clip(121), 121);
  assert.equal(clip(49), 121);
  assert.equal(clip(97, 16), 97);
  assert.equal(clip(241, 24, { min: 17, max: 257, step: 8, offset: 1 }), 185);
  assert.equal(clip(97, 24, { min: 17, max: 97, step: 8, offset: 1 }), 97);
  assert.equal(clip(192, 24, { min: 124, max: 345, step: 17, offset: 5 }), 192);
  assert.equal(dreamFrames({ defaults: { duration: 6 } }), undefined);
});

test("A chosen Dream clip length reaches the job and is clamped to the profile's frame grid", () => {
  const profile = {
    id: "video",
    kind: "video",
    defaults: { frames: 121, fps: 24 },
    constraints: { frames: { min: 17, max: 161, step: 8, offset: 1 } },
    inputs: { image: true },
  };
  assert.equal(dreamFrames(profile, 5), 121);
  assert.equal(dreamFrames(profile, 8), 161);
  assert.equal(dreamFrames(profile, 10), 161);
  assert.equal(dreamFrames(profile, 0), 121);
  assert.equal(dreamFrames({ defaults: { duration: 6 } }, 8), undefined);
});
