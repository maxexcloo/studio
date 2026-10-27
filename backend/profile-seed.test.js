import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { samplesDirectory, seedSamples } from "./profile-seed.js";
import { createProfileStore } from "./profile-store.js";

const quiet = { info: () => {}, warn: () => {} };
const scratch = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-seed-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const samples = fs
  .readdirSync(samplesDirectory)
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.slice(0, -5))
  .sort();

test("the samples seed an empty data folder once, as Studio's own versioned profiles", (t) => {
  const data = scratch(t);
  const store = createProfileStore({ dataDir: data, log: quiet });
  assert.ok(samples.length);
  assert.deepEqual(seedSamples({ dataDir: data, store, log: quiet }), samples);
  for (const id of samples) {
    assert.ok(fs.existsSync(path.join(data, "workflows", `${id}.json`)));
    assert.equal(store.meta(id).origin, "seed");
  }
  // Removing every profile in Studio never brings the samples back.
  fs.rmSync(path.join(data, "workflows"), { recursive: true });
  assert.deepEqual(seedSamples({ dataDir: data, store, log: quiet }), []);
});

test("a data folder that holds a profile gets no samples", (t) => {
  const data = scratch(t);
  fs.mkdirSync(path.join(data, "workflows"));
  fs.writeFileSync(path.join(data, "workflows", "own.json"), "{}");
  const store = createProfileStore({ dataDir: data, log: quiet });
  assert.deepEqual(seedSamples({ dataDir: data, store, log: quiet }), []);
  assert.deepEqual(fs.readdirSync(path.join(data, "workflows")), ["own.json"]);
});
