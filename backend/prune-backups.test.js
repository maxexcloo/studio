import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pruneBackups } from "./prune-backups.js";

test("pruneBackups lists the backups and old logs with sizes, then deletes them", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-prune-backups-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  assert.deepEqual(pruneBackups(dataDir).paths, []);

  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(dataDir, file)), { recursive: true });
    fs.writeFileSync(path.join(dataDir, file), text);
  };
  write("backups/profile-removals/2026-11-01/fox.json", "{}");
  write(".backups/a-to-b/mapping.json", '{"a":1}');
  write(".version", "abc\n");
  write("logs/studio-2026-11-01.log", "log");
  write("workflows/.studio-meta.json.bak", "{}");
  write("workflows/.studio-meta.json", "kept");
  write("studio.sqlite", "kept");
  write("media/fox.json.bak", "kept");

  const plan = pruneBackups(dataDir);
  assert.equal(plan.applied, false);
  assert.deepEqual(plan.paths, [
    { path: "backups", bytes: 2 },
    { path: ".backups", bytes: 7 },
    { path: "logs", bytes: 3 },
    { path: ".version", bytes: 4 },
    { path: "workflows/.studio-meta.json.bak", bytes: 2 },
  ]);
  assert.equal(plan.bytes, 18);
  assert.ok(fs.existsSync(path.join(dataDir, "backups")), "a dry run deletes nothing");

  assert.equal(pruneBackups(dataDir, { apply: true }).applied, true);
  assert.deepEqual(fs.readdirSync(dataDir).sort(), ["media", "studio.sqlite", "workflows"]);
  assert.deepEqual(fs.readdirSync(path.join(dataDir, "workflows")), [".studio-meta.json"]);
  assert.deepEqual(pruneBackups(dataDir, { apply: true }).paths, []);
});
