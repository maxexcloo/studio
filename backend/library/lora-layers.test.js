import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { enrichLocalLoraInfo, enrichLoraInfo } from "../lora/catalogue.js";
import { restoreRuntimeBackup } from "../persistence/migration.ts";
import { createCatalogueStore } from "./catalogue.js";
import { loraLayers } from "./lora-layers.js";

const familiesFromMetadata = ({ base_model: base }) => (/krea/i.test(base) ? ["krea2"] : []);
const families = { krea2: { label: "Krea 2" } };
const licence = { name: "", commercial: null, restrictions: [] };
const civitai = "https://civitai.com/models/1?modelVersionId=2";

/**
 * A catalogue as the retired lora-catalogue.json files left it: a seed-only field, an admin copy
 * identical to its seed entry, admin changes, an admin-only LoRA, a field the definitions or an
 * edit already hold, and a field nothing reads.
 */
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-lora-layers-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  };
  const same = {
    title: "Same",
    baseModel: "Krea 2",
    description: "Copied into both layers",
    strengthRange: { min: -2, max: 2, step: 0.1 },
    compatibility: { baseModels: ["Krea 2"] },
  };
  write("library/catalogue.json", {
    version: 1,
    migratedAt: "2026-10-23T01:49:53.752Z",
    layers: {
      seed: {
        "loras/style.safetensors": {
          title: "Seed Style",
          baseModel: "Krea 2",
          triggers: ["seedword"],
          note: "Strength 0.7",
          sourceUrl: civitai,
          tags: ["a", "b"],
          promptStyle: "tags",
        },
        "loras/same.safetensors": same,
        "loras/defined.safetensors": { title: "Seed Defined", note: "Seed note", role: "effect" },
      },
      admin: {
        "loras/style.safetensors": {
          title: "Admin Style",
          baseModel: "Krea 2",
          triggers: ["seedword"],
          strengthRange: { min: 0, max: 2, step: 0.1, default: 0.9 },
        },
        "loras/same.safetensors": same,
        "loras/admin-only.safetensors": {
          title: "Admin Only",
          uncensored: true,
          sourceUrl: "https://huggingface.co/org/repo",
        },
      },
      definitions: { "loras/defined.safetensors": { title: "Defined" } },
    },
    edits: {
      "loras/style.safetensors": {
        fields: { note: "Edited note" },
        origin: "admin",
        by: "admin-1",
        editedAt: "2026-10-30T00:00:00.000Z",
        history: [{ at: "2026-10-30T00:00:00.000Z", by: "admin-1", patch: { note: null } }],
      },
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
      sourceUrl: civitai,
      trainedWords: ["providerword"],
      sha256: "a".repeat(64),
      bytes: 1024,
    },
  });
  return dir;
}

/** What Studio shows for each LoRA: its catalogue fields and its LoRA info. */
function shown(dir) {
  const store = createCatalogueStore({
    dataDir: dir,
    environment: {},
    familiesFromMetadata,
    log: { info() {}, warn() {} },
  });
  const { sources, catalogue } = store.loraView();
  const info = (name) =>
    enrichLocalLoraInfo(
      enrichLoraInfo({ families: [], triggers: [] }, name, sources, familiesFromMetadata, families),
      name,
      catalogue,
      familiesFromMetadata,
      families,
    );
  return Object.fromEntries(
    Object.entries(store.definitions()).map(([key, fields]) => [
      key,
      { fields, origin: store.entry(key).origin, info: info(key.slice("loras/".length)) },
    ]),
  );
}

