import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-owned-config-"));
const config = path.join(temporary, "ai");
const data = path.join(temporary, "runtime");
process.env.STUDIO_CONFIG_DIR = config;
process.env.STUDIO_DATA_DIR = data;
process.env.STUDIO_ENABLE_BUILTIN_PROFILES = "0";
process.env.COMFY_URL = "http://127.0.0.1:9";
const write = (root, name, value) => {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};
const rawProfile = {
  heissUi: {
    id: "owned",
    name: "Seed Profile",
    kind: "image",
    nsfw: true,
    controls: { prompt: { node: "1", input: "text" } },
  },
  graph: { 1: { class_type: "CLIPTextEncode", inputs: { text: "" } } },
};
const guides = {
  families: { custom: { image: "owned" } },
  packs: { owned: { name: "Owned", summary: "Seed guidance.", rules: ["Keep the subject."] } },
};
write(config, "profiles/owned.json", rawProfile);
write(config, "profiles/removed.json", {
  ...rawProfile,
  heissUi: { ...rawProfile.heissUi, id: "removed" },
});
write(config, "prompting.json", guides);
write(config, "lora-catalogue.json", { "owned.safetensors": { title: "Seed LoRA", nsfw: true } });
write(config, "models.json", [
  { path: "loras/owned.safetensors", sha256: "a".repeat(64), size: 12 },
]);
const snapshot = (root) =>
  Object.fromEntries(
    fs
      .readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return [path.relative(root, file), fs.readFileSync(file, "utf8")];
      }),
  );
const source = snapshot(config);
const workflows = await import("./custom-workflows.js");
const editor = await import("./profile-editor.js");
const { createProfileStore, createGuideStore, livePrompting } = await import("./profile-store.js");
const { createCatalogueStore } = await import("./library-catalogue.js");
const { seedMissing, seedDirectory } = await import("./profile-seed.js");
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
const quiet = { info() {}, warn() {} };

test("ai seeds runtime definitions once; Studio edits, history and removed IDs survive restart without writing ai", () => {
  const profiles = createProfileStore({ log: quiet });
  profiles.record("removed", "{}", { origin: "seed" });
  assert.equal(seedDirectory(), config);
  assert.equal(workflows.userWorkflowsDir, path.join(data, "workflows"));
  const seeded = seedMissing({
    seedDir: seedDirectory(),
    dataDir: data,
    store: profiles,
    log: quiet,
  });
  assert.deepEqual(seeded.profiles, ["owned"]);
  assert.deepEqual(seeded.skipped, ["removed"]);
  assert.equal(workflows.allCustomWorkflowRecords()[0].name, "Seed Profile");
  const current = editor.readEditableProfile("owned");
  assert.equal(current.blockName, "heissUi");
  const raw = JSON.parse(current.text);
  raw.heissUi.name = "Studio Edit";
  editor.saveEditableProfile("owned", JSON.stringify(raw), { baseHash: current.hash });
  assert.match(editor.readEditableProfile("owned").text, /Studio Edit/);
  assert.equal(profiles.versions("owned").length, 2);
  seedMissing({ seedDir: seedDirectory(), dataDir: data, store: profiles, log: quiet });
  assert.match(editor.readEditableProfile("owned").text, /Studio Edit/);
  assert.equal(fs.existsSync(path.join(data, "workflows", "removed.json")), false);
  assert.deepEqual(snapshot(config), source);
});

test("guides are editable runtime versions and seed merges never replace Studio packs", () => {
  const store = createGuideStore({ log: quiet });
  store.migrate();
  assert.equal(store.configFile(), path.join(data, "guides", "prompting.json"));
  const before = store.pack("owned");
  store.save("owned", { ...before.pack, summary: "Studio guidance." }, { baseHash: before.hash });
  const restarted = createGuideStore({ log: quiet });
  restarted.migrate();
  assert.equal(restarted.pack("owned").pack.summary, "Studio guidance.");
  assert.equal(restarted.versions("owned").length, 2);
  assert.equal(
    livePrompting({ log: quiet })({ family: "custom", kind: "image" }, true).summary,
    "Studio guidance.",
  );
  assert.deepEqual(snapshot(config), source);
});

