import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCatalogueStore } from "./catalogue.js";
import { enrichLocalLoraInfo } from "../lora/catalogue.js";
import { loraCompatibility, strengthRange } from "../lora/policy.js";
import { mcpLoras, prepareLoras } from "../mcp/controls.js";
import { loraDefaultStrength } from "../../shared/profiles.ts";

const hex = (digit) => digit.repeat(64);
const quiet = { info: () => {}, warn: () => {} };
const families = ({ base_model: base }) => (/krea/i.test(base) ? ["krea2"] : []);

/**
 * A data folder holding the manifest, a catalogue with saved definitions, a provider download and
 * an administrator's edit, and a retired lora-catalogue.json left behind, which is ignored.
 */
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-catalogue-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  };
  write("library/catalogue.json", {
    version: 1,
    layers: {
      // Folded by an earlier release, which saved them back empty.
      admin: {},
      seed: {},
      definitions: {
        "loras/style.safetensors": {
          title: "Seed Style",
          baseModel: "Krea 2",
          triggers: ["seedword"],
          note: "Strength 0.7",
          links: { civitaiCom: "https://civitai.com/models/1?modelVersionId=2" },
          tags: ["a", "b"],
        },
        "loras/seed-only.safetensors": { title: "Seed Only", baseModel: "Krea 2" },
      },
      provider: {
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
      },
    },
    edits: {
      "loras/style.safetensors": {
        fields: { title: "Admin Style", strength: { default: 0.9, min: 0, max: 2, step: 0.1 } },
        origin: "admin",
        by: "",
        editedAt: "2026-10-23T00:00:00.000Z",
        history: [],
      },
    },
  });
  write("lora-catalogue.json", {
    "style.safetensors": { title: "Ignored" },
    "ignored.safetensors": { title: "Ignored" },
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
    ["lora-catalogue.json", "config/models.json"].map((name) => [
      name,
      fs.readFileSync(path.join(dir, name), "utf8"),
    ]),
  );

test("the catalogue merges every layer by folder/file with provenance, the more specific source winning", (t) => {
  const f = fixture(t);
  const before = snapshot(f.dir);
  const store = f.store();
  assert.equal(store.migrate(), true);
  const saved = JSON.parse(fs.readFileSync(path.join(f.dir, "library/catalogue.json"), "utf8"));
  assert.deepEqual(Object.keys(saved.layers).sort(), ["definitions", "manifest", "provider"]);
  const entries = store.entries();
  assert.deepEqual(
    Object.keys(entries),
    [
      "checkpoints/base.safetensors",
      "loras/seed-only.safetensors",
      "loras/style.safetensors",
      "vae/ae.safetensors",
    ],
    "only model folders; SEEDVR2 stays in the manifest; lora-catalogue.json is ignored",
  );
  const style = entries["loras/style.safetensors"];
  assert.deepEqual(
    [style.kind, style.title, style.origin, style.baseModel, style.families],
    ["lora", "Admin Style", "admin", "Krea 2", ["krea2"]],
    "the edit over the definitions",
  );
  assert.deepEqual(style.triggers, ["seedword"], "definition triggers over provider trained words");
  assert.deepEqual(style.strength, { default: 0.9, min: 0, max: 2, step: 0.1 });
  assert.deepEqual(
    [style.sha256, style.bytes, style.version],
    [hex("a"), 1024, "v2"],
    "provider hashes and sizes",
  );
  assert.deepEqual(style.source, { provider: "civitai", modelId: 1, versionId: 2, fileId: 3 });
  assert.deepEqual(style.links, { civitaiCom: "https://civitai.com/models/1?modelVersionId=2" });
  assert.deepEqual(
    [style.uncensored, style.licence],
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
  assert.deepEqual(snapshot(f.dir), before, "the source files stay exactly as they were");
});

test("the sync is idempotent and a manifest that goes keeps its last layer", (t) => {
  const f = fixture(t);
  f.store().migrate();
  const file = path.join(f.dir, "library", "catalogue.json");
  const first = fs.readFileSync(file, "utf8");
  const again = f.store();
  assert.equal(again.migrate(), false, "nothing new on the second start");
  assert.equal(fs.readFileSync(file, "utf8"), first);
  // A manifest that goes keeps its last layer.
  fs.rmSync(path.join(f.dir, "config", "models.json"));
  assert.equal(f.store().entry("vae/ae.safetensors").sha256, hex("b"));
});

test("a recorded provider download is kept by id and fills its file's entry", (t) => {
  const f = fixture(t);
  f.store().rememberDownload({
    id: "hf:org/repo:" + "c".repeat(40) + ":dir/new.safetensors",
    file: "new.safetensors",
    folder: "loras",
    label: "New",
    url: "https://huggingface.co/org/repo/resolve/" + "c".repeat(40) + "/dir/new.safetensors",
    sha256: hex("d"),
    bytes: 7,
  });
  const store = f.store();
  assert.equal(
    store.download("hf:org/repo:" + "c".repeat(40) + ":dir/new.safetensors").label,
    "New",
  );
  assert.equal(store.download("civitai:2:3").label, "Provider Style");
  const entry = store.entry("loras/new.safetensors");
  assert.deepEqual(
    [entry.sha256, entry.bytes, entry.title, entry.source.provider],
    [hex("d"), 7, "New", "hf"],
  );
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
  assert.throws(
    () => store.edit("loras/style.safetensors", { uncensored: "yes" }),
    /true or false/,
  );
  const { entry, previous } = store.edit(
    "loras/style.safetensors",
    { title: "Drafted", triggers: ["newword"], uncensored: true, notes: "Use low" },
    { by: "assistant", origin: "ai", aiDrafted: true },
  );
  assert.deepEqual(
    [
      entry.title,
      entry.triggers,
      entry.uncensored,
      entry.note,
      entry.origin,
      entry.aiDrafted,
      entry.by,
    ],
    ["Drafted", ["newword"], true, "Use low", "ai", true, "assistant"],
  );
  assert.deepEqual(previous, {
    title: "Admin Style",
    triggers: null,
    uncensored: null,
    note: null,
  });
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
    strengthRange: { min: 0, max: 1, step: 0.05, default: 0.5 },
    recommendedStrength: 0.5,
  });
  assert.equal(catalogue["seed-only.safetensors"].title, "Seed Only");
});

