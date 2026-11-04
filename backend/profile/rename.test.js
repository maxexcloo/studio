import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { restoreRuntimeBackup } from "../persistence/migration.ts";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "../persistence/runtime.ts";
import { profileIds } from "./rename.js";
import { createGuideStore, createProfileStore } from "./store.js";

const graph = { 1: { class_type: "CLIPTextEncode", inputs: { text: "" } } };
const profile = (id) => ({ studio: { id, name: id, kind: "image", family: "moss_image" }, graph });

test("profileIds renames profiles and guides, keeps old ids resolving, and runs once", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-profile-ids-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const file = (name) => path.join(dataDir, name);
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(file(name)), { recursive: true });
    fs.writeFileSync(file(name), JSON.stringify(value));
  };
  const read = (name) => JSON.parse(fs.readFileSync(file(name), "utf8"));
  const old = "image-moss-sft-comfyui";
  const renamed = "image-moss-sft-quality";
  write(`workflows/${old}.json`, profile(old));
  // Its new id is already another profile's: listed, never renamed.
  write("workflows/image-krea2-turbo.json", profile("image-krea2-turbo"));
  write("workflows/image-krea2-turbo-fast.json", profile("image-krea2-turbo-fast"));
  const profiles = createProfileStore({ dataDir, log: {} });
  profiles.record(old, fs.readFileSync(file(`workflows/${old}.json`), "utf8"), {
    origin: "seed",
  });
  write("guides/prompting.json", {
    packs: { moss_image: { name: "MOSS Image", summary: "MOSS." } },
    meta: {},
    families: { moss_image: { image: "moss_image" } },
    profiles: { [`custom:${old}`]: { pack: "moss_image" } },
    variants: {},
    negatives: { [`custom:${old}`]: { text: "blurry" } },
  });
  writeRuntimeDocument(dataDir, "accounts", {
    version: 1,
    accounts: [],
    profiles: { artists: { id: "artists", generationProfiles: [`custom:${old}`, "custom:other"] } },
  });
  write("workflow-preferences.json", {
    favorites: [`custom:${old}`],
    lastUsed: { [`custom:${old}`]: "2026-11-01" },
  });
  write("timings.json", { runs: [{ key: `image:custom:${old}@comfyui`, seconds: 9 }] });

  const plan = profileIds(dataDir);
  assert.deepEqual(plan.profiles, [{ from: old, to: renamed }]);
  assert.deepEqual(plan.guides, [{ from: "moss_image", to: "moss-image" }]);
  assert.deepEqual(
    plan.conflicts.map(({ from, to }) => [from, to]),
    [["image-krea2-turbo", "image-krea2-turbo-fast"]],
  );
  assert.deepEqual(
    [plan.bindings, plan.grants, plan.preferences, plan.timings],
    [2, { artists: 1 }, 2, 1],
  );
  assert.ok(fs.existsSync(file(`workflows/${old}.json`)), "a dry run writes nothing");
  assert.equal(fs.existsSync(file(".backups")), false);

  const applied = profileIds(dataDir, { apply: true });
  assert.equal(applied.applied, true);
  assert.equal(fs.existsSync(file(`workflows/${old}.json`)), false);
  assert.equal(read(`workflows/${renamed}.json`).studio.id, renamed);
  const store = createProfileStore({ dataDir, log: {} });
  assert.equal(store.canonical(`custom:${old}`), `custom:${renamed}`, "the old id still resolves");
  assert.deepEqual(
    store.versions(renamed).map(({ version, note }) => [version, note]),
    [
      [2, `Renamed from ${old}`],
      [1, undefined],
    ],
  );
  const guides = createGuideStore({ dataDir }).read();
  assert.deepEqual(Object.keys(guides.packs), ["moss-image"]);
  assert.deepEqual(guides.families.moss_image, { image: "moss-image" });
  assert.deepEqual(guides.profiles, { [`custom:${renamed}`]: { pack: "moss-image" } });
  assert.deepEqual(Object.keys(guides.negatives), [`custom:${renamed}`]);
  assert.deepEqual(readRuntimeDocument(dataDir, "accounts").profiles.artists.generationProfiles, [
    `custom:${renamed}`,
    "custom:other",
  ]);
  assert.deepEqual(read("workflow-preferences.json").favorites, [`custom:${renamed}`]);
  assert.equal(read("timings.json").runs[0].key, `image:custom:${renamed}@comfyui`);

  const restored = path.join(dataDir, "restored");
  restoreRuntimeBackup(applied.backup, restored);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(restored, "workflows", `${old}.json`))).studio.id,
    old,
  );
  assert.ok(fs.existsSync(path.join(restored, "history", "profiles", old, "1.json")));
  assert.ok(
    JSON.parse(fs.readFileSync(path.join(restored, "accounts.json"))).profiles.artists
      .generationProfiles[0] === `custom:${old}`,
  );

  const again = profileIds(dataDir, { apply: true });
  assert.deepEqual(
    [again.applied, again.profiles, again.guides, again.bindings, again.grants, again.timings],
    [false, [], [], 0, {}, 0],
  );
});
