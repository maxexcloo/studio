import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-profile-merge-"));
process.env.STUDIO_DATA_DIR = temporary;
process.env.STUDIO_WORKERS = JSON.stringify([
  {
    id: "primary",
    url: "http://127.0.0.1:9",
    capabilities: ["image", "video", "upscale", "models"],
  },
]);
const { duplicateProfiles, mergeDuplicateProfiles } = await import("./profile-merge.js");
const { canonicalProfileId, guideStore, profileStore } = await import("./profile-store.js");
const { getCustomWorkflow, userWorkflowsDir } = await import("./custom-workflows.js");
const { buildExport } = await import("./profile-export.js");
const { profileStats } = await import("./stats.js");
const { matchesGalleryFilters } = await import("./gallery-filters.js");
const { effectiveAccountAccess, mayUseGenerationProfile } = await import("./account-policy.js");
const { findProfile } = await import("./mcp-tiers.js");
const { loadWorkflowPreferences, saveWorkflowPreferences } = await import("./workflow-catalog.js");
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

const graph = (model) => ({
  1: { class_type: "UNETLoader", inputs: { unet_name: model }, _meta: { title: "Model" } },
  2: { class_type: "CLIPTextEncode", inputs: { text: "" } },
});
const profile = (id, name, { model = "h3.safetensors", description = "" } = {}) =>
  `${JSON.stringify(
    {
      studio: {
        id,
        name,
        description,
        kind: "image",
        family: "flux",
        controls: { prompt: { node: "2", input: "text" } },
      },
      graph: graph(model),
    },
    null,
    2,
  )}\n`;
const write = (id, text) => fs.writeFileSync(path.join(userWorkflowsDir, `${id}.json`), text);
const oldId = "h3-fl-pdd8";
const keptId = "image-h3-first-frame-fast-comfyui";

fs.mkdirSync(userWorkflowsDir, { recursive: true });
write(oldId, profile(oldId, "H3 · ComfyUI · Fast", { description: "Older wording." }));
write(keptId, profile(keptId, "H3 · ComfyUI · Fast"));
// Same name, different weights: listed, never merged.
write("image-radiance-krea2-turbo", profile("image-radiance-krea2-turbo", "Krea 2 Turbo"));
write(
  "image-krea2-turbo-radiance",
  profile("image-krea2-turbo-radiance", "Krea 2 Turbo", { model: "krea2.safetensors" }),
);
// Identical, but neither id says which is newer.
write("old-a", profile("old-a", "Twin"));
write("old-b", profile("old-b", "Twin"));
fs.mkdirSync(path.join(temporary, "guides"), { recursive: true });
fs.writeFileSync(
  path.join(temporary, "guides", "prompting.json"),
  JSON.stringify({
    packs: { h3: { summary: "H3." } },
    meta: {},
    families: {},
    profiles: { [`custom:${oldId}`]: { pack: "h3" }, [`custom:${keptId}`]: { pack: "h3" } },
    variants: {},
  }),
);
saveWorkflowPreferences(
  {
    favorites: [`custom:${oldId}`],
    lastUsed: { [`custom:${oldId}`]: "2026-10-01" },
    thumbnails: {},
  },
  { immediate: true },
);
// Owner data the merge must leave byte for byte.
const ownerFiles = {
  "gallery.json": JSON.stringify([{ id: "g1", settings: { profileId: `custom:${oldId}` } }]),
  "accounts/user-1/presets.json": JSON.stringify([{ input: { profileId: `custom:${oldId}` } }]),
};
for (const [name, body] of Object.entries(ownerFiles)) {
  fs.mkdirSync(path.dirname(path.join(temporary, name)), { recursive: true });
  fs.writeFileSync(path.join(temporary, name), body);
}

