import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCatalogueStore } from "./library-catalogue.js";

const hex = (digit) => digit.repeat(64);
const quiet = { info: () => {}, warn: () => {} };
const families = ({ base_model: base }) => (/krea/i.test(base) ? ["krea2"] : []);

/** A data folder holding every older catalogue file, with a model file whose hash is cached. */
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-catalogue-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  };
  write("config/lora-catalogue.json", {
    "style.safetensors": {
      title: "Seed Style",
      baseModel: "Krea 2",
      triggers: ["seedword"],
      note: "Strength 0.7",
      sourceUrl: "https://civitai.com/models/1?modelVersionId=2",
      tags: ["a", "b"],
      promptStyle: "tags",
    },
    "seed-only.safetensors": { title: "Seed Only", baseModel: "Krea 2" },
  });
  write("lora-catalogue.json", {
    "style.safetensors": {
      title: "Admin Style",
      strengthRange: { min: 0, max: 2, step: 0.1, default: 0.9 },
    },
  });
  write("model-download-sources.json", {
    "civitai:2:3": {
      id: "civitai:2:3",
      file: "style.safetensors",
      folder: "loras",
      label: "Provider Style",
      version: "v2",
      baseModel: "Krea 2",
      sourceUrl: "https://civitai.com/models/1?modelVersionId=2",
      trainedWords: ["providerword"],
      sha256: hex("a"),
      bytes: 1024,
      url: "https://civitai.com/api/download/models/2",
    },
  });
  const modelFile = path.join(dir, "comfy", "models", "vae", "ae.safetensors");
  fs.mkdirSync(path.dirname(modelFile), { recursive: true });
  fs.writeFileSync(modelFile, "vae");
  const stat = fs.statSync(modelFile);
  write("model-hashes.json", {
    [`${modelFile}|${stat.size}|${stat.mtimeMs}`]: hex("c"),
    [`${modelFile}|1|1`]: hex("d"),
  });
  write("config/models.json", [
    {
      path: "models/comfyui/vae/ae.safetensors",
      sha256: hex("b"),
      size: 3,
      url: "https://huggingface.co/org/repo/resolve/abc/ae.safetensors",
    },
    { path: "models/comfyui/checkpoints/base.safetensors", sha256: hex("e"), size: 9 },
    { path: "models/comfyui/SEEDVR2/upscaler.safetensors", sha256: hex("f"), size: 9 },
  ]);
  const environment = { STUDIO_MODEL_MANIFEST_PREFIX: "models/comfyui/" };
  return {
    dir,
    environment,
    store: () =>
      createCatalogueStore({
        dataDir: dir,
        environment,
        familiesFromMetadata: families,
        log: quiet,
      }),
  };
}

const snapshot = (dir) =>
  Object.fromEntries(
    [
      "config/lora-catalogue.json",
      "lora-catalogue.json",
      "model-download-sources.json",
      "model-hashes.json",
      "config/models.json",
    ].map((name) => [name, fs.readFileSync(path.join(dir, name), "utf8")]),
  );

test("the migration merges every older file by folder/file with provenance, the more specific source winning", (t) => {
  const f = fixture(t);
  const before = snapshot(f.dir);
  const store = f.store();
  assert.equal(store.migrate(), true);
  const entries = store.entries();
  assert.deepEqual(
    Object.keys(entries),
    [
      "checkpoints/base.safetensors",
      "loras/seed-only.safetensors",
      "loras/style.safetensors",
      "vae/ae.safetensors",
    ],
    "only model folders; SEEDVR2 stays in the manifest",
  );
  const style = entries["loras/style.safetensors"];
  assert.deepEqual(
    [style.kind, style.title, style.origin, style.baseModel, style.families],
    ["lora", "Admin Style", "admin", "Krea 2", ["krea2"]],
    "the admin file over the seed",
  );
  assert.deepEqual(style.triggers, ["seedword"], "catalogue triggers over provider trained words");
  assert.deepEqual(style.strength, { default: 0.9, min: 0, max: 2, step: 0.1 });
  assert.deepEqual(
    [style.sha256, style.bytes, style.version],
    [hex("a"), 1024, "v2"],
    "provider hashes and sizes",
  );
  assert.deepEqual(style.source, { provider: "civitai", modelId: 1, versionId: 2, fileId: 3 });
  assert.deepEqual(style.links, { civitaiCom: "https://civitai.com/models/1?modelVersionId=2" });
  assert.deepEqual(
    [style.nsfw, style.licence],
    [null, { name: "", commercial: null, restrictions: [] }],
    "unknown, never assumed safe",
  );
  assert.equal(entries["loras/seed-only.safetensors"].origin, "seed");
  const vae = entries["vae/ae.safetensors"];
  assert.deepEqual(
    [vae.kind, vae.origin, vae.sha256, vae.links.hf, vae.source.provider],
    [
      "vae",
      "manifest",
      hex("b"),
      "https://huggingface.co/org/repo/resolve/abc/ae.safetensors",
      "manifest",
    ],
    "the manifest over a cached hash",
  );
  assert.deepEqual(store.byHash(hex("a").toUpperCase()), ["loras/style.safetensors"]);
  assert.deepEqual(snapshot(f.dir), before, "the older files stay exactly as they were");
});

