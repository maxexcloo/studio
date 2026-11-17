import assert from "node:assert/strict";
import test from "node:test";

import type { GenerationInput, MediaItem, Profile } from "../../types";
import { lengthChoices } from "../generation/length.ts";
import { generationInput } from "../generation/payload.ts";
import { animationInput, retainedAnimationProfile } from "./animateLength.ts";

const input = {
  kind: "video",
  profileId: "",
  prompt: "A bird",
  fps: 24,
  frames: 81,
  steps: 8,
  referenceAssets: [],
  width: 1024,
  height: 1024,
} as unknown as GenerationInput;
const local = {
  id: "h3",
  kind: "video",
  label: "Motion Quality",
  model: "h3",
  workflow: "h3",
  family: "minimax-h3",
  ready: true,
  defaults: { frames: 192, fps: 24, steps: 8 },
  capabilities: { frames: true, fps: false },
  constraints: { frames: { min: 124, max: 362, step: 17, offset: 5 } },
  mediaInputs: [{ id: "first", role: "start" }],
} as Profile;
const cloud = {
  ...local,
  id: "cloud",
  provider: "cliproxyapi",
  defaults: { duration: 6, steps: 1 },
  capabilities: { duration: true, frames: false, fps: false },
  constraints: { duration: { min: 1, max: 15, step: 1 } },
} as Profile;

test("Length uses the selected profile's seconds or offset frame grid without changing steps", () => {
  assert.equal(animationInput(input, cloud, 10).duration, 10);
  const next = animationInput(input, local, 10);
  assert.equal(next.frames, 243);
  assert.equal(next.fps, 24);
  assert.equal(next.steps, 8);
  const choices = lengthChoices(next, local)!;
  assert.equal(choices.value, "243");
  assert.ok(choices.data.some((option) => option.value === "243" && option.label === "10s"));
  assert.ok(choices.data.every((option) => (Number(option.value) - 5) % 17 === 0));
  assert.ok(
    choices.data.every((option) => Number(option.value) >= 124 && Number(option.value) <= 362),
  );
});

test("unsupported remembered lengths use the new profile's default and fixed controls stay disabled", () => {
  assert.equal(animationInput(input, local, 3).frames, 192);
  assert.equal(animationInput(input, cloud, 30).duration, 6);
  assert.equal(animationInput(input, local, null).frames, 192);
  for (const fixed of [
    { ...local, capabilities: { frames: false } },
    { ...local, constraints: { frames: { min: 192, max: 192 } } },
    { ...local, defaults: { ...local.defaults, fps: 0 } },
  ]) {
    assert.equal(lengthChoices(animationInput(input, fixed, 10), fixed), null);
    assert.equal(animationInput(input, fixed, 10).frames, 192);
  }
});

test("reference mode and the reference-capable backend own timing and limits", () => {
  const reference = { ...local, imageModes: { reference: { defaults: { fps: 30, frames: 243 } } } };
  assert.equal(animationInput(input, reference, 8).frames, 243);
  assert.equal(animationInput(input, reference, 8).fps, 30);
  const combined = {
    ...cloud,
    backend: "cloud",
    backendOptions: [
      { id: "cloud", label: "Cloud", references: 0, profile: cloud },
      { id: "local", label: "Local", references: 1, profile: local },
    ],
  };
  assert.equal(animationInput(input, combined, 10).frames, 243);
});

test("extending keeps its exact profile or alias on Fast and Quality; Cloud and unavailable profiles resolve anew", () => {
  const item = {
    id: "clip",
    url: "sample.mp4",
    status: "done",
    type: "video",
    model: "other",
    settings: { profileId: "old-h3" },
  } as MediaItem;
  const own = { ...local, aliases: ["old-h3"] };
  assert.equal(retainedAnimationProfile([cloud, own], item, "local"), own);
  assert.equal(retainedAnimationProfile([cloud, own], item), own);
  assert.equal(retainedAnimationProfile([cloud, own], item, "cloud"), undefined);
  assert.equal(retainedAnimationProfile([{ ...own, ready: false }], item, "local"), undefined);
  assert.equal(retainedAnimationProfile([own], { ...item, type: "image" }, "local"), undefined);
});

test("prepared review and queued input share timing, exact reference slots and source lineage", () => {
  const references = [
    { id: "source-frame", slot: "first", galleryItemId: "source", strength: 0.7 },
  ];
  for (const profile of [local, cloud]) {
    const prepared = animationInput(input, profile, 10);
    const writing = generationInput(prepared, profile, references as never);
    const queued = generationInput(
      { ...prepared, prompt: "Reviewed bird motion" },
      profile,
      references as never,
    );
    for (const key of [
      "duration",
      "frames",
      "fps",
      "steps",
      "profileId",
      "referenceAssets",
      "referenceDetails",
    ] as const)
      assert.deepEqual(
        (queued as Record<string, unknown>)[key],
        (writing as Record<string, unknown>)[key],
      );
    assert.deepEqual(queued.referenceAssets, [
      { assetId: "source-frame", slot: "first", strength: 0.7 },
    ]);
    assert.equal(queued.referenceDetails[0].galleryItemId, "source");
  }
});
