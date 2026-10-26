import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { migrateRuntime } from "./persistence/migration.ts";
import {
  closeRuntimeDatabase,
  readOfflineRuntime,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";
import {
  accountMediaSubfolder,
  applyStudioImport,
  findAccount,
  planStudioImport,
  summarizePlan,
  undoStudioImport,
} from "./studio-import.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-studio-import-"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value),
  );
};
const tree = (dir) =>
  fs
    .readdirSync(dir, { recursive: true })
    .filter((name) => fs.statSync(path.join(dir, name)).isFile())
    .sort()
    .map(
      (name) =>
        `${name}:${crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(dir, name)))
          .digest("hex")}`,
    );
const view = (filename, subfolder = "heiss-ui") =>
  `/comfy/view?${new URLSearchParams({ filename, subfolder, type: "output" })}`;

const source = path.join(root, "x", "data");
const outputs = path.join(root, "x", "output");
const target = path.join(root, "studio", "data");
const media = path.join(target, "media");
write(path.join(outputs, "heiss-ui", "image_00001_.png"), "png-1");
write(path.join(outputs, "heiss-ui", "upscale_00001_.png"), "upscale-1");
write(path.join(outputs, "heiss-ui", "video_00002_.mp4"), "mp4-2");
write(path.join(source, "gallery.json"), [
  {
    id: view("image_00001_.png"),
    url: view("image_00001_.png"),
    jobId: "job-1",
    index: 0,
    status: "done",
    type: "image",
    prompt: "harbour",
    filename: "harbour",
    upscale: { status: "done", url: view("upscale_00001_.png") },
    upscaleActive: true,
  },
  {
    id: view("video_00002_.mp4"),
    url: view("video_00002_.mp4"),
    jobId: "job-2",
    index: 0,
    status: "done",
    type: "video",
    prompt: "waves",
  },
  {
    id: view("gone.png"),
    url: view("gone.png"),
    jobId: "job-3",
    index: 0,
    status: "done",
    type: "image",
  },
  { id: "pending", jobId: "job-4", status: "pending" },
  { id: "vault", jobId: "job-5", status: "done", privateVault: true },
]);
write(path.join(source, "prompt-history.json"), { version: 1, items: [{ text: "harbour" }] });
write(path.join(source, "reference-assets", "index.json"), [
  {
    id: "ref-old",
    source: "upload",
    file: "ref-old.png",
    thumbnail: "ref-old.webp",
    name: "ref.png",
  },
]);
write(path.join(source, "reference-assets", "files", "ref-old.png"), "ref");
write(path.join(source, "reference-assets", "thumbnails", "ref-old.webp"), "thumb");
write(path.join(source, "mcp-ownership.json"), {
  version: 1,
  signingKey: "old",
  jobs: { "job-1": "gateway-owner-hash", "job-9": "other" },
  assets: { "ref-old": "gateway-owner-hash" },
});
write(path.join(target, "accounts.json"), {
  version: 1,
  accounts: [{ id: "acct-x", username: "n@excloo.com", role: "user" }],
  profiles: {},
  sessions: [],
});
write(path.join(target, "gallery.json"), [
  { id: "existing", jobId: "job-existing", status: "done", ownerId: "someone-else" },
]);

test("a dry run inventories the studio without changing anything", () => {
  const before = [tree(source), tree(outputs), tree(target)];
  const account = findAccount(target, "N@excloo.com");
  const summary = summarizePlan(
    planStudioImport({
      sourceData: source,
      sourceOutputs: outputs,
      targetData: target,
      mediaRoot: media,
      account,
      label: "x",
    }),
  );
  assert.equal(summary.galleryRecords, 2);
  assert.equal(summary.mediaFiles, 3);
  assert.equal(summary.referenceUploads, 1);
  assert.deepEqual(summary.accountFiles, ["prompt-history.json"]);
  assert.equal(summary.mcpJobs, 1);
  assert.equal(summary.skipped["outputs whose file is missing"], 1);
  assert.equal(summary.skipped["pending records"], 1);
  assert.equal(summary.skipped["Hidden items (encrypted, not migrated)"], 1);
  assert.deepEqual(summary.conflicts, []);
  assert.deepEqual([tree(source), tree(outputs), tree(target)], before);
});

