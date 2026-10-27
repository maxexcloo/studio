import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { migrateRuntime } from "./migration.ts";
import { closeRuntimeDatabase, readRuntimeDocument } from "./runtime.ts";
import {
  applyStudioNames,
  planStudioNames,
  renamePath,
  rewriteJson,
  undoStudioNames,
} from "./studio-names.ts";

const sha = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

/** Every file under a folder with its bytes, skipping the migration's own database and backups. */
function snapshot(dir: string, base = dir): Record<string, string> {
  return Object.fromEntries(
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(dir, entry.name);
      if (
        [".backups", "studio.sqlite", "studio.sqlite-wal", "studio.sqlite-shm"].includes(entry.name)
      )
        return [];
      return entry.isDirectory()
        ? Object.entries(snapshot(file, base))
        : [[path.relative(base, file), fs.readFileSync(file, "base64")]];
    }),
  );
}

test("old path segments are renamed wherever they name the folder, and nothing else", () => {
  assert.equal(
    renamePath("/comfy/view?filename=a.png&subfolder=heiss-ui%2Faccounts%2Fabc&type=media"),
    "/comfy/view?filename=a.png&subfolder=studio%2Faccounts%2Fabc&type=media",
  );
  assert.equal(renamePath("heiss-ui/image"), "studio/image");
  assert.equal(renamePath("/data/media/.heiss-trash/x"), "/data/media/.studio-trash/x");
  assert.equal(renamePath("heiss-ui-reference-1.png"), "heiss-ui-reference-1.png");
  assert.equal(renamePath("a heiss-ui fan"), "a heiss-ui fan");
  const text = '{\n  "heissUi": {"a": "heiss-ui/x"},\n    "b": ["heissUi"]\n}\n';
  assert.equal(
    rewriteJson(text, (at, value, key) =>
      key && at.length === 1 && value === "heissUi" ? "studio" : renamePath(value),
    ),
    '{\n  "studio": {"a": "studio/x"},\n    "b": ["heissUi"]\n}\n',
  );
});

test("the names migration plans, applies once and undoes to the original bytes", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-names-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const write = (rel: string, value: unknown) => {
    fs.mkdirSync(path.dirname(path.join(dataDir, rel)), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, rel),
      typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
    );
  };
  const url = "/comfy/view?filename=a.png&subfolder=heiss-ui%2Faccounts%2Fabc&type=media";
  const markerKey = crypto.randomBytes(32);
  const marker = (key: string) =>
    `h:${crypto.createHmac("sha256", markerKey).update(key).digest("base64url")}`;
  write(".gallery-marker-key", markerKey.toString("base64url"));
  write("media/heiss-ui/accounts/abc/a.png", "image");
  write("media/.heiss-trash/batch-1/files/heiss-ui/accounts/abc/b.png", "trashed");
  write("media/.heiss-trash/batch-1/batch.json", {
    items: [{ url: url.replace("a.png", "b.png") }],
    files: ["heiss-ui/accounts/abc/b.png"],
  });
  write("gallery.json", [{ id: url, url, status: "done", ownerId: "owner" }]);
  write("gallery-hidden.json", { [marker(url)]: 1 });
  const profile =
    '{\n"heissUi": {"name": "P"}, "graph": {"9": {"inputs": {"filename_prefix": "heiss-ui/image"}}}}';
  write("workflows/p.json", profile);
  write("history/profiles/p/1.json", { id: "p", version: 1, hash: sha(profile), text: profile });
  write("workflows/.studio-meta.json", { p: { seedHash: sha(profile), exportedHash: "" } });
  write("reference-assets/index.json", { a: { source: url } });
  write("logs/heiss-2026-10-19.log", "old");
  write("logs/studio-2026-10-20.log", "kept");
  const options = { mediaDir: path.join(dataDir, "media") };
  const before = snapshot(dataDir);

  const plan = planStudioNames(dataDir, options);
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.files, {
    "trash batches": 1,
    profiles: 1,
    "profile versions": 1,
    "profile records": 1,
    "other files": 1,
  });
  assert.deepEqual(plan.galleryByOwner, { owner: 1 });
  assert.equal(plan.markers, 1);
  assert.deepEqual(plan.logs, ["heiss-2026-10-19.log"]);
  assert.deepEqual(plan.missingFiles, []);
  assert.deepEqual(snapshot(dataDir), before);
  assert.throws(() => applyStudioNames(dataDir, options), /SQLite import/);

  assert.equal(migrateRuntime(dataDir, { apply: true }).applied, true);
  const applied = applyStudioNames(dataDir, options);
  assert.equal(applied.applied, true);
  const renamed = url.replace("heiss-ui", "studio");
  assert.equal(
    fs.readFileSync(path.join(dataDir, "media/studio/accounts/abc/a.png"), "utf8"),
    "image",
  );
  assert.ok(
    fs.existsSync(
      path.join(dataDir, "media/.studio-trash/batch-1/files/studio/accounts/abc/b.png"),
    ),
  );
  assert.deepEqual(readRuntimeDocument(dataDir, "gallery"), [
    { id: renamed, url: renamed, status: "done", ownerId: "owner" },
  ]);
  assert.deepEqual(readRuntimeDocument(dataDir, "gallery-hidden"), { [marker(renamed)]: 1 });
  const text = fs.readFileSync(path.join(dataDir, "workflows/p.json"), "utf8");
  assert.equal(
    text,
    '{\n"studio": {"name": "P"}, "graph": {"9": {"inputs": {"filename_prefix": "studio/image"}}}}',
  );
  const version = JSON.parse(
    fs.readFileSync(path.join(dataDir, "history/profiles/p/1.json"), "utf8"),
  );
  assert.deepEqual([version.text, version.hash], [text, sha(text)]);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(dataDir, "workflows/.studio-meta.json"), "utf8")).p
      .seedHash,
    sha(text),
  );
  assert.deepEqual(fs.readdirSync(path.join(dataDir, "logs")), ["studio-2026-10-20.log"]);
  assert.equal(
    fs.readFileSync(path.join(dataDir, "gallery.json"), "base64"),
    before["gallery.json"],
  );

  const again = applyStudioNames(dataDir, options);
  assert.deepEqual([again.alreadyRenamed, again.applied], [true, false]);
  assert.deepEqual(again.folders, []);
  assert.deepEqual(again.files, {});

  fs.mkdirSync(path.join(dataDir, "media/heiss-ui"));
  assert.match(planStudioNames(dataDir, options).conflicts[0], /already exists/);
  fs.rmdirSync(path.join(dataDir, "media/heiss-ui"));

  undoStudioNames(applied.backup);
  assert.deepEqual(snapshot(dataDir), before);
  assert.deepEqual(readRuntimeDocument(dataDir, "gallery"), [
    { id: url, url, status: "done", ownerId: "owner" },
  ]);
  assert.equal(planStudioNames(dataDir, options).alreadyRenamed, false);
});
