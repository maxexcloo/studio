import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { combinedProfiles } from "./combined-profiles.js";

test("combines already applied move preferences and LoRA stacks and prune bindings of gone profiles, once", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-combined-profiles-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const write = (rel, value) => {
    fs.mkdirSync(path.dirname(path.join(dataDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dataDir, rel), JSON.stringify(value, null, 2));
  };
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(dataDir, rel), "utf8"));
  write("workflows/image-krea2-turbo.json", { studio: { id: "image-krea2-turbo" } });
  write("workflows/.studio-aliases.json", {
    "image-krea2-turbo-comfyui": { to: "image-krea2-turbo", backend: "comfyui" },
    "image-krea2-turbo-radiance": { to: "image-krea2-turbo", backend: "radiance" },
  });
  write("workflow-preferences.json", {
    favorites: ["custom:image-krea2-turbo-comfyui"],
    lastUsed: {
      "custom:image-krea2-turbo": "2026-10-01T00:00:00.000Z",
      "custom:image-krea2-turbo-radiance": "2026-10-27T00:00:00.000Z",
    },
    thumbnails: {},
  });
  write("accounts/abc/lora-stacks.json", {
    stacks: { "custom:image-krea2-turbo-comfyui": [{ name: "detail" }] },
    library: { strengths: { "custom:image-krea2-turbo-radiance": { detail: 0.4 } } },
  });
  write("guides/prompting.json", {
    packs: { krea2: { summary: "Krea." } },
    families: {},
    profiles: {
      "custom:image-krea2-turbo": { pack: "krea2" },
      "custom:image-krea2-turbo-comfyui": { pack: "krea2" },
    },
    negatives: { "custom:image-krea2-turbo-radiance": { effect: "none" } },
    variants: {},
    meta: {},
  });

  const planned = combinedProfiles(dataDir);
  assert.deepEqual(planned, {
    applied: false,
    preferences: 2,
    loraStacks: { [path.join("accounts", "abc", "lora-stacks.json")]: 2 },
    guideBindings: ["custom:image-krea2-turbo-comfyui", "custom:image-krea2-turbo-radiance"],
  });
  assert.deepEqual(read("workflow-preferences.json").favorites, [
    "custom:image-krea2-turbo-comfyui",
  ]);

  assert.equal(combinedProfiles(dataDir, { apply: true }).applied, true);
  assert.deepEqual(read("workflow-preferences.json"), {
    favorites: ["custom:image-krea2-turbo"],
    lastUsed: { "custom:image-krea2-turbo": "2026-10-27T00:00:00.000Z" },
    thumbnails: {},
  });
  const stacks = read("accounts/abc/lora-stacks.json");
  assert.deepEqual(Object.keys(stacks.stacks), ["custom:image-krea2-turbo"]);
  assert.deepEqual(stacks.library.strengths, { "custom:image-krea2-turbo": { detail: 0.4 } });
  const guides = read("guides/prompting.json");
  assert.deepEqual(Object.keys(guides.profiles), ["custom:image-krea2-turbo"]);
  assert.deepEqual(guides.negatives, {});
  assert.equal(guides.meta._bindings.by, "migrate-runtime");

  assert.deepEqual(combinedProfiles(dataDir), {
    applied: false,
    preferences: 0,
    loraStacks: {},
    guideBindings: [],
  });
});
