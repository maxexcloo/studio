import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pruneBackups } from "./prune-backups.js";

test("pruneBackups lists the backup folders with sizes, then deletes them", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-prune-backups-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  assert.deepEqual(pruneBackups(dataDir).folders, []);

  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(dataDir, file)), { recursive: true });
    fs.writeFileSync(path.join(dataDir, file), text);
  };
  write("backups/profile-removals/2026-11-01/fox.json", "{}");
  write("backups/profile-merges/2026-11-02/a/b.json", "[1,2]");
  write(".backups/account-access-1/mapping.json", '{"a":1}');
  write("studio.sqlite", "kept");
  write("media/fox.png", "kept");

  const plan = pruneBackups(dataDir);
  assert.equal(plan.applied, false);
  assert.match(plan.note, /no --restore/);
  assert.deepEqual(plan.folders, [
    { path: "backups/profile-merges", bytes: 5 },
    { path: "backups/profile-removals", bytes: 2 },
    { path: ".backups/account-access-1", bytes: 7 },
  ]);
  assert.equal(plan.bytes, 14);
  assert.ok(fs.existsSync(path.join(dataDir, "backups")), "a dry run deletes nothing");

  assert.equal(pruneBackups(dataDir, { apply: true }).applied, true);
  assert.deepEqual(fs.readdirSync(dataDir).sort(), ["media", "studio.sqlite"]);
  assert.deepEqual(pruneBackups(dataDir, { apply: true }), {
    applied: false,
    note: plan.note,
    folders: [],
    bytes: 0,
  });
});
