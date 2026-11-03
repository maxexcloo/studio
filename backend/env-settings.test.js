import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { envSettings } from "./env-settings.js";
import { restoreRuntimeBackup } from "./persistence/migration.ts";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

function dataFolder(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-env-settings-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return dataDir;
}

test("Settings values move from the env file to SQLite once, with a restorable backup", (t) => {
  const dataDir = dataFolder(t);
  const file = path.join(dataDir, ".env");
  const original =
    "# Studio\nSTUDIO_DEMO=1\nSTUDIO_DEFAULT_IMAGE_PROFILE=profile-a\nSTUDIO_ENABLE_LORAS=0\nSTUDIO_GALLERY_CAPTIONS=\n";
  fs.writeFileSync(file, original);
  writeRuntimeDocument(dataDir, "settings", {
    STUDIO_DEFAULT_IMAGE_PROFILE: "profile-old",
    STUDIO_IMAGE_SEARCH: "0",
  });
  const stored = JSON.stringify(readRuntimeDocument(dataDir, "settings"));
  const plan = {
    moved: ["STUDIO_DEFAULT_IMAGE_PROFILE"],
    replaced: ["STUDIO_DEFAULT_IMAGE_PROFILE"],
    removed: ["STUDIO_ENABLE_LORAS", "STUDIO_GALLERY_CAPTIONS"],
    kept: ["STUDIO_DEMO"],
  };

  const dry = envSettings(dataDir);
  assert.deepEqual(dry, { ...plan, applied: false, backup: "" });
  assert.equal(fs.readFileSync(file, "utf8"), original, "a dry run writes nothing");
  // The report names keys only.
  assert.doesNotMatch(JSON.stringify(dry), /profile-a|profile-old/);

  const applied = envSettings(dataDir, { apply: true });
  assert.equal(applied.applied, true);
  assert.deepEqual(readRuntimeDocument(dataDir, "settings"), {
    STUDIO_DEFAULT_IMAGE_PROFILE: "profile-a",
    STUDIO_IMAGE_SEARCH: "0",
  });
  assert.equal(fs.readFileSync(file, "utf8"), "# Studio\nSTUDIO_DEMO=1\n");
  assert.deepEqual(envSettings(dataDir, { apply: true }), {
    moved: [],
    replaced: [],
    removed: [],
    kept: ["STUDIO_DEMO"],
    applied: false,
    backup: "",
  });

  const destination = path.join(dataDir, "restore");
  assert.deepEqual(restoreRuntimeBackup(applied.backup, destination), { restored: 2 });
  assert.equal(fs.readFileSync(path.join(destination, ".env"), "utf8"), original);
  assert.equal(fs.readFileSync(path.join(destination, "settings.json"), "utf8"), stored);
});

test("an env file left with nothing goes, and no database is created for removals", (t) => {
  const dataDir = dataFolder(t);
  fs.writeFileSync(path.join(dataDir, ".env"), "STUDIO_ENABLE_INPAINT=0\n");
  assert.equal(envSettings(dataDir, { apply: true }).applied, true);
  assert.equal(fs.existsSync(path.join(dataDir, ".env")), false);
  assert.equal(fs.existsSync(path.join(dataDir, "studio.sqlite")), false);
});
