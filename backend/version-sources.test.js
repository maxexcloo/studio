import assert from "node:assert/strict";
import test from "node:test";

import { isVersion, versionPromptOverlap } from "../shared/versions.ts";

const source = { input: { profileId: "sdxl", prompt: "a red fox in the snow at dawn" } };

test("a run from a result's settings is a version on any model while it keeps most of the prompt", () => {
  const run = (input) => ({ operation: "image", input: { ...source.input, ...input } });
  assert.equal(versionPromptOverlap, 0.5);
  assert.equal(isVersion(run({ prompt: "a red fox in the snow at dusk" }), source), true);
  assert.equal(isVersion(run({ prompt: "a castle on a hill under stars" }), source), false);
  assert.equal(isVersion(run({ profileId: "flux" }), source), true);
  // Edits and animations work on the result itself, whatever their prompt.
  assert.equal(
    isVersion({ operation: "refine", input: { prompt: "make it night" } }, source),
    true,
  );
});
