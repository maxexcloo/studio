import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCatalogueStore } from "./library-catalogue.js";
import {
  createImportEngine,
  createImportStore,
  importId,
  publicImport,
} from "./library-imports.js";
import { detectLink } from "./library-sources.js";

const quiet = { info: () => {}, warn: () => {} };
const tempDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-imports-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const spec = (id, file) => ({
  id,
  file,
  folder: "loras",
  label: file,
  url: "https://civitai.com/api/download/models/1",
  sha256: "a".repeat(64),
  bytes: 10,
});
const lora = {
  title: "Watercolour Style",
  version: "V2",
  baseModel: "Krea 2",
  type: "LORA",
  uncensored: false,
  links: { civitaiCom: "https://civitai.com/models/9?modelVersionId=20" },
  resources: [
    {
      role: "lora",
      name: "Watercolour Style",
      version: "V2",
      want: {
        file: "water.safetensors",
        folder: "loras",
        sha256: "a".repeat(64),
        bytes: 10,
        source: { provider: "civitai", modelId: 9, versionId: 20 },
      },
      supported: true,
      spec: spec("civitai:20:31", "water.safetensors"),
      note: "",
    },
  ],
  entry: {
    title: "Watercolour Style",
    version: "V2",
    baseModel: "Krea 2",
    triggers: ["wtrclr"],
    strength: { default: 0.8 },
    description: "Soft washes.",
    links: {
      civitaiCom: "https://civitai.com/models/9?modelVersionId=20",
      civitaiRed: "https://civitai.red/models/9?modelVersionId=20",
    },
    uncensored: false,
    sha256: "a".repeat(64),
    source: { provider: "civitai", modelId: 9, versionId: 20, fileId: 31 },
  },
};
const paid = {
  ...lora,
  title: "Paid",
  resources: [
    {
      ...lora.resources[0],
      want: { ...lora.resources[0].want, file: "paid.safetensors" },
      supported: false,
      spec: null,
      unavailable: {
        reason: "paid",
        note: "Downloads cost 500 Buzz on Civitai.",
        freeAlternative: { versionId: 20, name: "V2" },
      },
    },
  ],
  entry: { ...lora.entry, title: "Paid" },
};

function harness(t, { resolved = lora } = {}) {
  const dir = tempDir(t);
  const store = createImportStore({ dataDir: dir, log: quiet });
  const catalogue = createCatalogueStore({
    dataDir: dir,
    familiesFromMetadata: ({ base_model: base }) => (/krea/i.test(base) ? ["krea2"] : []),
    log: quiet,
  });
  const installed = new Set();
  const state = { active: null, queued: [], recent: [] };
  const started = [];
  const engine = createImportEngine({
    store,
    catalogue,
    detect: detectLink,
    resolveCivitai: async () => structuredClone(resolved),
    resolveHf: async () => {
      throw new Error("This repository is gated or private.");
    },
    inspect: async (want) =>
      installed.has(want.file) ? { status: "installed" } : { status: "missing" },
    downloads: () => state,
    startDownload: async (item) => {
      started.push(item.id);
      state.queued.push({ id: item.id, file: item.file, receivedBytes: 0, totalBytes: item.bytes });
      return { id: item.id, status: "queued" };
    },
    importImage: async () => {
      throw new Error("unused");
    },
    resolvePreset: async () => null,
  });
  return { dir, store, catalogue, engine, installed, state, started };
}

test("a LoRA link becomes a durable record with a grade, a catalogue entry and Download Missing", async (t) => {
  const h = harness(t);
  const record = await h.engine.create("https://civitai.com/models/9?modelVersionId=20", {
    by: "admin-1",
  });
  assert.equal(record.state, "needs-files");
  assert.deepEqual(
    [record.input.kind, record.by, record.origin],
    ["civitai-model", "admin-1", "ui"],
  );
  assert.equal(record.grade.value, "partial");
  assert.deepEqual(record.grade.reasons, ["Watercolour Style isn’t installed"]);
  assert.ok(
    fs.existsSync(path.join(h.dir, "library", "imports", `${record.id}.json`)),
    "library/imports/<id>.json",
  );
  assert.equal(
    publicImport(record).resources[0].spec,
    undefined,
    "download specs stay on the server",
  );

  // The catalogue entry: title, version, family, triggers, strength, description, both links, uncensored and hash.
  assert.deepEqual(record.results.catalogueKeys, ["loras/water.safetensors"]);
  const entry = h.catalogue.entry("loras/water.safetensors");
  assert.deepEqual(
    [
      entry.title,
      entry.version,
      entry.families,
      entry.triggers,
      entry.strength,
      entry.description,
      entry.uncensored,
      entry.sha256,
      entry.origin,
      entry.by,
    ],
    [
      "Watercolour Style",
      "V2",
      ["krea2"],
      ["wtrclr"],
      { default: 0.8 },
      "Soft washes.",
      false,
      "a".repeat(64),
      "import",
      "admin-1",
    ],
  );
  assert.deepEqual(entry.links, lora.entry.links);
  assert.deepEqual(entry.source, { provider: "civitai", modelId: 9, versionId: 20, fileId: 31 });

  const queued = await h.engine.downloadMissing(record.id);
  assert.equal(queued.queued, 1);
  assert.deepEqual(h.started, ["civitai:20:31"]);
  assert.equal(queued.record.state, "downloading");
  assert.equal(queued.record.resources[0].downloadId, "civitai:20:31");

  // The download lands: the next read sees the file and grades it again.
  h.state.queued = [];
  h.state.recent = [{ id: "civitai:20:31", status: "done" }];
  h.installed.add("water.safetensors");
  const [listed] = await h.engine.list();
  assert.deepEqual(
    [listed.state, listed.grade.value, listed.resources[0].status],
    ["ready", "exact", "installed"],
  );

  // Restart: the record is read back from its file.
  const again = createImportStore({ dataDir: h.dir, log: quiet });
  assert.equal(again.get(record.id).state, "ready");
  await assert.rejects(h.engine.downloadMissing(record.id), /Nothing is missing/);
});

