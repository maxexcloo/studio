import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { restoreRuntimeBackup } from "../persistence/migration.ts";
import { createCatalogueStore } from "./catalogue.js";
import { downloadSources } from "./download-sources.js";

const spec = (id, file, extra = {}) => ({ id, file, folder: "loras", label: file, ...extra });

test("model-download-sources.json folds into the catalogue's provider layer, once and restorably", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-download-sources-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  };
  write("library/catalogue.json", {
    version: 1,
    layers: {
      provider: {
        "civitai:1:1": spec("civitai:1:1", "same.safetensors"),
        "civitai:2:2": spec("civitai:2:2", "old.safetensors"),
      },
    },
    signatures: { provider: "10:1", manifest: "20:2" },
  });
  write("model-download-sources.json", {
    "civitai:1:1": spec("civitai:1:1", "same.safetensors"),
    "civitai:2:2": spec("civitai:2:2", "old.safetensors", { sha256: "a".repeat(64) }),
    "civitai:3:3": { file: "new.safetensors", folder: "loras", label: "new.safetensors" },
    broken: "not a spec",
  });
  write("model-download-sources.json.bak", {});
  const read = (name) => fs.readFileSync(path.join(dir, name));
  const original = {
    catalogue: read("library/catalogue.json"),
    sources: read("model-download-sources.json"),
    bak: read("model-download-sources.json.bak"),
  };

  const plan = downloadSources(dir);
  assert.deepEqual(plan, {
    applied: false,
    backup: "",
    added: ["civitai:3:3"],
    changed: ["civitai:2:2"],
    unchanged: 1,
    skipped: ["broken"],
  });
  assert.deepEqual(
    read("library/catalogue.json"),
    original.catalogue,
    "the dry run writes nothing",
  );
  assert.equal(fs.existsSync(path.join(dir, ".backups")), false);

  const applied = downloadSources(dir, { apply: true });
  assert.equal(applied.applied, true);
  for (const [name, bytes] of [
    ["library/catalogue.json", original.catalogue],
    ["model-download-sources.json", original.sources],
    ["model-download-sources.json.bak", original.bak],
  ])
    assert.deepEqual(fs.readFileSync(path.join(applied.backup, name)), bytes);
  assert.equal(fs.existsSync(path.join(dir, "model-download-sources.json")), false);
  assert.equal(fs.existsSync(path.join(dir, "model-download-sources.json.bak")), false);
  const saved = JSON.parse(read("library/catalogue.json"));
  assert.deepEqual(Object.keys(saved.layers.provider), [
    "civitai:1:1",
    "civitai:2:2",
    "civitai:3:3",
  ]);
  assert.deepEqual(saved.signatures, { manifest: "20:2" });
  const store = createCatalogueStore({ dataDir: dir, environment: {}, log: { info() {} } });
  assert.equal(store.download("civitai:3:3").id, "civitai:3:3");
  assert.equal(store.entry("loras/old.safetensors").sha256, "a".repeat(64));

  assert.deepEqual(downloadSources(dir, { apply: true }), {
    applied: false,
    backup: "",
    added: [],
    changed: [],
    unchanged: 0,
    skipped: [],
  });

  const restored = path.join(dir, "restored");
  assert.deepEqual(restoreRuntimeBackup(applied.backup, restored), { restored: 3 });
  assert.deepEqual(
    fs.readFileSync(path.join(restored, "model-download-sources.json")),
    original.sources,
  );
  assert.deepEqual(
    fs.readFileSync(path.join(restored, "library", "catalogue.json")),
    original.catalogue,
  );
});
