import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCatalogueStore } from "./library-catalogue.js";
import { civitaiUpdate, createUpdateChecker, hfUpdate, publicUpdate } from "./library-updates.js";

const { model } = JSON.parse(
  fs.readFileSync(new URL("./fixtures/civitai/model-offers.json", import.meta.url), "utf8"),
);
const familiesOf = (base) => (/flux/i.test(base) ? ["flux1"] : /sdxl/i.test(base) ? ["sdxl"] : []);
const now = Date.parse("2026-10-21T00:00:00Z");
const quiet = { info: () => {}, warn: () => {} };
const sha = (digit) => digit.repeat(64);

test("a newer free version of the same family is an update; a paid newest one suggests the free one", () => {
  const fromV1 = civitaiUpdate(
    { baseModel: "Flux.1 D", source: { provider: "civitai", modelId: 70, versionId: 701 } },
    model,
    { familiesOf, now },
  );
  assert.equal(fromV1.state, "available");
  assert.deepEqual(
    [fromV1.latest.name, fromV1.latest.unavailable.reason, fromV1.latest.spec],
    ["v4 Early", "paid", undefined],
    "paid files are never downloaded",
  );
  assert.deepEqual(
    [fromV1.freeAlternative.name, fromV1.freeAlternative.file, fromV1.freeAlternative.spec.sha256],
    ["v3", "nightfall-v3-fp8.safetensors", sha("3")],
    "the SDXL v2 is another family",
  );
  assert.equal(fromV1.note, "v4 Early is paid; v3 is free.");
  const fromV3 = civitaiUpdate(
    { baseModel: "Flux.1 D", source: { provider: "civitai", modelId: 70, versionId: 703 } },
    model,
    { familiesOf, now },
  );
  assert.deepEqual([fromV3.state, fromV3.freeAlternative], ["available", undefined]);
  const free = { ...model, modelVersions: model.modelVersions.slice(1) };
  assert.deepEqual(
    civitaiUpdate({ baseModel: "Flux.1 D", source: { versionId: 703 } }, free, { familiesOf, now }),
    { state: "current", note: "" },
  );
  assert.equal(
    civitaiUpdate({ source: { versionId: 999 } }, model, { familiesOf, now }).state,
    "error",
  );
  assert.equal(publicUpdate(fromV1).freeAlternative.spec, undefined, "specs stay on the server");
  assert.equal(publicUpdate(fromV1).freeAlternative.downloadable, true);
});

test("a Hugging Face file with a new checksum on main is an update under its own name", () => {
  const entry = {
    sha256: sha("a"),
    source: { provider: "hf", repo: "org/flux", path: "loras/style.safetensors" },
  };
  const metadata = (digit) => ({
    sha: "b".repeat(40),
    siblings: [{ rfilename: "loras/style.safetensors", lfs: { sha256: sha(digit), size: 5 } }],
  });
  assert.deepEqual(hfUpdate(entry, metadata("a")), { state: "current", note: "" });
  const update = hfUpdate(entry, metadata("c"));
  assert.equal(update.state, "available");
  assert.deepEqual(
    [update.latest.file, update.latest.spec.sha256, update.latest.spec.url],
    [
      "style-bbbbbbb.safetensors",
      sha("c"),
      `https://huggingface.co/org/flux/resolve/${"b".repeat(40)}/loras/style.safetensors`,
    ],
  );
  assert.equal(hfUpdate(entry, { sha: "b".repeat(40), siblings: [] }).state, "error");
});

function harness(t, { references = async () => [], repoint } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-updates-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const catalogue = createCatalogueStore({
    dataDir: dir,
    familiesFromMetadata: ({ base_model: base }) => familiesOf(base),
    log: quiet,
  });
  catalogue.edit(
    "checkpoints/nightfall-v1-fp8.safetensors",
    {
      title: "Nightfall Diffusion",
      version: "v1",
      baseModel: "Flux.1 D",
      nsfw: false,
      sha256: sha("1"),
      source: { provider: "civitai", modelId: 70, versionId: 701 },
    },
    { by: "admin", origin: "import", provenance: true },
  );
  const installed = new Set(["checkpoints/nightfall-v1-fp8.safetensors"]);
  const files = new Map([["nightfall-v1-fp8.safetensors", sha("1")]]);
  const state = { active: null, queued: [], recent: [] };
  const started = [];
  const removed = [];
  const requests = [];
  const checker = createUpdateChecker({
    dataDir: dir,
    catalogue,
    installed: async () => installed,
    familiesOf,
    repoint,
    references,
    now: () => now,
    log: quiet,
    json: async (url) => {
      requests.push(url);
      return structuredClone(model);
    },
    startDownload: async (spec) => {
      started.push(spec);
      state.queued.push({ id: spec.id });
      return { id: spec.id };
    },
    downloads: () => state,
    inspect: async (want) =>
      files.get(want.file) === want.sha256 ? { status: "installed" } : { status: "missing" },
    removeFile: async (want) => {
      removed.push(want);
      files.delete(want.file);
      installed.delete(`${want.folder}/${want.file}`);
    },
  });
  return { dir, catalogue, checker, installed, files, state, started, removed, requests };
}