test("applying copies into the account, refuses a repeat and undoes exactly what it added", () => {
  const sourceBefore = [tree(source), tree(outputs)];
  const account = findAccount(target, "n@excloo.com");
  const result = applyStudioImport(
    planStudioImport({
      sourceData: source,
      sourceOutputs: outputs,
      targetData: target,
      mediaRoot: media,
      account,
      label: "x",
    }),
  );
  const gallery = JSON.parse(fs.readFileSync(path.join(target, "gallery.json"), "utf8"));
  const imported = gallery.filter((item) => item.ownerId === "acct-x");
  assert.equal(imported.length, 2);
  const first = imported.find((item) => item.jobId === "job-1");
  const params = new URLSearchParams(first.url.split("?")[1]);
  assert.equal(params.get("type"), "media");
  assert.equal(params.get("subfolder"), accountMediaSubfolder("acct-x"));
  assert.equal(first.id, first.url);
  assert.equal(first.filename, "harbour");
  assert.equal(
    fs.readFileSync(path.join(media, params.get("subfolder"), params.get("filename")), "utf8"),
    "png-1",
  );
  assert.match(first.upscale.url, /type=media/);
  assert.ok(gallery.some((item) => item.id === "existing"));
  const mcp = JSON.parse(fs.readFileSync(path.join(target, "mcp-ownership.json"), "utf8"));
  assert.deepEqual(mcp.jobs, { "job-1": "acct-x" });
  const references = JSON.parse(
    fs.readFileSync(path.join(target, "reference-assets", "index.json"), "utf8"),
  );
  assert.equal(references[0].ownerId, "acct-x");
  assert.equal(Object.values(mcp.assets)[0], "acct-x");
  assert.ok(fs.existsSync(path.join(target, "imports", result.batch, "backup", "gallery.json")));
  // The source studio is never changed.
  assert.deepEqual([tree(source), tree(outputs)], sourceBefore);

  const repeat = planStudioImport({
    sourceData: source,
    sourceOutputs: outputs,
    targetData: target,
    mediaRoot: media,
    account,
    label: "x",
  });
  assert.ok(repeat.conflicts.some((line) => line.includes("job-1")));
  assert.ok(repeat.conflicts.some((line) => line.includes("prompt-history.json")));
  assert.throws(() => applyStudioImport(repeat), /Resolve these first/);

  // The account kept using its history after the import: undo leaves that file alone.
  const history = path.join(
    target,
    "accounts",
    crypto.createHash("sha256").update("acct-x").digest("hex"),
    "prompt-history.json",
  );
  fs.appendFileSync(history, "\n");
  const undone = undoStudioImport(target, result.batch);
  assert.equal(undone.records, 2);
  assert.deepEqual(undone.keptChangedFiles, [history]);
  assert.ok(fs.existsSync(history));
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(target, "gallery.json"), "utf8")).map((item) => item.id),
    ["existing"],
  );
  assert.equal(
    fs.existsSync(path.join(media, accountMediaSubfolder("acct-x"), params.get("filename"))),
    false,
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(target, "mcp-ownership.json"), "utf8")).jobs,
    {},
  );
});