test("partial LoRA strength recommendations survive saved definitions and edits without inventing control bounds", (t) => {
  const f = fixture(t);
  const catalogueFile = path.join(f.dir, "library/catalogue.json");
  const saved = JSON.parse(fs.readFileSync(catalogueFile, "utf8"));
  const examples = [
    { default: 2, max: 3 },
    { default: 1, min: 1, max: 2 },
    { default: 1.5, max: 2 },
  ];
  for (const [index, strength] of examples.entries())
    saved.layers.definitions[`loras/recommended-${index}.safetensors`] = {
      baseModel: "Krea 2",
      strength,
    };
  saved.layers.definitions["loras/seed-only.safetensors"].strength = {
    min: 0,
    max: 2,
    step: 0.1,
    default: 1,
  };
  fs.writeFileSync(catalogueFile, JSON.stringify(saved));
  const store = f.store();
  store.edit("loras/style.safetensors", { strength: examples[2] });
  store.edit("loras/seed-only.safetensors", { strength: examples[2] });
  for (const [name, expected] of [
    ...examples.map((strength, index) => [`recommended-${index}.safetensors`, strength.default]),
    ["style.safetensors", 1.5],
    ["seed-only.safetensors", 1.5],
  ]) {
    const info = enrichLocalLoraInfo(
      { families: [], triggers: [] },
      name,
      store.loraView().catalogue,
      families,
      { krea2: { label: "Krea 2" } },
    );
    assert.equal(strengthRange(info), null, "partial bounds do not replace controls");
    assert.equal(loraDefaultStrength(info, 1), expected, "the browser's initial strength");
    const profile = { family: "krea2", options: { loras: [name] } };
    assert.equal(
      mcpLoras(profile, { [name]: info }, { names: [name] }).loras[0].strength.recommended,
      expected,
    );
    assert.equal(prepareLoras(profile, { [name]: info }, [{ name }])[0].strength, expected);
    assert.equal(
      prepareLoras(profile, { [name]: info }, [{ name, strength: 0.5 }])[0].strength,
      0.5,
      "an explicit strength still wins",
    );
  }
});

test("saved LoRA family overrides govern compatibility through the catalogue view", (t) => {
  const f = fixture(t);
  const store = f.store();
  store.edit("loras/style.safetensors", { families: ["sdxl"] });
  const read = () =>
    enrichLocalLoraInfo(
      { families: ["krea2"], triggers: [] },
      "style.safetensors",
      store.loraView().catalogue,
      families,
      { krea2: { label: "Krea 2" }, sdxl: { label: "SDXL" } },
    );
  assert.equal(loraCompatibility(read(), { family: "sdxl" }), "fits");
  assert.equal(loraCompatibility(read(), { family: "flux1" }), "other");
  assert.equal(loraCompatibility(read(), { family: "krea2" }), "other");
  store.edit("loras/style.safetensors", { families: [] });
  assert.deepEqual(read().families, [], "explicitly clearing the family leaves it unknown");
});

test("explicit Original/Finetune classification persists and projects through Library", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-catalogue-type-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { libraryItems } = await import("./routes.js");
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