test("Check Updates marks Update Available, and nothing downloads on its own", async (t) => {
  const h = harness(t);
  const summary = await h.checker.check();
  assert.deepEqual(h.requests, ["models/70"]);
  assert.equal(summary.available, 1);
  assert.equal(summary.byEntry["checkpoints/nightfall-v1-fp8.safetensors"].state, "available");
  assert.equal(h.started.length, 0, "never downloads automatically");
  assert.ok(fs.existsSync(path.join(h.dir, "library", "updates.json")));
  await assert.rejects(
    h.checker.apply("checkpoints/nightfall-v1-fp8.safetensors"),
    /Downloads cost 800 Buzz/,
    "the paid newest version is refused",
  );
  // A restart reads the state back.
  const again = createUpdateChecker({ dataDir: h.dir, catalogue: h.catalogue });
  assert.equal(again.summary().available, 1);
});

test("an update that verifies moves the catalogue and removes the old file when nothing uses it", async (t) => {
  const h = harness(t);
  await h.checker.check();
  const applied = await h.checker.apply("checkpoints/nightfall-v1-fp8.safetensors", {
    alternative: true,
    by: "admin-1",
  });
  assert.deepEqual(
    [applied.state, applied.to.file, h.started[0].folder],
    ["downloading", "nightfall-v3-fp8.safetensors", "checkpoints"],
  );
  // Still downloading: nothing moves.
  await h.checker.settle();
  assert.equal(h.removed.length, 0);
  // It lands and verifies.
  h.state.queued = [];
  h.state.recent = [{ id: applied.downloadId, status: "done" }];
  h.files.set("nightfall-v3-fp8.safetensors", sha("3"));
  h.installed.add("checkpoints/nightfall-v3-fp8.safetensors");
  const summary = await h.checker.settle();
  const done = summary.applied["checkpoints/nightfall-v1-fp8.safetensors"];
  assert.deepEqual(
    [done.state, done.note, done.newKey],
    [
      "removed",
      "Updated to v3. The old file was removed.",
      "checkpoints/nightfall-v3-fp8.safetensors",
    ],
  );
  assert.deepEqual(h.removed, [
    { folder: "checkpoints", file: "nightfall-v1-fp8.safetensors", sha256: sha("1") },
  ]);
  const entry = h.catalogue.entry("checkpoints/nightfall-v3-fp8.safetensors");
  assert.deepEqual(
    [entry.title, entry.version, entry.sha256, entry.source],
    ["Nightfall Diffusion", "v3", sha("3"), { provider: "civitai", modelId: 70, versionId: 703 }],
  );
  assert.equal(entry.links.civitaiCom, "https://civitai.com/models/70?modelVersionId=703");
  assert.equal(
    h.catalogue.entry("checkpoints/nightfall-v1-fp8.safetensors").note,
    "Replaced by nightfall-v3-fp8.safetensors.",
  );
  assert.equal(summary.available, 0);
});

test("the old file stays while something still references it, and says what", async (t) => {
  const h = harness(t, {
    references: async ({ file }) =>
      file === "nightfall-v1-fp8.safetensors" ? ["the Nightfall profile"] : [],
  });
  await h.checker.check();
  const applied = await h.checker.apply("checkpoints/nightfall-v1-fp8.safetensors", {
    alternative: true,
  });
  h.state.queued = [];
  h.files.set("nightfall-v3-fp8.safetensors", sha("3"));
  const done = (await h.checker.settle()).applied["checkpoints/nightfall-v1-fp8.safetensors"];
  assert.deepEqual(
    [done.state, done.note],
    ["kept", "The old file stays: the Nightfall profile still uses it."],
  );
  assert.equal(h.removed.length, 0);
  assert.ok(h.files.has("nightfall-v1-fp8.safetensors"));
  assert.equal(applied.to.file, "nightfall-v3-fp8.safetensors");
  // The kept old file isn't offered the same update again.
  assert.equal(
    (await h.checker.check()).byEntry["checkpoints/nightfall-v1-fp8.safetensors"],
    undefined,
  );
});

test("the profiles naming the old file move to the new one, so it can be removed", async (t) => {
  const named = new Set(["nightfall-v1-fp8.safetensors"]);
  const moves = [];
  const h = harness(t, {
    repoint: async (from, to) => {
      moves.push([from.file, to.file]);
      named.delete(from.file);
      return ["Nightfall"];
    },
    references: async ({ file }) => (named.has(file) ? ["the Nightfall profile"] : []),
  });
  await h.checker.check();
  await h.checker.apply("checkpoints/nightfall-v1-fp8.safetensors", { alternative: true });
  h.state.queued = [];
  h.files.set("nightfall-v3-fp8.safetensors", sha("3"));
  const done = (await h.checker.settle()).applied["checkpoints/nightfall-v1-fp8.safetensors"];
  assert.deepEqual(moves, [["nightfall-v1-fp8.safetensors", "nightfall-v3-fp8.safetensors"]]);
  assert.deepEqual(
    [done.state, done.note],
    ["removed", "Updated to v3. Moved the Nightfall profile to it. The old file was removed."],
  );
});

test("a failed download or a checksum mismatch never touches the old file", async (t) => {
  const h = harness(t);
  await h.checker.check();
  const applied = await h.checker.apply("checkpoints/nightfall-v1-fp8.safetensors", {
    alternative: true,
  });
  h.state.queued = [];
  h.state.recent = [{ id: applied.downloadId, status: "error", error: "Network lost." }];
  const failed = (await h.checker.settle()).applied["checkpoints/nightfall-v1-fp8.safetensors"];
  assert.deepEqual([failed.state, failed.note], ["failed", "Network lost."]);
  assert.equal(h.removed.length, 0);
  assert.equal(
    h.checker.summary().byEntry["checkpoints/nightfall-v1-fp8.safetensors"].state,
    "available",
    "the update can be tried again",
  );
});