test("a migrated source imports into authoritative SQLite, backs up that document and undoes only its additions", () => {
  const sourceData = path.join(root, "migrated-source");
  const targetData = path.join(root, "migrated-target");
  const sourceMedia = path.join(sourceData, "media");
  const mediaRoot = path.join(targetData, "media");
  const url = `/comfy/view?${new URLSearchParams({ filename: "owned.png", subfolder: "heiss-ui", type: "media" })}`;
  const record = {
    id: url,
    url,
    jobId: "native-job",
    status: "done",
    type: "image",
    prompt: "Native saved image",
  };
  write(path.join(sourceData, "gallery.json"), []);
  write(path.join(sourceMedia, "heiss-ui", "owned.png"), "native-media");
  migrateRuntime(sourceData, { apply: true });
  writeRuntimeDocument(sourceData, "gallery", [record]);
  closeRuntimeDatabase(sourceData);

  write(path.join(targetData, "gallery.json"), [{ id: "stale-json-record", status: "done" }]);
  write(path.join(targetData, "accounts.json"), {
    accounts: [{ id: "stale-account", username: "stale" }],
  });
  migrateRuntime(targetData, { apply: true });
  const currentAccount = { id: "native-account", username: "Current User" };
  const existing = {
    id: "sqlite-existing",
    jobId: "existing-job",
    ownerId: "someone-else",
    status: "done",
  };
  writeRuntimeDocument(targetData, "accounts", { accounts: [currentAccount] });
  writeRuntimeDocument(targetData, "gallery", [existing]);
  closeRuntimeDatabase(targetData);
  const sourceBefore = tree(sourceData);
  const targetBefore = tree(targetData);
  const legacyGallery = fs.readFileSync(path.join(targetData, "gallery.json"), "utf8");
  const account = findAccount(targetData, "CURRENT USER");
  assert.deepEqual(account, currentAccount);
  const options = { sourceData, sourceOutputs: outputs, targetData, mediaRoot, account };
  const plan = planStudioImport(options);
  assert.deepEqual(summarizePlan(plan).conflicts, []);
  assert.equal(plan.records.length, 1);
  assert.deepEqual(
    [tree(sourceData), tree(targetData)],
    [sourceBefore, targetBefore],
    "planning does not alter either SQLite source or target",
  );

  const result = applyStudioImport(plan);
  const imported = readRuntimeDocument(targetData, "gallery").find(
    (item) => item.jobId === "native-job",
  );
  assert.deepEqual([imported.ownerId, imported.prompt], ["native-account", "Native saved image"]);
  const params = new URLSearchParams(imported.url.split("?")[1]);
  const savedFile = path.join(mediaRoot, params.get("subfolder"), params.get("filename"));
  assert.equal(fs.readFileSync(savedFile, "utf8"), "native-media");
  assert.equal(
    fs.readFileSync(path.join(targetData, "gallery.json"), "utf8"),
    legacyGallery,
    "SQLite mode never writes the archived gallery JSON",
  );
  const backup = path.join(targetData, "imports", result.batch, "backup", "gallery.json");
  assert.deepEqual(JSON.parse(fs.readFileSync(backup, "utf8")), [existing]);
  assert.equal(
    JSON.parse(fs.readFileSync(result.manifest, "utf8")).galleryStorage,
    "studio_documents/gallery",
  );
  assert.ok(
    planStudioImport(options).conflicts.some((conflict) => conflict.includes("native-job")),
  );

  const later = { id: "created-after-import", jobId: "later-job", status: "done" };
  writeRuntimeDocument(targetData, "gallery", [
    ...readRuntimeDocument(targetData, "gallery"),
    later,
  ]);
  const undone = undoStudioImport(targetData, result.batch);
  assert.equal(undone.records, 1);
  assert.deepEqual(readRuntimeDocument(targetData, "gallery"), [existing, later]);
  assert.equal(fs.existsSync(savedFile), false);
  assert.equal(fs.readFileSync(path.join(targetData, "gallery.json"), "utf8"), legacyGallery);
  assert.deepEqual(
    tree(sourceData),
    sourceBefore,
    "apply and undo also leave the source untouched",
  );
  closeRuntimeDatabase(targetData);
});

test("offline inspection reads committed WAL records without touching source database or sidecars", () => {
  const directory = path.join(root, "uncheckpointed-source");
  write(path.join(directory, "gallery.json"), []);
  migrateRuntime(directory, { apply: true });
  try {
    writeRuntimeDocument(directory, "gallery", [{ id: "committed-in-wal", status: "done" }]);
    assert.ok(fs.statSync(path.join(directory, "studio.sqlite-wal")).size > 0);
    const before = tree(directory);
    assert.deepEqual(readOfflineRuntime(directory, ["gallery"]), {
      migrated: true,
      documents: { gallery: [{ id: "committed-in-wal", status: "done" }] },
    });
    assert.deepEqual(tree(directory), before);
  } finally {
    closeRuntimeDatabase(directory);
  }
});
