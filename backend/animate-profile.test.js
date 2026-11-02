import assert from "node:assert/strict";
import test from "node:test";
import { animateProfile } from "./animate-profile.js";

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

test("Animate takes a local first-frame profile, Fast unless Quality is asked, while local video runs", () => {
  const choice = choose({ localRunning: true });
  assert.equal(choice.profile.id, "fl-fast");
  assert.deepEqual([choice.cloud, choice.note, choice.tier], [false, "", "fast"]);
  assert.deepEqual(choice.tiers, ["fast", "quality"]);
  assert.deepEqual(choice.size, { width: 832, height: 1248 });
  assert.equal(choose({ localRunning: true, tier: "quality" }).profile.id, "fl-quality");
  // With one first-frame profile there is no choice: every tier takes it.
  const one = profiles.filter((profile) => profile.id !== "fl-fast");
  assert.equal(choose({ localRunning: true }, one).profile.id, "fl-quality");
  assert.deepEqual(choose({ localRunning: true }, one).tiers, []);
  // Asking for Grok goes to Grok without a note.
  assert.deepEqual(
    [choose({ localRunning: true, cloud: true }).profile.id, choose({ cloud: true }).note],
    ["grok-video", ""],
  );
});

test("Animate goes to a granted Grok profile while local video is stopped, at an aspect Grok takes", () => {
  const choice = choose({ localRunning: false });
  assert.equal(choice.profile.id, "grok-video");
  assert.equal(choice.cloud, true);
  assert.equal(choice.note, "Local video isn't running, so this runs on Grok Video · Cloud.");
  assert.deepEqual(choice.size, { width: 784, height: 1176 }, "2:3 at 1280×720 pixels");
  // Profiles of a worker that did not answer never count as running.
  const offline = profiles.map((p) => (p.family ? p : { ...p, availability: "offline" }));
  assert.equal(choose({ localRunning: true }, offline).profile.id, "grok-video");
});

test("Animate refuses clearly when neither local video nor Grok is available", () => {
  const local = profiles.filter((profile) => profile !== grok);
  assert.throws(
    () => choose({ localRunning: false }, local),
    /^Error: Local video isn't running and this account has no Grok access \(Cloud Models\)/,
  );
  assert.throws(() => choose({ localRunning: true, cloud: true }, local), /no Grok video profile/);
  assert.throws(
    () => choose({ localRunning: true }, [profiles[0]]),
    /No video profile that takes a starting image/,
  );
});
