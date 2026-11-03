import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Store } from "./domain/store.ts";
import { legacyRecords } from "./legacy-records.js";
import { restoreRuntimeBackup } from "./persistence/migration.ts";
import { readGalleryRows, writeGalleryRows } from "./persistence/gallery-rows.ts";
import { closeRuntimeDatabase, runtimeDatabase } from "./persistence/runtime.ts";

test("older record shapes become today's once, with a restorable backup", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-legacy-records-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(dataDir, file)), { recursive: true });
    fs.writeFileSync(path.join(dataDir, file), JSON.stringify(value));
  };
  const read = (file) => JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));
  write("workflows/krea.json", { studio: { id: "krea", family: "krea2" } });
  const owner = crypto.createHash("sha256").update("account-a").digest("hex");
  const stack = (id) => ({ id, name: id, loras: [] });
  write(`accounts/${owner}/lora-stacks.json`, {
    stacks: {},
    library: {
      snapshots: {
        "family:krea2": [stack("current")],
        "custom:krea": [stack("current"), stack("old")],
        "custom:gone": [stack("lost")],
      },
    },
  });
  write("model-types.json", {
    "unet:a.safetensors": "z-image",
    "unet:b.safetensors": "wan",
    "checkpoint:c.safetensors": "checkpoint",
    "unet:d.safetensors": "zimage/turbo",
  });
  const db = runtimeDatabase(dataDir);
  writeGalleryRows(db, [
    { id: "single", url: "/single", startImageId: "asset-1", referenceImage: "asset-1" },
    {
      id: "both",
      url: "/both",
      startImageId: "asset-2",
      referenceImageName: "",
      settings: { referenceAssets: [{ slot: "image", assetId: "asset-2" }] },
    },
    { id: "plain", url: "/plain", settings: { referenceAssets: [] } },
  ]);
  const store = new Store(db);
  const session = store.createSession("account-a");
  const job = (id, createdAt) =>
    db
      .prepare("INSERT INTO studio_queue VALUES (?, ?, ?, ?, 'completed', ?)")
      .run(id, "account-a", session.id, createdAt, JSON.stringify({ id }));
  job("first", "2026-10-01T00:00:00Z");
  job("second", "2026-10-02T00:00:00Z");
  const message = (id, content, sourceJobId) =>
    db.prepare("INSERT INTO studio_chat_messages VALUES (?, ?, ?, ?)").run(
      id,
      "account-a",
      session.id,
      JSON.stringify({
        id,
        role: "user",
        content,
        revision: { sourceJobId, operation: "refine" },
      }),
    );
  message("whole-prompt", "A fox in the snow, golden hour", "second");
  message("elsewhere", "A fox in the rain", "not-in-this-chat");
  message("current", "Animate iteration 1", "first");

  const plan = legacyRecords(dataDir);
  assert.deepEqual(plan, {
    loraStacks: {
      [`accounts/${owner}/lora-stacks.json`]: [
        { from: "custom:krea", to: "family:krea2", stacks: 2 },
      ],
    },
    unresolved: [{ file: `accounts/${owner}/lora-stacks.json`, key: "custom:gone" }],
    modelChoices: { "z-image → zimage": 1, "wan → wan22_5b": 1, "checkpoint → (removed)": 1 },
    galleryReferences: { records: 2, gained: 1 },
    chatRequests: 2,
    applied: false,
    backup: "",
  });
  assert.equal(
    read("model-types.json")["unet:a.safetensors"],
    "z-image",
    "a dry run writes nothing",
  );

  const applied = legacyRecords(dataDir, { apply: true });
  assert.equal(applied.applied, true);
  assert.deepEqual(read(`accounts/${owner}/lora-stacks.json`).library.snapshots, {
    "family:krea2": [stack("current"), stack("old")],
    "custom:gone": [stack("lost")],
  });
  assert.deepEqual(read("model-types.json"), {
    "unet:a.safetensors": "zimage",
    "unet:b.safetensors": "wan22_5b",
    "unet:d.safetensors": "zimage/turbo",
  });
  const rows = Object.fromEntries(readGalleryRows(db).map((item) => [item.id, item]));
  assert.deepEqual(rows.single, {
    id: "single",
    url: "/single",
    settings: { referenceAssets: [{ slot: "reference", assetId: "asset-1" }] },
  });
  assert.deepEqual(rows.both.settings.referenceAssets, [{ slot: "image", assetId: "asset-2" }]);
  assert.equal("startImageId" in rows.both, false);
  assert.deepEqual(
    Object.fromEntries(
      db
        .prepare("SELECT id, record FROM studio_chat_messages")
        .all()
        .map((row) => [row.id, JSON.parse(row.record).content]),
    ),
    {
      "whole-prompt": "Edit iteration 2",
      elsewhere: "Edit this result",
      current: "Animate iteration 1",
    },
  );

  const again = legacyRecords(dataDir, { apply: true });
  assert.equal(again.applied, false, "a second run finds nothing");
  assert.deepEqual(
    [again.loraStacks, again.modelChoices, again.galleryReferences, again.chatRequests],
    [{}, {}, { records: 0, gained: 0 }, 0],
  );

  const restored = path.join(dataDir, "restore-rehearsal");
  assert.deepEqual(restoreRuntimeBackup(applied.backup, restored), { restored: 4 });
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(restored, "model-types.json"), "utf8"))[
      "unet:a.safetensors"
    ],
    "z-image",
  );
  assert.ok(
    JSON.parse(fs.readFileSync(path.join(restored, `accounts/${owner}/lora-stacks.json`), "utf8"))
      .library.snapshots["custom:krea"],
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(restored, "studio_gallery.json"), "utf8")).length,
    2,
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(restored, "studio_chat_messages.json"), "utf8")).length,
    2,
  );
});
