import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { accountAccess } from "./account-migration.js";
import { restoreRuntimeBackup } from "./persistence/migration.ts";

test("waiting accounts join the default group and groups keep only the features Studio reads, once", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-account-access-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const file = path.join(dataDir, "accounts.json");
  const original = {
    version: 1,
    requireApproval: true,
    accounts: [
      { id: "admin", username: "admin@example.com", role: "administrator" },
      { id: "member", username: "member@example.com", role: "user", accessProfileId: "artists" },
      { id: "waiting", username: "waiting@example.com", role: "user", pending: true },
    ],
    profiles: {
      artists: {
        id: "artists",
        name: "Artists",
        allModels: true,
        generationProfiles: [],
        features: { loras: true, cloudModels: false, gallery: true, promptAssistant: false },
      },
    },
  };
  fs.writeFileSync(file, JSON.stringify(original));
  const text = fs.readFileSync(file, "utf8");

  const plan = accountAccess(dataDir);
  assert.deepEqual(
    [plan.applied, plan.defaultGroup, plan.joined, plan.groups],
    [
      false,
      "user",
      [{ id: "waiting", username: "waiting@example.com" }],
      {
        artists: {
          removed: ["gallery", "promptAssistant"],
          granted: [
            "imageGeneration",
            "imageReferences",
            "promptAssistant",
            "promptHistory",
            "upscale",
            "videoGeneration",
            "videoReferences",
          ],
        },
      },
    ],
  );
  assert.equal(fs.readFileSync(file, "utf8"), text, "a dry run writes nothing");

  const applied = accountAccess(dataDir, { apply: true });
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(applied.applied, true);
  assert.equal(saved.requireApproval, undefined);
  assert.equal(saved.defaultAccessProfileId, "user");
  assert.deepEqual(saved.profiles.user.features, {
    chat: true,
    cloudModels: false,
    dream: true,
    loras: false,
    uncensoredModels: false,
  });
  assert.deepEqual(saved.profiles.artists.features, {
    chat: true,
    cloudModels: false,
    dream: true,
    loras: true,
    uncensoredModels: false,
  });
  assert.deepEqual(
    saved.accounts.map((account) => [account.id, account.accessProfileId, account.pending]),
    [
      ["admin", undefined, undefined],
      ["member", "artists", undefined],
      ["waiting", "user", undefined],
    ],
  );
  assert.deepEqual(accountAccess(dataDir), {
    applied: false,
    backup: "",
    defaultGroup: "",
    joined: [],
    groups: {},
  });

  const restored = path.join(dataDir, "restore-rehearsal");
  restoreRuntimeBackup(applied.backup, restored);
  assert.equal(fs.readFileSync(path.join(restored, "accounts.json"), "utf8"), text);
});
