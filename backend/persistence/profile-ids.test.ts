import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { migrateRuntime } from "./migration.ts";
import { remapProfileIds, renamedProfileIds } from "./profile-ids.ts";
import { closeRuntimeDatabase, readRuntimeDocument } from "./runtime.ts";

test("every old id maps to a current id", () => {
  for (const [old, next] of Object.entries(renamedProfileIds)) {
    assert.ok(next, old);
    assert.equal(renamedProfileIds[next], undefined, `${old} → ${next} is renamed again`);
  }
});

test("old profile ids are rewritten in records, grants, preferences and stacks, once", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-profile-ids-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const write = (rel: string, value: unknown) => {
    fs.mkdirSync(path.dirname(path.join(dataDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dataDir, rel), JSON.stringify(value, null, 2));
  };
  const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(dataDir, rel), "utf8"));
  const record = (id: string) => ({
    model: id,
    settings: { workflow: id, profileId: id },
  });
  write("gallery.json", [
    record("custom:bento-image-kroma-turbo-w8a8"),
    record("custom:image-moss-sft"),
    record("custom:image-boogu-base"),
  ]);
  write("accounts.json", {
    accounts: [],
    accessProfiles: {
      user: {
        generationProfiles: ["custom:h3-ref-pdd8", "custom:video-h3-reference-fast-comfyui"],
      },
    },
  });
  write("workflow-preferences.json", {
    favorites: ["custom:bento-radiance-fasth3-8"],
    lastUsed: {
      "custom:bento-image-moss-sft": "2026-10-20T00:00:00.000Z",
      "custom:image-moss-sft-comfyui": "2026-10-27T00:00:00.000Z",
      "custom:bento-image-radiance-turbo": "2026-10-19T00:00:00.000Z",
    },
    thumbnails: {},
  });
  write("accounts/abc/lora-stacks.json", { stacks: { "custom:bento-h3-ref-pdd8-guided": [] } });
  write("guides/prompting.json", { profiles: { "custom:h3-ref-pdd8": {} } });
  migrateRuntime(dataDir, { apply: true });

  const plan = remapProfileIds(dataDir);
  assert.equal(plan.applied, false);
  assert.deepEqual(plan.stores, {
    "accounts/abc/lora-stacks.json": 1,
    "sqlite:accounts": 1,
    "sqlite:gallery": 6,
    "workflow-preferences.json": 3,
  });
  const gallery = () => readRuntimeDocument(dataDir, "gallery") as ReturnType<typeof record>[];
  assert.equal(gallery()[0].model, "custom:bento-image-kroma-turbo-w8a8");

  assert.equal(remapProfileIds(dataDir, { apply: true }).applied, true);
  assert.deepEqual(gallery(), [
    record("custom:image-kroma-turbo-fast-comfyui"),
    record("custom:image-moss-sft-comfyui"),
    record("custom:image-boogu-base"),
  ]);
  assert.deepEqual(
    (
      readRuntimeDocument(dataDir, "accounts") as {
        accessProfiles: { user: { generationProfiles: string[] } };
      }
    ).accessProfiles.user.generationProfiles,
    ["custom:video-h3-reference-fast-comfyui"],
  );
  assert.deepEqual(read("workflow-preferences.json"), {
    favorites: ["custom:video-fasth3-v2-fast-radiance"],
    lastUsed: {
      "custom:image-moss-sft-comfyui": "2026-10-27T00:00:00.000Z",
      "custom:image-qwen-image-2.1-turbo-uncensored-radiance": "2026-10-19T00:00:00.000Z",
    },
    thumbnails: {},
  });
  assert.deepEqual(read("accounts/abc/lora-stacks.json").stacks, {
    "custom:video-h3-reference-fast-comfyui": [],
  });
  // Guides are versioned definitions, and the imported JSON stays as it was.
  assert.deepEqual(read("guides/prompting.json").profiles, { "custom:h3-ref-pdd8": {} });
  assert.equal(read("gallery.json")[0].model, "custom:bento-image-kroma-turbo-w8a8");

  assert.deepEqual(remapProfileIds(dataDir).stores, {});
});
