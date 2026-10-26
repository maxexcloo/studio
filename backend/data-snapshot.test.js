import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { databaseFile } from "./persistence/runtime.ts";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-snapshot-"));
process.env.STUDIO_DATA_DIR = dataDir;
const { pruneSnapshots, snapshotIfNewVersion } = await import("./data-snapshot.js");
const backups = path.join(dataDir, ".backups");
const day = 86_400_000;
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test("a fresh install has nothing to keep, and only notes its version", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "studio-snapshot-empty-"));
  assert.equal(snapshotIfNewVersion({ dataDir: empty, version: "0.12.0" }), "");
  assert.equal(fs.readFileSync(path.join(empty, ".version"), "utf8").trim(), "0.12.0");
  assert.equal(fs.existsSync(path.join(empty, ".backups")), false);
});

test("a new version copies the state files, not thumbnails, references or backups", () => {
  fs.rmSync(path.join(dataDir, ".version"), { force: true });
  fs.writeFileSync(path.join(dataDir, "gallery.json"), "[1]");
  fs.writeFileSync(path.join(dataDir, "access.json"), "{}", { mode: 0o600 });
  fs.mkdirSync(path.join(dataDir, ".private-vault", "assets"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, ".private-vault", "assets", "a.bin"), "sealed");
  fs.mkdirSync(path.join(dataDir, "backups", "hidden-removal-x"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "backups", "hidden-removal-x", "gallery.json"), "[]");
  fs.mkdirSync(path.join(dataDir, ".thumbnails"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, ".thumbnails", "t.webp"), "thumb");
  fs.mkdirSync(path.join(dataDir, "reference-assets"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "reference-assets", "r.png"), "ref");

  const target = snapshotIfNewVersion({ dataDir, version: "0.12.0" });
  assert.match(path.basename(target), /^earlier-to-0\.12\.0-/);
  assert.equal(fs.readFileSync(path.join(target, "gallery.json"), "utf8"), "[1]");
  assert.equal(fs.existsSync(path.join(target, "access.json")), true);
  assert.equal(fs.existsSync(path.join(target, ".private-vault")), false);
  assert.equal(fs.existsSync(path.join(target, "backups")), false);
  assert.equal(fs.existsSync(path.join(target, ".thumbnails")), false);
  assert.equal(fs.existsSync(path.join(target, "reference-assets")), false);
  assert.equal(fs.existsSync(path.join(target, ".backups")), false, "never copies itself");
  if (process.platform !== "win32") assert.equal(fs.statSync(target).mode & 0o777, 0o700);

  assert.equal(
    snapshotIfNewVersion({ dataDir, version: "0.12.0" }),
    "",
    "the same version again takes none",
  );
  const next = snapshotIfNewVersion({ dataDir, version: "0.12.1" });
  assert.match(path.basename(next), /^0\.12\.0-to-0\.12\.1-/);
});

test("snapshots go after 14 days, and never more than three stay", () => {
  const now = Date.now();
  for (let i = 0; i < 4; i += 1)
    snapshotIfNewVersion({ dataDir, version: `0.13.${i}`, now: now + i * 1000 });
  assert.equal(fs.readdirSync(backups).length, 3);
  assert.equal(pruneSnapshots({ dataDir, now: now + 15 * day }), 3);
  assert.deepEqual(fs.readdirSync(backups), []);
});

test("a SQLite snapshot restores committed WAL data as a consistent standalone database", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "studio-snapshot-wal-"));
  const live = new DatabaseSync(databaseFile(directory));
  t.after(() => {
    live.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  live.exec(
    "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE saved (value TEXT); INSERT INTO saved VALUES ('before snapshot');",
  );
  assert.ok(fs.statSync(`${databaseFile(directory)}-wal`).size > 0);
  const target = snapshotIfNewVersion({ dataDir: directory, version: "test-snapshot" });
  live.exec("INSERT INTO saved VALUES ('after snapshot')");
  const restored = new DatabaseSync(databaseFile(target), { readOnly: true });
  try {
    assert.equal(restored.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(
      restored
        .prepare("SELECT value FROM saved")
        .all()
        .map((row) => row.value),
      ["before snapshot"],
    );
  } finally {
    restored.close();
  }
});
