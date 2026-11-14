import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Store } from "./domain/store.ts";
import {
  closeRuntimeDatabase,
  ownerDocumentName,
  readRuntimeDocument,
  runtimeDatabase,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";
import { stackPresets } from "./stack-presets.js";

test("stackPresets turns saved LoRA stacks into LoRA presets with unique names", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-stack-presets-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const store = new Store(runtimeDatabase(dataDir));
  store.createPreset("alice", "Portrait", { prompt: "A face" });
  writeRuntimeDocument(dataDir, "accounts", { accounts: [{ id: "alice" }] });
  const loras = [
    { name: "detail.safetensors", strength: 0.35, enabled: false, triggers: ["fine"] },
    { name: "soft.safetensors", strength: 0.65, enabled: true, triggers: true },
  ];
  const ratings = { "soft.safetensors": "up" };
  writeRuntimeDocument(dataDir, ownerDocumentName("lora-stacks", "alice"), {
    stacks: { fast: loras },
    library: {
      ratings,
      snapshots: {
        "family:flux": [
          { id: "a", name: "Portrait", loras, savedAt: "2026-11-01T00:00:00.000Z" },
          { id: "b", name: "test", loras: [] },
          { id: "c", name: "test", loras: [] },
        ],
      },
    },
  });
  writeRuntimeDocument(dataDir, ownerDocumentName("lora-stacks", "gone"), {
    library: { snapshots: { "family:flux": [{ id: "d", name: "Lost", loras }] } },
  });

  const plan = stackPresets(dataDir);
  assert.deepEqual(
    { accounts: plan.accounts, stacks: plan.stacks, orphaned: plan.orphaned.length },
    { accounts: 1, stacks: 3, orphaned: 1 },
  );
  assert.equal(store.presets("alice").length, 1, "a dry run changes nothing");

  assert.equal(stackPresets(dataDir, { apply: true }).applied, true);
  const presets = store.presets("alice").reverse();
  assert.deepEqual(
    presets.map(({ title, parts, family }) => ({ title, parts, family })),
    [
      { title: "Portrait", parts: undefined, family: undefined },
      { title: "Portrait 2", parts: ["loras"], family: "flux" },
      { title: "test", parts: ["loras"], family: "flux" },
      { title: "test 2", parts: ["loras"], family: "flux" },
    ],
  );
  assert.deepEqual(presets[1].input, { loras });
  assert.equal(presets[1].savedAt, "2026-11-01T00:00:00.000Z");
  const state = readRuntimeDocument(dataDir, ownerDocumentName("lora-stacks", "alice"));
  assert.deepEqual(state, { stacks: { fast: loras }, library: { ratings } });
  assert.equal(stackPresets(dataDir).stacks, 0, "a second run finds nothing");
});