test("the preview merges identical same-named profiles into the newer id and lists the rest", () => {
  const preview = duplicateProfiles();
  assert.deepEqual(
    preview.merges.map(({ from, to }) => [from, to]),
    [[oldId, keptId]],
  );
  assert.deepEqual(preview.differing, [
    {
      name: "Krea 2 Turbo",
      kind: "image",
      ids: ["image-krea2-turbo-radiance", "image-radiance-krea2-turbo"],
      differences: ["graph"],
    },
  ]);
  assert.deepEqual(
    preview.unresolved.map((item) => item.ids),
    [["old-a", "old-b"]],
  );
  // A different guide binding is a different definition.
  const store = guideStore().read();
  store.profiles[`custom:${oldId}`] = { pack: "h3", variant: "other" };
  fs.writeFileSync(guideStore().file, JSON.stringify(store));
  assert.deepEqual(duplicateProfiles().merges, []);
  store.profiles[`custom:${oldId}`] = { pack: "h3" };
  fs.writeFileSync(guideStore().file, JSON.stringify(store));
});

test("merging needs the preview's hash, backs up, aliases, and is safe to repeat", () => {
  const preview = duplicateProfiles();
  assert.throws(() => mergeDuplicateProfiles({ hash: "stale" }), { status: 409 });
  assert.ok(fs.existsSync(path.join(userWorkflowsDir, `${oldId}.json`)));

  const result = mergeDuplicateProfiles({ hash: preview.hash, by: "admin-1" });
  assert.deepEqual(
    result.merged.map(({ from, to }) => [from, to]),
    [[oldId, keptId]],
  );
  assert.ok(!fs.existsSync(path.join(userWorkflowsDir, `${oldId}.json`)));
  const backup = path.join(temporary, result.backup);
  assert.match(fs.readFileSync(path.join(backup, `${oldId}.json`), "utf8"), /Older wording/);
  const manifest = JSON.parse(fs.readFileSync(path.join(backup, "merge.json"), "utf8"));
  assert.deepEqual(manifest.merges, [{ from: oldId, to: keptId }]);
  assert.deepEqual(manifest.preferencesBefore.favorites, [`custom:${oldId}`]);
  assert.equal(profileStore().aliases()[oldId].to, keptId);
  assert.ok(profileStore().versions(oldId).length >= 1);
  assert.deepEqual(loadWorkflowPreferences().favorites, [`custom:${keptId}`]);
  assert.deepEqual(Object.keys(loadWorkflowPreferences().lastUsed), [`custom:${keptId}`]);
  for (const [name, body] of Object.entries(ownerFiles))
    assert.equal(fs.readFileSync(path.join(temporary, name), "utf8"), body);

  assert.deepEqual(duplicateProfiles().merges, []);
  assert.deepEqual(mergeDuplicateProfiles({ hash: preview.hash }), { merged: [], backup: "" });
  assert.ok(fs.existsSync(path.join(userWorkflowsDir, "image-radiance-krea2-turbo.json")));
  assert.ok(fs.existsSync(path.join(userWorkflowsDir, "old-a.json")));
});

test("every reader resolves a merged id to the kept profile", () => {
  const old = `custom:${oldId}`;
  const kept = `custom:${keptId}`;
  assert.equal(canonicalProfileId(old), kept);
  assert.equal(canonicalProfileId(oldId), keptId);
  assert.equal(canonicalProfileId("custom:old-a"), "custom:old-a");
  assert.equal(getCustomWorkflow(old)?.id, keptId);

  const profiles = [{ id: kept, label: "H3 · ComfyUI · Fast", family: "flux" }];
  assert.equal(findProfile(profiles, old)?.id, kept);

  const now = Date.parse("2026-10-27T00:00:00Z");
  const item = (profileId) => ({
    status: "done",
    createdAt: "2026-10-26T00:00:00Z",
    settings: { profileId },
  });
  assert.equal(profileStats([item(old), item(kept)], now)[kept]?.runs, 2);
  assert.ok(matchesGalleryFilters({ ...item(old), model: old }, { workflow: kept }));
  assert.ok(matchesGalleryFilters({ ...item(old), model: old }, { model: [kept] }));

  const access = effectiveAccountAccess(
    { id: "user-1", role: "user", accessProfileId: "group" },
    { group: { generationProfiles: [old], features: {} } },
    [kept],
  );
  assert.ok(mayUseGenerationProfile(access, { id: kept }));
});

test("an export carries the merged ids as aliases", () => {
  const { files } = buildExport({
    workflowsDir: userWorkflowsDir,
    profiles: profileStore(),
    guides: guideStore(),
  });
  const aliases = files.find((file) => file.name === "profile-aliases.json");
  assert.equal(JSON.parse(aliases.body)[oldId].to, keptId);
});