test("the migration is idempotent and seed changes flow, unless Studio changed the entry", (t) => {
  const f = fixture(t);
  f.store().migrate();
  const file = path.join(f.dir, "library", "catalogue.json");
  const first = fs.readFileSync(file, "utf8");
  const again = f.store();
  assert.equal(again.migrate(), false, "nothing new on the second start");
  assert.equal(fs.readFileSync(file, "utf8"), first);
  // A seed update reaches entries Studio hasn't edited.
  fs.writeFileSync(
    path.join(f.dir, "config", "lora-catalogue.json"),
    JSON.stringify({
      "seed-only.safetensors": { title: "Seed Only v2" },
      "style.safetensors": { title: "Seed Style" },
    }),
  );
  again.edit("loras/style.safetensors", { title: "Studio Style" }, { by: "admin-1" });
  assert.equal(again.entry("loras/seed-only.safetensors").title, "Seed Only v2");
  assert.equal(again.entry("loras/style.safetensors").title, "Studio Style");
  // A source file that goes keeps its last layer.
  fs.rmSync(path.join(f.dir, "model-download-sources.json"));
  assert.equal(f.store().entry("loras/style.safetensors").sha256, hex("a"));
});

test("edits are validated, recorded with who made them, undoable and reviewable", (t) => {
  const f = fixture(t);
  const store = f.store();
  store.migrate();
  assert.throws(
    () => store.edit("loras/style.safetensors", { sha256: hex("9") }),
    /can't be changed/,
  );
  assert.throws(
    () => store.edit("loras/style.safetensors", { sha256: hex("9") }, { provenance: true }),
    /can't be changed/,
    "an administrator never edits provenance",
  );
  assert.throws(
    () =>
      store.edit(
        "loras/new.safetensors",
        { sha256: "short" },
        { origin: "import", provenance: true },
      ),
    /64 hex/,
  );
  assert.throws(() => store.edit("../x", { title: "x" }), /folder\/file/);
  assert.throws(() => store.edit("loras/style.safetensors", { nsfw: "yes" }), /true or false/);
  const { entry, previous } = store.edit(
    "loras/style.safetensors",
    { title: "Drafted", triggers: ["newword"], nsfw: true, notes: "Use low" },
    { by: "assistant", origin: "ai", aiDrafted: true },
  );
  assert.deepEqual(
    [entry.title, entry.triggers, entry.nsfw, entry.note, entry.origin, entry.aiDrafted, entry.by],
    ["Drafted", ["newword"], true, "Use low", "ai", true, "assistant"],
  );
  assert.deepEqual(previous, { title: null, triggers: null, nsfw: null, note: null });
  store.edit("loras/style.safetensors", { title: "Reviewed" }, { by: "admin-1" });
  assert.equal(
    store.entry("loras/style.safetensors").aiDrafted,
    undefined,
    "an administrator’s edit clears AI-Drafted",
  );
  assert.equal(store.entry("loras/style.safetensors").history.length, 2);
  assert.equal(store.undo("loras/style.safetensors", { by: "admin-1" }).title, "Drafted");
  assert.equal(
    store.undo("loras/style.safetensors").title,
    "Admin Style",
    "back to the merged sources",
  );
  assert.throws(() => store.undo("loras/style.safetensors"), /no change to undo/);
  store.edit(
    "loras/new.safetensors",
    { title: "From Chat" },
    { by: "chat", origin: "chat", aiDrafted: true },
  );
  assert.equal(store.approve("loras/new.safetensors", { by: "admin-1" }).aiDrafted, undefined);
});

test("the LoRA view keeps the older shapes, with Studio’s edits applied", (t) => {
  const f = fixture(t);
  const store = f.store();
  store.migrate();
  store.edit(
    "loras/style.safetensors",
    {
      title: "Edited",
      strength: { min: 0, max: 1, step: 0.05, default: 0.5 },
      links: { civitaiRed: "https://civitai.red/models/1" },
    },
    { by: "admin-1" },
  );
  const { sources, catalogue } = store.loraView();
  assert.deepEqual(Object.keys(sources), ["civitai:2:3"]);
  assert.equal(sources["civitai:2:3"].label, "Provider Style");
  assert.deepEqual(catalogue["style.safetensors"], {
    title: "Edited",
    baseModel: "Krea 2",
    triggers: ["seedword"],
    note: "Strength 0.7",
    sourceUrl: "https://civitai.red/models/1",
    tags: ["a", "b"],
    promptStyle: "tags",
    strengthRange: { min: 0, max: 1, step: 0.05, default: 0.5 },
  });
  assert.equal(catalogue["seed-only.safetensors"].title, "Seed Only");
});

test("explicit Original/Finetune classification persists and projects through Library", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-catalogue-type-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { libraryItems } = await import("./library-routes.js");
  createCatalogueStore({ dataDir: dir, log: quiet }).edit("checkpoints/base.safetensors", {
    title: "Base",
    description: "Studio model notes.",
    families: ["flux2"],
    modelType: "original",
  });
  const store = createCatalogueStore({ dataDir: dir, log: quiet });
  assert.equal(store.entry("checkpoints/base.safetensors").modelType, "original");
  assert.equal(
    libraryItems({ entries: store.entries() }).find(
      (item) => item.key === "checkpoints/base.safetensors",
    ).modelType,
    "original",
  );
  store.edit("checkpoints/base.safetensors", { modelType: "finetune" });
  assert.equal(store.entry("checkpoints/base.safetensors").modelType, "finetune");
  store.undo("checkpoints/base.safetensors");
  assert.equal(store.entry("checkpoints/base.safetensors").modelType, "original");
  assert.throws(
    () => store.edit("checkpoints/base.safetensors", { modelType: "guessed" }),
    /modelType must/,
  );
});
