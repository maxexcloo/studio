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

test("Animate takes the default local first-frame profile while local video runs", () => {
  const choice = choose({ localRunning: true });
  assert.equal(choice.profile.id, "fl-quality");
  assert.equal(choice.cloud, false);
  assert.equal(choice.note, "");
  assert.deepEqual(choice.size, { width: 832, height: 1248 });
  // A default that cannot take the image gives way to the usual first-frame pick; a tier narrows it.
  assert.equal(choose({ localRunning: true, defaultId: "text-video" }).profile.id, "fl-fast");
  assert.equal(choose({ localRunning: true, tier: "fast" }).profile.id, "fl-fast");
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
