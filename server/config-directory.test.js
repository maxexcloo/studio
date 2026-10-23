import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-mounted-config-"));
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
  heissUi: { id: "owned", name: "AI-Owned Profile", kind: "image", nsfw: true, controls: {} },
  graph: {},
};
const guides = {
  families: { custom: { image: "owned" } },
  packs: { owned: { name: "Owned", summary: "Mounted guidance.", rules: ["Keep the subject."] } },
};
write(config, "profiles/owned.json", rawProfile);
write(config, "prompting.json", guides);
write(config, "lora-catalogue.json", {
  "owned.safetensors": { title: "AI-Owned LoRA", nsfw: true },
});
write(config, "models.json", [
  { path: "loras/owned.safetensors", sha256: "a".repeat(64), size: 12 },
]);
write(data, "workflows/owned.json", {
  ...rawProfile,
  heissUi: { ...rawProfile.heissUi, name: "Stale Runtime Profile" },
});
write(data, "guides/prompting.json", {
  ...guides,
  packs: { owned: { name: "Old", summary: "Stale runtime guidance." } },
});
write(data, "library/catalogue.json", {
  version: 1,
  entries: { "loras/stale.safetensors": { title: "Stale" } },
  layers: {},
  signatures: {},
  edits: {
    "loras/owned.safetensors": {
      fields: { title: "Stale Runtime Title", nsfw: false },
      aiDrafted: true,
    },
    "loras/removed.safetensors": { fields: { title: "Removed" } },
  },
});

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
const originalConfig = snapshot(config);
const originalRuntime = snapshot(data);
const workflows = await import("./custom-workflows.js");
const editor = await import("./profile-editor.js");
const { createProfileStore, createGuideStore, livePrompting } = await import("./profile-store.js");
const { createCatalogueStore } = await import("./library-catalogue.js");
const { seedMissing } = await import("./profile-seed.js");
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
const quiet = { info() {}, warn() {} };

test("profiles and NSFW metadata read from the ai root without changing either tree", () => {
  assert.equal(workflows.userWorkflowsDir, path.join(config, "profiles"));
  const records = workflows.allCustomWorkflowRecords();
  assert.deepEqual(
    records.map((record) => [record.id, record.name, record.nsfw]),
    [["owned", "AI-Owned Profile", true]],
  );
  assert.match(editor.readEditableProfile("owned").text, /AI-Owned Profile/);
  const store = createProfileStore({ log: quiet });
  assert.deepEqual(store.migrate(), { profiles: 0, versions: 0 });
  store.markExported({ owned: "hash" });
  assert.deepEqual(snapshot(config), originalConfig);
  assert.deepEqual(snapshot(data), originalRuntime);
});

test("mounted guides replace runtime guides and all guide edits are refused before writing", () => {
  const store = createGuideStore({
    seedFile: path.join(data, "guides/prompting.json"),
    log: quiet,
  });
  assert.equal(store.pack("owned").pack.summary, "Mounted guidance.");
  assert.equal(store.configFile(), path.join(config, "prompting.json"));
  assert.equal(
    livePrompting({ log: quiet })({ family: "custom", kind: "image" }, true).summary,
    "Mounted guidance.",
  );
  assert.deepEqual(store.migrate(), { packs: 1, versions: 0 });
  for (const operation of [
    () => store.save("owned", {}),
    () => store.approve("owned"),
    () => store.bind("custom:owned", "owned"),
    () => store.revert("owned", 1),
  ]) {
    assert.throws(operation, { status: 409 });
  }
  store.markExported({ owned: "hash" });
  assert.deepEqual(snapshot(config), originalConfig);
  assert.deepEqual(snapshot(data), originalRuntime);
});

test("every profile creation, import, deletion, edit, approval and restoration path is read-only", () => {
  for (const operation of [
    () => workflows.saveCustomWorkflow(rawProfile),
    () => workflows.saveImportedWorkflow(rawProfile),
    () => workflows.deleteImportedWorkflow("owned"),
    () => editor.createEditableProfile("new", "{}"),
    () => editor.saveEditableProfile("owned", "{}"),
    () => editor.approveEditableProfile("owned"),
    () => editor.revertEditableProfile("owned", 1),
    () => createProfileStore().record("owned", "{}"),
    () => createProfileStore().approve("owned"),
  ])
    assert.throws(operation, { status: 409 });
  assert.deepEqual(
    seedMissing({ seedDir: config, dataDir: data, store: createProfileStore(), log: quiet }),
    { profiles: [], config: [], kept: 0, skipped: [] },
  );
  assert.deepEqual(snapshot(config), originalConfig);
  assert.deepEqual(snapshot(data), originalRuntime);
});

test("mounted catalogue ignores stale runtime edits and cache, including NSFW and removed definitions", () => {
  const store = createCatalogueStore({
    dataDir: data,
    environment: { STUDIO_CONFIG_DIR: config },
    log: quiet,
  });
  assert.equal(store.migrate(), true);
  const entry = store.entry("loras/owned.safetensors");
  assert.deepEqual(
    [entry.title, entry.nsfw, entry.aiDrafted, entry.sha256],
    ["AI-Owned LoRA", true, undefined, "a".repeat(64)],
  );
  assert.equal(store.entry("loras/removed.safetensors"), null);
  assert.equal(store.entry("loras/stale.safetensors"), null);
  assert.deepEqual(store.loraView().catalogue["owned.safetensors"], {
    title: "AI-Owned LoRA",
    nsfw: true,
  });
  for (const operation of [
    () => store.edit("loras/owned.safetensors", { title: "Changed" }),
    () => store.undo("loras/owned.safetensors"),
    () => store.approve("loras/owned.safetensors"),
  ])
    assert.throws(operation, { status: 409 });
  assert.deepEqual(snapshot(config), originalConfig);
  assert.deepEqual(snapshot(data), originalRuntime);
});

test("mounted catalogue refreshes changed owner definitions and reports missing required files", () => {
  const directory = fs.mkdtempSync(path.join(temporary, "refresh-"));
  write(directory, "lora-catalogue.json", { "first.safetensors": { title: "First" } });
  write(directory, "models.json", []);
  const store = createCatalogueStore({
    dataDir: data,
    environment: { STUDIO_CONFIG_DIR: directory },
    log: quiet,
  });
  assert.equal(store.entry("loras/first.safetensors").title, "First");
  write(directory, "lora-catalogue.json", {
    "second.safetensors": { title: "Second Owner Definition" },
  });
  assert.equal(store.entry("loras/first.safetensors"), null);
  assert.equal(store.entry("loras/second.safetensors").title, "Second Owner Definition");
  fs.rmSync(path.join(directory, "models.json"));
  assert.throws(() => store.entries(), /Cannot read mounted configuration .*models\.json/);
});

test("a missing mounted guide never falls back to stale runtime or an explicit legacy seed", () => {
  const file = path.join(config, "prompting.json");
  const content = fs.readFileSync(file);
  const readGuide = livePrompting({ log: quiet });
  fs.rmSync(file);
  try {
    const store = createGuideStore({
      seedFile: path.join(data, "guides/prompting.json"),
      log: quiet,
    });
    assert.equal(store.configFile(), file);
    assert.throws(() => store.pack("owned"), { code: "ENOENT" });
    assert.throws(() => livePrompting({ log: quiet }), { code: "ENOENT" });
    assert.equal(
      readGuide({ family: "custom", kind: "image" }, true).summary,
      "Mounted guidance.",
      "a running loader retains its last good mounted guide during a failed reload",
    );
  } finally {
    fs.writeFileSync(file, content);
  }
});
