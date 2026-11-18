import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readGalleryRows, writeGalleryRows } from "./persistence/gallery-rows.ts";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  runtimeDatabase,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";
import { profileAliases } from "./profile-aliases.js";

test("profileAliases names each record's current profile, keeps a combined run's backend and drops the aliases once nothing is left", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-profile-aliases-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const file = path.join(dataDir, "workflows", ".studio-aliases.json");
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(
    file,
    JSON.stringify({
      "image-krea2-raw-quality": { to: "image-krea2-quality", reason: "duplicate" },
      "image-krea2-quality-comfyui": { to: "image-krea2-raw-quality", backend: "comfyui" },
      "video-old": { to: "video-new", reason: "retired" },
    }),
  );
  writeGalleryRows(runtimeDatabase(dataDir), [
    {
      id: "a",
      url: "/a.png",
      model: "custom:image-krea2-quality-comfyui",
      settings: { profileId: "custom:image-krea2-quality-comfyui", seed: "custom:image-krea2" },
    },
    {
      id: "b",
      url: "/b.png",
      settings: { profileId: "custom:image-krea2-raw-quality", profileBackend: "radiance" },
    },
    { id: "c", url: "/c.png", settings: { profileId: "custom:image-other" } },
  ]);
  writeRuntimeDocument(dataDir, "preferences:x", { images: "custom:video-old" });
  writeRuntimeDocument(dataDir, "workflow-preferences", {
    lastUsed: { "custom:video-old": "2026-01-01", "custom:video-new": "2026-02-01" },
  });

  const plan = profileAliases(dataDir);
  assert.deepEqual(plan, {
    applied: false,
    aliases: 3,
    records: 4,
    renames: {
      "custom:image-krea2-raw-quality": "custom:image-krea2-quality",
      "custom:image-krea2-quality-comfyui": "custom:image-krea2-quality",
      "custom:video-old": "custom:video-new",
    },
  });
  assert.ok(fs.existsSync(file));
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:x"), { images: "custom:video-old" });

  assert.deepEqual(profileAliases(dataDir, { apply: true }), { ...plan, applied: true });
  const rows = Object.fromEntries(
    readGalleryRows(runtimeDatabase(dataDir)).map((row) => [row.id, row]),
  );
  assert.equal(rows.a.model, "custom:image-krea2-quality");
  assert.deepEqual(rows.a.settings, {
    profileId: "custom:image-krea2-quality",
    profileBackend: "comfyui",
    seed: "custom:image-krea2",
  });
  assert.deepEqual(rows.b.settings, {
    profileId: "custom:image-krea2-quality",
    profileBackend: "radiance",
  });
  assert.deepEqual(rows.c.settings, { profileId: "custom:image-other" });
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:x"), { images: "custom:video-new" });
  assert.deepEqual(readRuntimeDocument(dataDir, "workflow-preferences"), {
    lastUsed: { "custom:video-new": "2026-02-01" },
  });
  // The aliases stay until a run finds nothing a stale copy wrote back, then go.
  assert.ok(fs.existsSync(file));
  assert.deepEqual(profileAliases(dataDir, { apply: true }), {
    ...plan,
    applied: true,
    records: 0,
  });
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(profileAliases(dataDir, { apply: true }), {
    applied: true,
    aliases: 0,
    records: 0,
    renames: {},
  });
});
