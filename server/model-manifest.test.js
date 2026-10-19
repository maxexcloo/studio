import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-manifest-"));
process.env.HEISS_DATA_DIR = path.join(root, "data");
process.env.HEISS_COMFY_ROOT = path.join(root, "comfy");
process.env.STUDIO_MODEL_MANIFEST_PREFIX = "models/comfyui/";
const models = path.join(root, "comfy", "models");
const write = (relative, content) => { const file = path.join(models, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file; };
const entry = (relative, content, extra = {}) => ({ path: `models/comfyui/${relative}`, sha256: crypto.createHash("sha256").update(content).digest("hex"), size: Buffer.byteLength(content), ...extra });

write("loras/good.safetensors", "good");
write("vae/changed.safetensors", "tampered!");
write("vae/short.safetensors", "abc");
const manifest = [
  entry("loras/good.safetensors", "good"),
  entry("vae/changed.safetensors", "original!"),
  entry("vae/short.safetensors", "abcdef"),
  entry("loras/missing.safetensors", "gone", { url: "https://huggingface.co/org/repo/resolve/abc/missing.safetensors" }),
  entry("loras/style/nested.safetensors", "nested", { url: "https://huggingface.co/org/repo/resolve/abc/nested.safetensors" }),
  entry("SEEDVR2/model.safetensors", "seed", { url: "https://huggingface.co/org/repo/resolve/abc/model.safetensors" }),
  entry("loras/no-url.safetensors", "private"),
  { path: "models/radiance/model.rad", sha256: "a".repeat(64), size: 10 }
];
fs.writeFileSync(path.join(root, "models.json"), JSON.stringify(manifest));
process.env.STUDIO_MODEL_MANIFEST = path.join(root, "models.json");
const store = await import("./model-manifest.js");
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("the manifest reports present, missing, wrong-size, external and restorable entries", () => {
  const status = store.manifestStatus();
  assert.equal(status.source, "deployment");
  assert.equal(status.total, 8);
  const by = Object.fromEntries(status.items.map((item) => [item.path.replace("models/comfyui/", ""), item]));
  assert.equal(by["loras/good.safetensors"].status, "present");
  assert.equal(by["vae/short.safetensors"].status, "wrong-size");
  assert.equal(by["loras/missing.safetensors"].restorable, true);
  assert.match(by["loras/style/nested.safetensors"].restoreNote, /subfolder/);
  assert.match(by["SEEDVR2/model.safetensors"].restoreNote, /doesn't download into SEEDVR2/);
  assert.match(by["loras/no-url.safetensors"].restoreNote, /No download address/);
  assert.equal(by["models/radiance/model.rad"].status, "external");
  assert.equal(status.restorable, 1);
});

test("verification hashes present files once and flags mismatches", async () => {
  store.startVerify();
  for (let attempt = 0; attempt < 100 && store.manifestStatus().verify.running; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  const by = Object.fromEntries(store.manifestStatus().items.map((item) => [item.path.replace("models/comfyui/", ""), item.status]));
  assert.equal(by["loras/good.safetensors"], "verified");
  assert.equal(by["vae/changed.safetensors"], "mismatch");
  // A changed file is unverified again.
  write("loras/good.safetensors", "good");
  fs.utimesSync(path.join(models, "loras/good.safetensors"), new Date(), new Date(Date.now() + 5000));
  assert.equal(store.manifestStatus().items.find((item) => item.path.endsWith("good.safetensors")).status, "present");
});

test("imports replace the deployment manifest until reset, and bad entries are refused", () => {
  assert.throws(() => store.importManifest([{ path: "../escape", sha256: "a".repeat(64), size: 1 }]), /missing a safe path/);
  assert.throws(() => store.importManifest({}), /JSON list/);
  assert.equal(store.importManifest(manifest.slice(0, 2)), 2);
  assert.equal(store.manifestStatus().source, "imported");
  assert.equal(store.manifestStatus().total, 2);
  store.clearImportedManifest();
  assert.equal(store.manifestStatus().source, "deployment");
});
