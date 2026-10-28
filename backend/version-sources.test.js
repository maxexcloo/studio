import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RewriteStore } from "./domain/store.ts";
import { versionSources } from "./version-sources.js";
import { isVersion, versionPromptOverlap } from "../shared/versions.ts";

const source = { input: { profileId: "sdxl", prompt: "a red fox in the snow at dawn" } };

test("a run from a result's settings is a version only with the same profile and most of the prompt", () => {
  const run = (input) => ({ operation: "image", input: { ...source.input, ...input } });
  assert.equal(versionPromptOverlap, 0.5);
  assert.equal(isVersion(run({ prompt: "a red fox in the snow at dusk" }), source), true);
  assert.equal(isVersion(run({ prompt: "a castle on a hill under stars" }), source), false);
  assert.equal(isVersion(run({ profileId: "flux" }), source), false);
  // Edits and animations work on the result itself, whatever their prompt.
  assert.equal(
    isVersion({ operation: "refine", input: { prompt: "make it night" } }, source),
    true,
  );
});

test("versions regroup by recorded source after a dry run, with a backup, once", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-version-sources-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = new RewriteStore(path.join(dataDir, "studio.sqlite"));
  const session = store.createSession("", "Chat", {});
  const enqueue = (input, operation = "image", parent) =>
    store.enqueue("", session.id, input, operation, parent);
  const first = enqueue(source.input);
  store.db
    .prepare("UPDATE studio_queue SET record = json_set(record, '$.items', json(?)) WHERE id = ?")
    .run(JSON.stringify([{ id: "fox" }]), first.id);
  // A Chat edit of the fox, a later Chat turn that only followed it, and one that changed it all.
  const edit = enqueue(
    { ...source.input, prompt: "make it night", referenceAssets: [{ assetId: "fox" }] },
    "refine",
    first.id,
  );
  enqueue({ ...source.input, prompt: "a lighthouse" }, "image", first.id);
  enqueue({ prompt: "a castle", referenceAssets: [{ assetId: "fox" }] }, "image", first.id);
  store.db.close();

  const plan = versionSources(dataDir);
  assert.equal(plan.applied, false);
  assert.equal(plan.recorded.length, 2);
  assert.deepEqual(plan.recorded[0], { id: edit.id, parentItemId: "fox" });
  assert.equal(plan.ungrouped, 1);
  assert.equal(plan.derived, 1);

  const result = versionSources(dataDir, { apply: true });
  const backup = JSON.parse(fs.readFileSync(path.join(result.backup, "studio_queue.json"), "utf8"));
  assert.equal(backup.length, 2);
  const after = new RewriteStore(path.join(dataDir, "studio.sqlite"));
  assert.equal(after.job("", edit.id).parentItemId, "fox");
  after.db.close();
  assert.deepEqual(versionSources(dataDir).recorded, []);
});
