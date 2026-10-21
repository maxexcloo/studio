import assert from "node:assert/strict";
import test from "node:test";
import { retireFeatureSwitches } from "./feature-options.js";

const sources = (map) => (key) => ({ source: map[key] || "default" });

test("a switch saved from Settings moves into the access profiles and leaves .env", () => {
  const removed = [];
  let globals = null;
  const keys = retireFeatureSwitches({
    multiUser: true,
    source: sources({ STUDIO_ENABLE_LORAS: "studio", STUDIO_ENABLE_GROK: "deployment" }),
    env: { STUDIO_ENABLE_LORAS: "0", STUDIO_ENABLE_GROK: "0" },
    migrate: (value) => { globals = value; return true; },
    remove: (key) => removed.push(key)
  });
  // The deployment's own value stays as the lock and is not written into profiles.
  assert.deepEqual(globals, { loras: false });
  assert.deepEqual(keys, ["STUDIO_ENABLE_LORAS"]);
  assert.deepEqual(removed, ["STUDIO_ENABLE_LORAS"]);
});

test("nothing moves in single-user mode or once the profiles have it", () => {
  const removed = [];
  const run = (multiUser, migrated) => retireFeatureSwitches({ multiUser, source: sources({ STUDIO_ENABLE_GROK: "studio" }), env: { STUDIO_ENABLE_GROK: "0" }, migrate: () => migrated, remove: (key) => removed.push(key) });
  assert.deepEqual(run(false, true), []);
  assert.deepEqual(run(true, false), []);
  assert.deepEqual(removed, []);
});

test("defaults count as on, so no profile loses a feature", () => {
  let globals = null;
  retireFeatureSwitches({ multiUser: true, source: sources({}), env: {}, migrate: (value) => { globals = value; return true; }, remove: () => assert.fail("nothing to remove") });
  assert.deepEqual(globals, { loras: true, cloudModels: true });
});
