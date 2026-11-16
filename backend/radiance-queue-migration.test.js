import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { Store, everyone } from "./domain/store.ts";
import { migrateRadianceQueue } from "./radiance-queue-migration.js";

const workers = [{ id: "radiance", backend: "radiance", capabilities: ["image", "video"] }];
const profile = () => ({
  defaults: { model: "qwen-image-2.1-iq8r" },
  graph: { 1: { class_type: "RadianceImageGenerate", inputs: { model: "qwen-image-2.1-iq8r" } } },
});
function setup(t) {
  const store = new Store(new DatabaseSync(":memory:"));
  t.after(() => store.close());
  const session = store.createSession("owner", "Own conversation", {
    mcp: { conversationId: "conversation" },
  });
  const input = {
    kind: "image",
    workflow: "custom:qwen",
    model: "custom:qwen",
    profileId: "custom:qwen",
    modelName: "qwen-image-2.1-fp8.rad",
    prompt: "Exact user prompt",
    referenceAssets: [{ slot: "one", assetId: "asset" }],
    writing: { model: "llm", instruction: "Keep this" },
  };
  const job = store.enqueue(
    "owner",
    session.id,
    input,
    "generate",
    undefined,
    "worker:primary",
    undefined,
    { queueBatch: "batch", queueSet: "set", parentItemId: "source" },
  );
  return { store, job: store.job("owner", job.id) };
}

test("a held drained queue migrates exact model/worker fields while retaining every identity and user field", (t) => {
  const { store, job } = setup(t);
  store.setPaused(everyone, true);
  const options = { workers, profile };
  const plan = migrateRadianceQueue(store, options);
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(store.job("owner", job.id), job, "dry run writes nothing");
  assert.equal(
    migrateRadianceQueue(store, { ...options, apply: true, baseHash: plan.hash }).applied,
    true,
  );
  const next = store.job("owner", job.id);
  assert.deepEqual(
    { ...next, updatedAt: job.updatedAt },
    {
      ...job,
      input: { ...job.input, modelName: "qwen-image-2.1-iq8r" },
      backend: "radiance",
      resource: "worker:radiance",
    },
  );
  assert.deepEqual(store.session("owner", job.sessionId).mcp, { conversationId: "conversation" });
});

test("no pause, accepted work, changed snapshots and unknown explicit models block the entire apply", (t) => {
  const { store, job } = setup(t);
  const options = { workers, profile, apply: true };
  assert.match(migrateRadianceQueue(store, options).conflicts.join(" "), /Hold dispatch/);
  store.setPaused(everyone, true);
  const plan = migrateRadianceQueue(store, { workers, profile });
  store.save({ ...job, input: { ...job.input, modelName: "unknown-fp8.rad" } });
  const unknown = migrateRadianceQueue(store, { ...options, baseHash: plan.hash });
  assert.match(unknown.conflicts.join(" "), /unknown modelName/);
  assert.match(unknown.conflicts.join(" "), /queue changed/);
  store.save({ ...job, status: "running", providerJobId: "accepted" });
  const active = migrateRadianceQueue(store, options);
  assert.match(active.conflicts.join(" "), /Finish all accepted/);
  assert.equal(active.applied, false);
  assert.equal(store.job("owner", job.id).providerJobId, "accepted");
});

test("an explicit model choice cannot silently become a profile's other model", (t) => {
  const { store, job } = setup(t);
  store.setPaused(everyone, true);
  store.save({
    ...job,
    input: { ...job.input, modelName: "noctq-v4-uncensored-fp8.rad" },
  });
  const plan = migrateRadianceQueue(store, { workers, profile });
  assert.match(plan.conflicts.join(" "), /explicit model noctq-v4-iq8r differs/);
  assert.equal(plan.applied, false);
});
