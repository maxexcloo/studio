import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-loras-"));
process.env.STUDIO_DATA_DIR = dir;
const { applyLoraOps, clearLoraState, forgetLora, loadLoraLibrary } = await import("./stacks.js");
const { ownerDocumentName, readRuntimeDocument, runtimeDatabase } =
  await import("../persistence/runtime.ts");
const { Store } = await import("../domain/store.ts");
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("account LoRA ratings use separate files", () => {
  clearLoraState("account-a");
  clearLoraState("account-b");
  applyLoraOps([{ op: "rating", name: "private-a.safetensors", rating: "liked" }], "account-a");
  applyLoraOps([{ op: "rating", name: "private-b.safetensors", rating: "disliked" }], "account-b");
  assert.deepEqual(loadLoraLibrary("account-a").ratings, { "private-a.safetensors": "liked" });
  assert.deepEqual(loadLoraLibrary("account-b").ratings, { "private-b.safetensors": "disliked" });
  assert.equal(loadLoraLibrary()?.ratings["private-a.safetensors"], undefined);
  // The saved ratings predate Like.
  assert.deepEqual(
    readRuntimeDocument(dir, ownerDocumentName("lora-stacks", "account-b")).library.ratings,
    { "private-b.safetensors": "down" },
  );
});

test("replayed ratings are harmless", () => {
  clearLoraState();
  applyLoraOps([
    { op: "rating", name: "a", rating: "liked" },
    { op: "rating", name: "a", rating: "liked" },
    { op: "rating", name: "b", rating: "disliked" },
    { op: "rating", name: "b", rating: null },
  ]);
  assert.deepEqual(loadLoraLibrary().ratings, { a: "liked" });
});

test("a removed LoRA leaves every account's ratings and presets", () => {
  clearLoraState("account-c");
  applyLoraOps(
    [
      { op: "rating", name: "gone.safetensors", rating: "liked" },
      { op: "rating", name: "kept.safetensors", rating: "disliked" },
    ],
    "account-c",
  );
  const presets = new Store(runtimeDatabase(dir));
  const preset = presets.createPreset("account-c", "Saved", {
    loras: [{ name: "gone.safetensors", strength: 1 }],
  });
  forgetLora("gone.safetensors");
  assert.deepEqual(presets.presets("account-c")[0], { ...preset, input: { loras: [] } });
  assert.deepEqual(loadLoraLibrary("account-c").ratings, { "kept.safetensors": "disliked" });
});
