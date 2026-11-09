import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-runtime-migrations-"));
process.env.STUDIO_DATA_DIR = dataDir;
const { catalogueStore } = await import("./library/catalogue.js");
const { registerMigrationRoutes } = await import("./runtime-migrations.js");
const { readRuntimeDocument, writeRuntimeDocument } = await import("./persistence/runtime.ts");

const spec = (id, file) => ({ id, file, folder: "loras", label: file });

test("the migrations route plans, then applies online-safe steps into the running catalogue", async (t) => {
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const file = (name) => path.join(dataDir, name);
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(file(name)), { recursive: true });
    fs.writeFileSync(file(name), JSON.stringify(value));
  };
  write("library/catalogue.json", {
    version: 1,
    layers: { provider: { "civitai:1:1": spec("civitai:1:1", "kept.safetensors") } },
  });
  write("model-download-sources.json", {
    "civitai:1:1": spec("civitai:1:1", "kept.safetensors"),
    "civitai:2:2": spec("civitai:2:2", "added.safetensors"),
  });
  // A legacy record only the stopped-Studio command may rewrite.
  writeRuntimeDocument(dataDir, "model-types", { "loras/old.safetensors": "wan" });
  const catalogue = catalogueStore({ dataDir, environment: {}, log: { info() {} } });
  assert.equal(catalogue.download("civitai:2:2"), null, "the running catalogue is loaded");

  const routes = {};
  const lines = [];
  registerMigrationRoutes(
    { post: (route, handler) => (routes[route] = handler) },
    { dataDir, adminRefusal: () => null, log: { info: (line) => lines.push(line) } },
  );
  const post = async (body) => {
    const res = { json: (value) => (res.body = value), status: () => res };
    await routes["/api/maintenance/migrations"]({ body }, res);
    return res.body;
  };

  const plan = await post({});
  assert.equal(plan.apply, false);
  assert.deepEqual(plan.steps.downloadSources.added, ["civitai:2:2"]);
  assert.equal(
    fs.existsSync(file("model-download-sources.json")),
    true,
    "a dry run writes nothing",
  );
  assert.equal(fs.existsSync(file(".backups")), false);

  const applied = await post({ apply: true });
  const { backup } = applied.steps.downloadSources;
  assert.equal(applied.steps.downloadSources.applied, true);
  assert.equal(fs.existsSync(path.join(backup, "model-download-sources.json")), true);
  assert.equal(fs.existsSync(file("model-download-sources.json")), false);
  assert.equal(catalogue.download("civitai:2:2").file, "added.safetensors", "no restart needed");
  catalogue.rememberDownload(spec("civitai:3:3", "later.safetensors"));
  assert.deepEqual(
    Object.keys(JSON.parse(fs.readFileSync(file("library/catalogue.json"))).layers.provider),
    ["civitai:1:1", "civitai:2:2", "civitai:3:3"],
    "a later save keeps what the step wrote",
  );
  assert.match(applied.steps.legacyRecords.refused, /Needs Studio stopped/);
  assert.deepEqual(readRuntimeDocument(dataDir, "model-types"), { "loras/old.safetensors": "wan" });
  assert.ok(lines[1].includes(`downloadSources: 1 applied, backup ${backup}`), lines[1]);

  const again = await post({ apply: true });
  assert.deepEqual(again.steps.downloadSources, {
    applied: false,
    backup: "",
    added: [],
    changed: [],
    unchanged: 0,
    skipped: [],
  });
});