test("paid files are listed as unavailable with the reason and never queued", async (t) => {
  const h = harness(t, { resolved: paid });
  const record = await h.engine.create("https://civitai.com/models/9");
  assert.equal(record.resources[0].status, "unavailable");
  assert.equal(record.resources[0].unavailable.reason, "paid");
  assert.deepEqual(record.resources[0].unavailable.freeAlternative, { versionId: 20, name: "V2" });
  assert.equal(record.grade.value, "partial");
  assert.deepEqual(record.grade.reasons, ["Watercolour Style is paid on Civitai"]);
  await assert.rejects(h.engine.downloadMissing(record.id), /can’t be downloaded/);
  assert.deepEqual(h.started, []);
});

test("a failed resolve is recorded with its reason; an interrupted one fails on the next start", async (t) => {
  const h = harness(t);
  const failed = await h.engine.create("https://huggingface.co/org/gated");
  assert.equal(failed.state, "failed");
  assert.match(failed.error, /gated/);
  assert.equal(failed.grade.value, "partial");
  await assert.rejects(
    h.engine.create("https://example.com/x"),
    /civitai\.com, civitai\.red or huggingface\.co/,
  );

  const interrupted = {
    id: importId(),
    createdAt: new Date().toISOString(),
    by: "",
    origin: "ui",
    input: { kind: "civitai-model", url: "https://civitai.com/models/1" },
    state: "resolving",
    resources: [],
    offers: [],
    grade: { value: "partial", reasons: [], missingFields: [] },
    results: { catalogueKeys: [] },
  };
  fs.writeFileSync(
    path.join(h.dir, "library", "imports", `${interrupted.id}.json`),
    JSON.stringify(interrupted),
  );
  const restarted = createImportStore({ dataDir: h.dir, log: quiet });
  assert.equal(restarted.get(interrupted.id).state, "failed");
  assert.match(restarted.get(interrupted.id).error, /restarted/);
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(h.dir, "library", "imports", `${interrupted.id}.json`), "utf8"),
    ).state,
    "failed",
    "and the file says so",
  );
});

test("only the newest records are kept", (t) => {
  const dir = tempDir(t);
  const store = createImportStore({ dataDir: dir, limit: 3, log: quiet });
  const ids = [];
  for (let index = 0; index < 5; index += 1) {
    const id = importId(Date.now() + index);
    ids.push(id);
    store.put({
      id,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      input: { kind: "civitai-model" },
      state: "ready",
      resources: [],
    });
  }
  assert.deepEqual(
    store.list().map((record) => record.id),
    ids.slice(2).reverse(),
  );
  assert.deepEqual(
    fs.readdirSync(path.join(dir, "library", "imports")).sort(),
    ids
      .slice(2)
      .map((id) => `${id}.json`)
      .sort(),
  );
  assert.equal(store.get("../escape"), null);
  assert.throws(() => store.put({ id: "bad", state: "ready" }), /valid id/);
});

test("a guessed Hugging Face folder can be changed before the file downloads", async (t) => {
  const h = harness(t);
  const hfRecord = {
    id: importId(),
    createdAt: new Date().toISOString(),
    by: "",
    origin: "ui",
    input: { kind: "hf-file", url: "https://huggingface.co/o/r/blob/main/m.gguf" },
    state: "needs-files",
    resources: [
      {
        role: "diffusion_model",
        name: "m.gguf",
        want: { file: "m.gguf", folder: "diffusion_models", sha256: "b".repeat(64), bytes: 1 },
        supported: true,
        spec: { ...spec("hf:o/r:x:m.gguf", "m.gguf"), folder: "diffusion_models" },
        folderGuessed: true,
        status: "missing",
      },
    ],
    offers: [],
    grade: { value: "partial", reasons: [], missingFields: [] },
    results: { catalogueKeys: [] },
  };
  h.store.put(hfRecord);
  const moved = await h.engine.setFolder(hfRecord.id, 0, "text_encoders");
  assert.deepEqual(
    [
      moved.resources[0].want.folder,
      moved.resources[0].spec.folder,
      moved.resources[0].role,
      moved.resources[0].folderGuessed,
    ],
    ["text_encoders", "text_encoders", "text_encoder", false],
  );
  await assert.rejects(h.engine.setFolder(hfRecord.id, 0, "nowhere"), /supported model folder/);
});