// What Studio showed for each LoRA while it still read the seed and admin layers.
const before = {
  "loras/admin-only.safetensors": {
    fields: {
      title: "Admin Only",
      version: "",
      baseModel: "",
      families: [],
      triggers: [],
      strength: {},
      description: "",
      uncensored: true,
      licence,
      links: { hf: "https://huggingface.co/org/repo" },
    },
    origin: "admin",
    info: {
      families: [],
      triggers: [],
      title: "Admin Only",
      about: "Admin Only",
      base: "",
      sourceUrl: "https://huggingface.co/org/repo",
    },
  },
  "loras/defined.safetensors": {
    fields: {
      title: "Defined",
      version: "",
      baseModel: "",
      families: [],
      role: "effect",
      triggers: [],
      strength: {},
      description: "",
      note: "Seed note",
      uncensored: null,
      licence,
      links: {},
    },
    origin: "seed",
    info: {
      families: [],
      triggers: [],
      title: "Defined",
      about: "Defined",
      base: "",
      role: "effect",
      note: "Seed note",
    },
  },
  "loras/same.safetensors": {
    fields: {
      title: "Same",
      version: "",
      baseModel: "Krea 2",
      families: ["krea2"],
      triggers: [],
      strength: { min: -2, max: 2, step: 0.1 },
      description: "Copied into both layers",
      uncensored: null,
      licence,
      links: {},
      compatibility: { baseModels: ["Krea 2"] },
    },
    // An admin entry identical to its seed entry was never an administrator's change.
    origin: "seed",
    info: {
      families: ["krea2"],
      triggers: [],
      title: "Same",
      about: "Same",
      base: "Krea 2",
      description: "Copied into both layers",
      compatibility: { baseModels: ["Krea 2"], unlisted: "unknown" },
      strengthRange: { min: -2, max: 2, step: 0.1 },
    },
  },
  "loras/style.safetensors": {
    fields: {
      title: "Admin Style",
      version: "v2",
      baseModel: "Krea 2",
      families: ["krea2"],
      triggers: ["seedword"],
      strength: { default: 0.9, min: 0, max: 2, step: 0.1 },
      tags: ["a", "b"],
      description: "",
      note: "Edited note",
      uncensored: null,
      licence,
      links: { civitaiCom: civitai },
    },
    origin: "admin",
    info: {
      families: ["krea2"],
      triggers: ["seedword"],
      sourceUrl: civitai,
      title: "Admin Style",
      about: "Admin Style",
      base: "Krea 2",
      note: "Edited note",
      strengthRange: { min: 0, max: 2, step: 0.1, default: 0.9 },
      tags: ["a", "b"],
    },
  },
};

test("the seed and admin layers fold into definitions and edits, leaving every LoRA as it was", (t) => {
  const dir = fixture(t);
  const file = path.join(dir, "library", "catalogue.json");
  const original = fs.readFileSync(file);

  const plan = loraLayers(dir);
  assert.deepEqual(plan, {
    applied: false,
    backup: "",
    loras: {
      "loras/admin-only.safetensors": { edits: ["title", "uncensored", "links"] },
      "loras/defined.safetensors": { definitions: ["note", "role"], kept: ["title"] },
      "loras/same.safetensors": {
        definitions: ["title", "baseModel", "description", "strength", "compatibility"],
      },
      "loras/style.safetensors": {
        definitions: ["baseModel", "triggers", "links", "tags"],
        edits: ["title", "strength"],
        kept: ["note"],
        dropped: ["promptStyle"],
      },
    },
  });
  assert.deepEqual(fs.readFileSync(file), original, "the dry run writes nothing");
  assert.equal(fs.existsSync(path.join(dir, ".backups")), false);

  const applied = loraLayers(dir, { apply: true });
  assert.equal(applied.applied, true);
  assert.deepEqual(applied.loras, plan.loras);
  assert.deepEqual(
    fs.readFileSync(path.join(applied.backup, "library", "catalogue.json")),
    original,
  );
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(Object.keys(saved.layers).sort(), ["definitions"]);
  assert.deepEqual(
    saved.edits["loras/style.safetensors"].history,
    [{ at: "2026-10-30T00:00:00.000Z", by: "admin-1", patch: { note: null } }],
    "an existing edit keeps its history",
  );
  assert.deepEqual(shown(dir), before);
  assert.deepEqual(loraLayers(dir, { apply: true }), { applied: false, backup: "", loras: {} });

  const restored = path.join(dir, "restored");
  assert.deepEqual(restoreRuntimeBackup(applied.backup, restored), { restored: 1 });
  assert.deepEqual(fs.readFileSync(path.join(restored, "library", "catalogue.json")), original);
});