test("catalogue edits and explicit Original/Finetune classification persist locally and project through Library", async () => {
  const { libraryItems } = await import("./library-routes.js");
  const store = createCatalogueStore({
    dataDir: data,
    environment: { STUDIO_CONFIG_DIR: config },
    log: quiet,
  });
  store.migrate();
  assert.equal(store.entry("loras/owned.safetensors").title, "Seed LoRA");
  store.edit("loras/owned.safetensors", { title: "Studio LoRA", nsfw: false, type: "style" });
  store.edit("checkpoints/base.safetensors", {
    title: "Base",
    description: "Studio model notes.",
    families: ["flux2"],
    modelType: "original",
  });
  const restarted = createCatalogueStore({
    dataDir: data,
    environment: { STUDIO_CONFIG_DIR: config },
    log: quiet,
  });
  assert.equal(restarted.entry("loras/owned.safetensors").title, "Studio LoRA");
  assert.equal(restarted.entry("loras/owned.safetensors").nsfw, false);
  assert.equal(restarted.loraView().catalogue["owned.safetensors"].nsfw, false);
  assert.equal(restarted.loraView().catalogue["owned.safetensors"].type, "style");
  assert.equal(restarted.entry("checkpoints/base.safetensors").modelType, "original");
  const items = libraryItems({ entries: restarted.entries() });
  assert.equal(
    items.find((item) => item.key === "checkpoints/base.safetensors").modelType,
    "original",
  );
  restarted.edit("checkpoints/base.safetensors", { modelType: "finetune" });
  assert.equal(restarted.entry("checkpoints/base.safetensors").modelType, "finetune");
  restarted.undo("checkpoints/base.safetensors");
  assert.equal(restarted.entry("checkpoints/base.safetensors").modelType, "original");
  assert.throws(
    () => restarted.edit("checkpoints/base.safetensors", { modelType: "guessed" }),
    /modelType must/,
  );
  const { buildExport } = await import("./profile-export.js");
  const exported = buildExport({
    workflowsDir: path.join(data, "workflows"),
    profiles: createProfileStore({ log: quiet }),
    guides: createGuideStore({ log: quiet }),
    catalogue: restarted,
  });
  const backup = path.join(temporary, "backup");
  for (const item of exported.files) {
    const target = path.join(backup, item.name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, item.body);
  }
  const backupBefore = snapshot(backup);
  const restoredData = path.join(temporary, "restored");
  seedMissing({
    seedDir: backup,
    dataDir: restoredData,
    store: createProfileStore({ dataDir: restoredData }),
    log: quiet,
  });
  const restored = createCatalogueStore({ dataDir: restoredData, log: quiet });
  assert.equal(restored.entry("checkpoints/base.safetensors").modelType, "original");
  assert.equal(restored.entry("checkpoints/base.safetensors").description, "Studio model notes.");
  assert.deepEqual(restored.entry("checkpoints/base.safetensors").families, ["flux2"]);
  restored.edit("checkpoints/base.safetensors", {
    title: "Restored Studio Edit",
    modelType: "finetune",
  });
  seedMissing({
    seedDir: backup,
    dataDir: restoredData,
    store: createProfileStore({ dataDir: restoredData }),
    log: quiet,
  });
  const reloaded = createCatalogueStore({ dataDir: restoredData, log: quiet });
  assert.equal(reloaded.entry("checkpoints/base.safetensors").title, "Restored Studio Edit");
  assert.equal(reloaded.entry("checkpoints/base.safetensors").modelType, "finetune");
  const existingData = path.join(temporary, "existing");
  createCatalogueStore({ dataDir: existingData, log: quiet }).edit("checkpoints/base.safetensors", {
    title: "Existing Studio Model",
    modelType: "finetune",
  });
  seedMissing({
    seedDir: backup,
    dataDir: existingData,
    store: createProfileStore({ dataDir: existingData }),
    log: quiet,
  });
  const existing = createCatalogueStore({ dataDir: existingData, log: quiet });
  assert.equal(existing.entry("checkpoints/base.safetensors").title, "Existing Studio Model");
  assert.equal(existing.entry("checkpoints/base.safetensors").modelType, "finetune");
  assert.deepEqual(snapshot(backup), backupBefore);
  assert.deepEqual(snapshot(config), source);
});
