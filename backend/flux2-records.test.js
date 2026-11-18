import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { flux2Records } from "./flux2-records.js";
import { readGalleryRows, writeGalleryRows } from "./persistence/gallery-rows.ts";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  runtimeDatabase,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

test("flux2Records gives FLUX.2 runs back their profile and leaves records with no model file", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-flux2-records-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const fast = "custom:image-flux3-klein-distilled-fast";
  const quality = "custom:image-flux3-klein-base-quality";
  writeGalleryRows(runtimeDatabase(dataDir), [
    {
      id: "kv",
      url: "/kv.png",
      model: fast,
      settings: { profileId: fast, modelName: "flux-2-klein-9b-kv-fp8.safetensors" },
    },
    {
      id: "base",
      url: "/base.png",
      model: quality,
      settings: { profileId: quality, modelName: "flux-2-klein-base-9b-fp8.safetensors" },
    },
    {
      id: "flux3",
      url: "/flux3.png",
      model: quality,
      settings: { profileId: quality, modelName: "flux3-image-klein-base-int8.safetensors" },
    },
    { id: "unknown", url: "/unknown.png", model: fast, settings: { profileId: fast } },
  ]);
  writeRuntimeDocument(dataDir, "preferences:x", { images: fast });

  const plan = flux2Records(dataDir);
  assert.deepEqual(plan, { applied: false, records: 2, unresolved: 2 });
  assert.equal(
    readGalleryRows(runtimeDatabase(dataDir)).find((row) => row.id === "kv").model,
    fast,
  );

  assert.deepEqual(flux2Records(dataDir, { apply: true }), { ...plan, applied: true });
  const rows = Object.fromEntries(
    readGalleryRows(runtimeDatabase(dataDir)).map((row) => [row.id, row]),
  );
  assert.equal(rows.kv.model, "custom:image-flux2-klein-9b-kv-fast");
  assert.equal(rows.kv.settings.profileId, "custom:image-flux2-klein-9b-kv-fast");
  assert.equal(rows.base.model, "custom:image-flux2-klein-9b-base-quality");
  assert.equal(rows.base.settings.profileId, "custom:image-flux2-klein-9b-base-quality");
  assert.equal(rows.flux3.settings.profileId, quality);
  assert.equal(rows.unknown.settings.profileId, fast);
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:x"), { images: fast });

  assert.deepEqual(flux2Records(dataDir, { apply: true }), {
    applied: true,
    records: 0,
    unresolved: 2,
  });
});
