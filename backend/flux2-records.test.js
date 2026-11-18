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

test("flux2Records gives FLUX.2 runs back their profile by model file, profile name or text encoder, and leaves records naming none", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-flux2-records-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const fast = "custom:image-flux3-klein-distilled-fast";
  const quality = "custom:image-flux3-klein-base-quality";
  const encoder = "qwen_3_8b_fp8mixed.safetensors";
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
    {
      id: "named-kv",
      url: "/named-kv.png",
      model: quality,
      settings: {
        profileId: quality,
        profileName: "FLUX.2 [klein] 9B KV · Fast · 4 Steps · 4 References",
      },
    },
    {
      id: "named-base",
      url: "/named-base.png",
      model: fast,
      settings: {
        profileId: fast,
        profileName: "FLUX.2 [klein] 9B Base · Quality · 50 Steps · 4 References",
        textEncoder: encoder,
        steps: 4,
      },
    },
    {
      id: "named-flux3",
      url: "/named-flux3.png",
      model: fast,
      settings: { profileId: fast, profileName: "FLUX.3 [klein] · Fast", textEncoder: encoder },
    },
    {
      id: "encoder-kv",
      url: "/encoder-kv.png",
      model: quality,
      settings: { profileId: quality, textEncoder: encoder, steps: 4 },
    },
    {
      id: "encoder-base",
      url: "/encoder-base.png",
      model: fast,
      settings: { profileId: fast, textEncoder: encoder, steps: 50, cfg: 4 },
    },
    { id: "unknown", url: "/unknown.png", model: fast, settings: { profileId: fast } },
  ]);
  writeRuntimeDocument(dataDir, "preferences:x", { images: fast });

  const plan = flux2Records(dataDir);
  assert.deepEqual(plan, {
    applied: false,
    records: 6,
    modelFile: 2,
    profileName: 2,
    textEncoder: 2,
    unresolved: 2,
  });
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
  assert.equal(rows["named-kv"].model, "custom:image-flux2-klein-9b-kv-fast");
  assert.equal(rows["named-base"].settings.profileId, "custom:image-flux2-klein-9b-base-quality");
  assert.equal(rows["named-flux3"].settings.profileId, fast);
  assert.equal(rows["encoder-kv"].settings.profileId, "custom:image-flux2-klein-9b-kv-fast");
  assert.equal(rows["encoder-base"].model, "custom:image-flux2-klein-9b-base-quality");
  assert.equal(rows.unknown.settings.profileId, fast);
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:x"), { images: fast });

  assert.deepEqual(flux2Records(dataDir, { apply: true }), {
    applied: true,
    records: 0,
    modelFile: 0,
    profileName: 0,
    textEncoder: 0,
    unresolved: 2,
  });
});
