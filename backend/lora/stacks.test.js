import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-loras-"));
process.env.STUDIO_DATA_DIR = dir;
const {
  applyLoraOps,
  clearLoraState,
  forgetLora,
  loadLoraLibrary,
  loadLoraStack,
  saveLoraLibrary,
  saveLoraStack,
} = await import("./stacks.js");
const { runtimeDatabase } = await import("../persistence/runtime.ts");
const { Store } = await import("../domain/store.ts");
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("account LoRA stacks and library state use separate files from each other and legacy state", () => {
  clearLoraState("account-a");
  clearLoraState("account-b");
  saveLoraLibrary({ ratings: { "private-a.safetensors": "up" } }, "account-a");
  saveLoraLibrary({ ratings: { "private-b.safetensors": "down" } }, "account-b");
  assert.deepEqual(loadLoraLibrary("account-a").ratings, { "private-a.safetensors": "up" });
  assert.deepEqual(loadLoraLibrary("account-b").ratings, { "private-b.safetensors": "down" });
  assert.equal(loadLoraLibrary()?.ratings["private-a.safetensors"], undefined);
});

test("replayed ratings are harmless", () => {
  clearLoraState();
  applyLoraOps([
    { op: "rating", name: "a", rating: "up" },
    { op: "rating", name: "a", rating: "up" },
    { op: "rating", name: "b", rating: "down" },
    { op: "rating", name: "b", rating: null },
  ]);
  assert.deepEqual(loadLoraLibrary().ratings, { a: "up" });
});

test("a stale whole-library save merges instead of wiping newer ratings", () => {
  clearLoraState();
  applyLoraOps([{ op: "rating", name: "a", rating: "up" }]);
  const library = saveLoraLibrary({
    ratings: { a: "down", b: "down" },
    strengths: {},
    recents: [],
  });
  assert.deepEqual(library.ratings, { a: "up", b: "down" });
});

test("strengths, recents and the active stack all apply", () => {
  clearLoraState();
  applyLoraOps([
    { op: "strengths", workflowId: "krea2", values: { "b.safetensors": 0.9 } },
    { op: "strengths", workflowId: "krea2", values: { "c.safetensors": 1.1 } },
    { op: "recents", names: ["b.safetensors"] },
    {
      op: "active",
      workflowId: "krea2",
      loras: [
        { name: "b.safetensors", strength: 0.9 },
        { name: "c.safetensors", strength: 1, triggers: false },
      ],
    },
  ]);
  assert.deepEqual(
    loadLoraStack("krea2").map((item) => item.triggers),
    [true, false],
  );
  const library = loadLoraLibrary();
  assert.deepEqual(library.strengths.krea2, { "b.safetensors": 0.9, "c.safetensors": 1.1 });
  assert.deepEqual(library.recents, ["b.safetensors"]);
  assert.equal(loadLoraStack("krea2")[0].strength, 0.9);
});

test("a removed LoRA leaves every account's stacks, strengths, ratings, recents and presets", () => {
  clearLoraState("account-c");
  saveLoraStack("fast", [{ name: "gone.safetensors" }, { name: "kept.safetensors" }], "account-c");
  saveLoraLibrary(
    {
      strengths: { fast: { "gone.safetensors": 0.5 } },
      ratings: { "gone.safetensors": "up" },
      recents: ["gone.safetensors", "kept.safetensors"],
    },
    "account-c",
  );
  const presets = new Store(runtimeDatabase(dir));
  const preset = presets.createPreset("account-c", "Saved", {
    loras: [{ name: "gone.safetensors", strength: 1 }],
  });
  forgetLora("gone.safetensors");
  assert.deepEqual(presets.presets("account-c")[0], { ...preset, input: { loras: [] } });
  assert.deepEqual(
    loadLoraStack("fast", "account-c").map((item) => item.name),
    ["kept.safetensors"],
  );
  const library = loadLoraLibrary("account-c");
  assert.deepEqual(
    [library.strengths.fast, library.ratings, library.recents],
    [undefined, {}, ["kept.safetensors"]],
  );
});

test("workflows left empty drop out of the library", () => {
  clearLoraState();
  const library = saveLoraLibrary({
    strengths: { "custom:image-boogu-base": {}, fast: { "a.safetensors": 0.5 } },
  });
  assert.deepEqual(library.strengths, { fast: { "a.safetensors": 0.5 } });
});
