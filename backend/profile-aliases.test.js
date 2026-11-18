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

test("profileAliases names each record's current profile, also for a combined profile's lost per-backend ids, keeps the backend and drops the aliases once nothing is left", async (t) => {
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
  const profile = (id, backends) =>
    fs.writeFileSync(
      path.join(dataDir, "workflows", `${id}.json`),
      JSON.stringify({ studio: { id, ...(backends && { backends }) } }),
    );
  profile("image-krea2-quality");
  profile("image-fineporn-fast", { radiance: {}, comfyui: {} });
  profile("image-fineporn-fast-radiance");
  profile("image-flux2-klein-9b", { comfyui: {} });
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
    { id: "d", url: "/d.png", settings: { profileId: "custom:image-fineporn-fast-comfyui" } },
    { id: "e", url: "/e.png", settings: { profileId: "custom:image-flux2-klein-9b-comfyui" } },
  ]);
  writeRuntimeDocument(dataDir, "preferences:x", { images: "custom:video-old" });
  writeRuntimeDocument(dataDir, "workflow-preferences", {
    lastUsed: { "custom:video-old": "2026-01-01", "custom:video-new": "2026-02-01" },
  });

  const plan = await profileAliases(dataDir);
  assert.deepEqual(plan, {
    applied: false,
    aliases: 3,
    records: 5,
    renames: {
      "custom:image-fineporn-fast-comfyui": "custom:image-fineporn-fast",
      "custom:image-krea2-raw-quality": "custom:image-krea2-quality",
      "custom:image-krea2-quality-comfyui": "custom:image-krea2-quality",
      "custom:video-old": "custom:video-new",
    },
    unmatched: { "custom:image-other": 1, "custom:image-flux2-klein-9b-comfyui": 1 },
  });
  assert.ok(fs.existsSync(file));
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:x"), { images: "custom:video-old" });

  assert.deepEqual(await profileAliases(dataDir, { apply: true }), { ...plan, applied: true });
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
  assert.deepEqual(rows.d.settings, {
    profileId: "custom:image-fineporn-fast",
    profileBackend: "comfyui",
  });
  assert.deepEqual(rows.e.settings, { profileId: "custom:image-flux2-klein-9b-comfyui" });
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:x"), { images: "custom:video-new" });
  assert.deepEqual(readRuntimeDocument(dataDir, "workflow-preferences"), {
    lastUsed: { "custom:video-new": "2026-02-01" },
  });
  // The aliases stay until a run finds nothing a stale copy wrote back, then go.
  assert.ok(fs.existsSync(file));
  assert.deepEqual(await profileAliases(dataDir, { apply: true }), {
    ...plan,
    applied: true,
    records: 0,
  });
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(await profileAliases(dataDir, { apply: true }), {
    applied: true,
    aliases: 0,
    records: 0,
    renames: { "custom:image-fineporn-fast-comfyui": "custom:image-fineporn-fast" },
    unmatched: plan.unmatched,
  });
});
