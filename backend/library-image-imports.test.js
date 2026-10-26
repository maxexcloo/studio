import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCatalogueStore } from "./library-catalogue.js";
import { createImportEngine, createImportStore, publicImport } from "./library-imports.js";
import { civitaiOffers } from "./library-offers.js";
import { matchImageResource } from "./library-routes.js";
import { detectLink } from "./library-sources.js";
import { findSubstitute } from "./library-substitutes.js";

/*
 * Dropped image files through the import engine: metadata becomes a graded preset, files match
 * by hash first, then by name, missing ones get a marked substitute with Use Exact File, an image
 * without metadata is described by the vision model, and offers download only when chosen.
 */

const quiet = { info: () => {}, warn: () => {} };
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/images/${name}`, import.meta.url));
const { model: offerModel } = JSON.parse(
  fs.readFileSync(new URL("./fixtures/civitai/model-offers.json", import.meta.url), "utf8"),
);
const full = (prefix) => (prefix + "0".repeat(64)).slice(0, 64);
const dreamshaper8 = {
  id: 128713,
  modelId: 4384,
  name: "8",
  baseModel: "SD 1.5",
  availability: "Public",
  status: "Published",
  model: { name: "DreamShaper", type: "Checkpoint" },
  files: [
    {
      id: 1,
      name: "dreamshaper_8.safetensors",
      type: "Model",
      primary: true,
      sizeKB: 2000000,
      hashes: { SHA256: full("0123456789").toUpperCase() },
    },
  ],
};

function harness(t, { vision = true, resolveCivitai = null, preset = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-image-imports-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createImportStore({ dataDir: dir, log: quiet });
  const catalogue = createCatalogueStore({ dataDir: dir, log: quiet });
  catalogue.edit(
    "loras/watercolour-v2.safetensors",
    {
      title: "Watercolour Style",
      version: "V2",
      sha256: full("abcdef0123"),
      source: { provider: "civitai", modelId: 9, versionId: 20 },
    },
    { origin: "import", provenance: true },
  );
  const installed = {
    checkpoints: ["dreamshaper_9.safetensors"],
    loras: ["watercolour-v2.safetensors"],
    diffusion_models: [],
    vae: [],
    text_encoders: [],
  };
  const hashes = new Map([
    ["watercolour-v2.safetensors", full("abcdef0123")],
    ["dreamshaper_8.safetensors", full("0123456789")],
  ]);
  const profiles = [
    {
      id: "sd15-dreamshaper",
      label: "DreamShaper",
      kind: "image",
      family: "sd15",
      model: "dreamshaper_9.safetensors",
    },
  ];
  const state = { active: null, queued: [], recent: [] };
  const started = [];
  const described = [];
  const pictures = new Map();
  const json = async (url) => {
    if (url === "model-versions/by-hash/0123456789") return structuredClone(dreamshaper8);
    throw new Error("Not found");
  };
  const files = () =>
    Object.entries(installed).flatMap(([folder, names]) => names.map((file) => ({ folder, file })));
  const engine = createImportEngine({
    store,
    catalogue,
    detect: detectLink,
    downloads: () => state,
    resolveCivitai:
      resolveCivitai ||
      (async () => {
        throw new Error("unused");
      }),
    resolveHf: async () => {
      throw new Error("unused");
    },
    importImage: async () => {
      if (!preset) throw new Error("unused");
      return structuredClone(preset);
    },
    resolvePreset: async () => (preset ? structuredClone(preset) : null),
    inspect: async (want) => {
      const folders = ["checkpoints", "diffusion_models"].includes(want.folder)
        ? ["checkpoints", "diffusion_models"]
        : [want.folder];
      if (!folders.some((folder) => installed[folder]?.includes(want.file)))
        return { status: "missing" };
      if (!want.sha256) return { status: "installed", unverified: true };
      return hashes.get(want.file) === want.sha256
        ? { status: "installed" }
        : { status: "conflict" };
    },
    startDownload: async (spec) => {
      started.push(spec.id);
      state.queued.push({ id: spec.id });
      return { id: spec.id };
    },
    matchImage: (item) =>
      matchImageResource(item, { installed, entries: catalogue.entries(), json }),
    substituteFor: (resource) =>
      findSubstitute(
        {
          file: resource.want.file,
          name: resource.want.file ? "" : resource.name,
          folder: resource.want.folder,
        },
        files(),
        { role: resource.role, family: resource.baseModel === "SD 1.5" ? "sd15" : "", profiles },
      ),
    profileFor: async (file) => profiles.find((item) => item.model === file)?.id || "",
    pictures: {
      save: async (id, data) => {
        pictures.set(id, data);
        return true;
      },
      copy: async (from, to) => {
        pictures.set(to, pictures.get(from));
        return true;
      },
    },
    describe: async ({ id }) => {
      described.push(id);
      return {
        prompt: "a painted fox in fog",
        negative: "blurry",
        profileId: "sd15-dreamshaper",
        profileLabel: "DreamShaper",
        loras: [{ name: "watercolour-v2.safetensors" }],
      };
    },
    vision: async () =>
      vision
        ? { available: true, reason: "" }
        : { available: false, reason: "The assistant model can’t read images." },
  });
  return { dir, store, engine, installed, hashes, state, started, described, pictures };
}

test("a dropped A1111 PNG becomes a graded preset; files match by hash, then Civitai, then name", async (t) => {
  const h = harness(t);
  const record = await h.engine.createFromImage({
    data: fixture("a1111.png"),
    name: "fox.png",
    by: "admin-1",
  });
  assert.deepEqual(
    [record.input.kind, record.input.format, record.title, record.by, record.picture],
    ["image-file", "png", "fox", "admin-1", true],
  );
  assert.equal(record.preset.prompt, "a watercolour fox in a misty forest, soft light");
  assert.deepEqual(record.preset.settings, {
    steps: 28,
    cfg: 6.5,
    width: 832,
    height: 1216,
    seed: "1234567890",
    sampler: "dpmpp_2m",
    scheduler: "karras",
  });
  const [checkpoint, watercolour, tweaker] = record.resources;
  // The checkpoint's hash found it on Civitai (with its download); it isn't installed, so version 9 stands in.
  assert.deepEqual(
    [
      checkpoint.name,
      checkpoint.want.file,
      checkpoint.matchedBy,
      checkpoint.status,
      checkpoint.substitute.file,
      checkpoint.substitute.kind,
      checkpoint.exactInstalled,
      checkpoint.profileId,
    ],
    [
      "DreamShaper",
      "dreamshaper_8.safetensors",
      "hash",
      "substitute",
      "dreamshaper_9.safetensors",
      "version",
      false,
      "sd15-dreamshaper",
    ],
  );
  assert.ok(checkpoint.spec, "the exact file can be downloaded");
  // The LoRA's AutoV2 hash matched the catalogue entry and the installed file verifies.
  assert.deepEqual(
    [watercolour.name, watercolour.matchedBy, watercolour.status, watercolour.strength],
    ["Watercolour Style", "hash", "installed", 0.8],
  );
  // No source recorded anywhere: named, missing and not downloadable.
  assert.deepEqual(
    [tweaker.name, tweaker.status, tweaker.unsourced, tweaker.spec],
    ["detail-tweaker", "missing", true, undefined],
  );
  assert.equal(record.grade.value, "partial");
  assert.deepEqual(record.grade.reasons, [
    "detail-tweaker isn’t installed",
    "DreamShaper uses a substitute: Version 9 instead of 8",
  ]);
  assert.equal(record.state, "needs-files");
  assert.equal(
    publicImport(record).resources[0].spec,
    undefined,
    "download specs stay on the server",
  );
  assert.equal(h.started.length, 0, "nothing downloads on its own");
});

test("a substitute lowers the grade to Close; Use Exact File appears once the exact file is installed", async (t) => {
  const h = harness(t);
  h.installed.loras.push("detail-tweaker.safetensors");
  const record = await h.engine.createFromImage({ data: fixture("a1111.png"), name: "fox.png" });
  assert.equal(record.grade.value, "close");
  assert.deepEqual(record.grade.reasons, [
    "DreamShaper uses a substitute: Version 9 instead of 8",
    "detail-tweaker matched by filename only",
  ]);
  assert.equal(record.state, "ready", "a stand-in counts as there");
  await assert.rejects(h.engine.useExact(record.id, 0), /isn’t installed yet/);
  // Download Missing skips the stand-in; choosing its row downloads the exact file.
  await assert.rejects(h.engine.downloadMissing(record.id), /Nothing is missing/);
  const queued = await h.engine.downloadMissing(record.id, { indices: [0] });
  assert.deepEqual([queued.queued, h.started], [1, ["civitai:128713:1"]]);
  h.state.queued = [];
  h.installed.checkpoints.push("dreamshaper_8.safetensors");
  const opened = await h.engine.open(record.id);
  assert.deepEqual(
    [opened.resources[0].status, opened.resources[0].exactInstalled],
    ["substitute", true],
  );
  const exact = await h.engine.useExact(record.id, 0);
  assert.deepEqual(
    [exact.resources[0].status, exact.resources[0].substitute, exact.resources[0].profileId],
    ["installed", undefined, ""],
  );
  assert.ok(
    exact.grade.reasons.includes("No profile runs the base model"),
    "the exact model has no profile yet",
  );
});

test("a Civitai image link gets the same stand-ins, and the exact file replaces it once installed", async (t) => {
  const preset = {
    id: "civitai-42",
    name: "Misty Fox",
    sourceUrl: "https://civitai.com/images/42",
    baseModel: "SD 1.5",
    prompt: "a watercolour fox",
    negative: "blurry",
    settings: { seed: 7, sampler: "euler", steps: 20, cfg: 6, width: 512, height: 768 },
    warnings: [],
    resources: [
      {
        name: "DreamShaper",
        file: "dreamshaper_8.safetensors",
        folder: "checkpoints",
        sha256: full("0123456789"),
        status: "missing",
        supported: true,
      },
      {
        name: "Watercolour Style",
        file: "watercolour-v2.safetensors",
        folder: "loras",
        status: "installed",
        localName: "watercolour-v2.safetensors",
        weight: 0.8,
      },
    ],
  };
  const h = harness(t, { preset });
  const record = await h.engine.create("https://civitai.com/images/42");
  const [checkpoint, watercolour] = record.resources;
  assert.deepEqual(
    [checkpoint.status, checkpoint.substitute.file, checkpoint.profileId],
    ["substitute", "dreamshaper_9.safetensors", "sd15-dreamshaper"],
  );
  assert.deepEqual([watercolour.status, watercolour.strength], ["installed", 0.8]);
  assert.equal(record.grade.value, "close");
  assert.ok(record.grade.reasons.includes("DreamShaper uses a substitute: Version 9 instead of 8"));
  assert.equal(record.state, "ready", "a stand-in counts as there");
  assert.equal(record.preset.prompt, "a watercolour fox", "Use Prompt and Use Settings apply it");

  preset.resources[0] = {
    ...preset.resources[0],
    status: "installed",
    localName: "dreamshaper_8.safetensors",
  };
  const exact = await h.engine.open(record.id);
  assert.deepEqual(
    [exact.resources[0].status, exact.resources[0].substitute],
    ["installed", undefined],
  );
});

test("Studio’s own PNG and a ComfyUI WebP import with their full file names", async (t) => {
  const h = harness(t);
  h.installed.diffusion_models.push("flux1-dev.safetensors");
  h.installed.vae.push("ae.safetensors");
  const record = await h.engine.createFromImage({
    data: fixture("comfyui.webp"),
    name: "bicycle.webp",
  });
  assert.equal(record.input.format, "webp");
  const byFile = Object.fromEntries(
    record.resources.map((resource) => [resource.want.file, resource]),
  );
  assert.deepEqual(
    [
      byFile["flux1-dev-fp8.safetensors"].status,
      byFile["flux1-dev-fp8.safetensors"].substitute.file,
      byFile["flux1-dev-fp8.safetensors"].substitute.kind,
    ],
    ["substitute", "flux1-dev.safetensors", "precision"],
  );
  assert.deepEqual(
    [byFile["ae.safetensors"].status, byFile["ae.safetensors"].nameOnly],
    ["installed", true],
  );
  assert.equal(record.grade.value, "partial");
  assert.ok(record.grade.reasons.includes("No profile runs the base model"));
  const studio = await h.engine.createFromImage({
    data: fixture("studio.png"),
    name: "lighthouse.png",
  });
  assert.equal(studio.preset.prompt, "a lighthouse at dusk, long exposure");
  assert.equal(studio.recipe.source, "studio");
});

test("an image without metadata is described by the vision model and graded Partial", async (t) => {
  const h = harness(t);
  const record = await h.engine.createFromImage({ data: fixture("plain.png"), name: "photo.png" });
  assert.deepEqual(h.described, [record.id]);
  assert.deepEqual(
    [
      record.input.kind,
      record.state,
      record.preset.prompt,
      record.preset.negative,
      record.suggestion.profileId,
    ],
    ["described", "ready", "a painted fox in fog", "blurry", "sd15-dreamshaper"],
  );
  assert.deepEqual(record.grade, {
    value: "partial",
    reasons: [
      "Described by AI; no recorded settings",
      "Suggested profile: DreamShaper",
      "Suggested LoRAs: watercolour-v2.safetensors",
    ],
    missingFields: [],
  });
  assert.deepEqual(
    [record.resources[0].suggested, record.resources[0].optional, record.resources[0].status],
    [true, true, "installed"],
  );
});

test("without a vision model, a bare image says why; Describe on request makes a new record", async (t) => {
  const blind = harness(t, { vision: false });
  const failed = await blind.engine.createFromImage({
    data: fixture("plain.png"),
    name: "photo.png",
  });
  assert.equal(failed.state, "failed");
  assert.equal(
    failed.error,
    "This image has no generation metadata. The assistant model can’t read images.",
  );
  assert.equal(blind.described.length, 0);
  await assert.rejects(blind.engine.describeImport(failed.id), /can’t read images/);

  const h = harness(t);
  const source = await h.engine.createFromImage({ data: fixture("a1111.png"), name: "fox.png" });
  const described = await h.engine.describeImport(source.id);
  assert.notEqual(described.id, source.id);
  assert.deepEqual(
    [
      described.input.kind,
      described.input.fromId,
      described.picture,
      h.pictures.get(described.id) === h.pictures.get(source.id),
    ],
    ["described", source.id, true, true],
  );
  assert.equal(
    h.store.get(source.id).input.kind,
    "image-file",
    "the original keeps its recorded settings",
  );
  await assert.rejects(
    h.engine.createFromImage({ data: Buffer.from("not an image at all") }),
    /PNG, WebP or JPEG/,
  );
});

test("offers download only when chosen, as an optional file; refused ones never queue", async (t) => {
  const version = {
    ...offerModel.modelVersions.find((item) => item.id === 703),
    modelId: 70,
    model: { name: offerModel.name, type: offerModel.type },
  };
  const offers = civitaiOffers({
    model: offerModel,
    version,
    familiesOf: (base) => (/flux/i.test(base) ? ["flux1"] : ["sdxl"]),
    gguf: true,
    now: Date.parse("2026-10-21T00:00:00Z"),
  });
  const resolved = {
    title: "Nightfall Diffusion",
    version: "v3",
    baseModel: "Flux.1 D",
    type: "Checkpoint",
    links: {},
    offers,
    resources: [
      {
        role: "checkpoint",
        name: "Nightfall Diffusion",
        version: "v3",
        want: {
          file: "nightfall-v3-fp8.safetensors",
          folder: "checkpoints",
          sha256: "3".repeat(64),
          bytes: 1,
          source: { provider: "civitai" },
        },
        supported: true,
        spec: {
          id: "civitai:703:7031",
          file: "nightfall-v3-fp8.safetensors",
          folder: "checkpoints",
          sha256: "3".repeat(64),
        },
        note: "",
      },
    ],
  };
  const h = harness(t, { resolveCivitai: async () => structuredClone(resolved) });
  const record = await h.engine.create("https://civitai.com/models/70?modelVersionId=703");
  assert.deepEqual(
    publicImport(record).offers.map((offer) => [offer.label, offer.relation, offer.downloadable]),
    [
      ["v3", "precision", true],
      ["v3", "format", true],
      ["v4 Early", "newer", false],
      ["v1", "older", true],
    ],
  );
  assert.equal(publicImport(record).offers[0].spec, undefined);
  const before = record.grade;
  const taken = await h.engine.acceptOffer(record.id, 1);
  assert.deepEqual(h.started, ["civitai:703:7033"]);
  const added = taken.record.resources.at(-1);
  assert.deepEqual(
    [added.want.file, added.optional, added.offered, added.status],
    ["nightfall-v3-Q4_K_M.gguf", true, "format", "downloading"],
  );
  assert.deepEqual(taken.record.grade, before, "an offer doesn’t change the grade");
  await assert.rejects(h.engine.acceptOffer(record.id, 2), /Downloads cost 800 Buzz/);
  assert.equal(h.started.length, 1);
});
