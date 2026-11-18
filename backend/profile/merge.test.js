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
const { duplicateProfiles, mergeDuplicateProfiles } = await import("./merge.js");
const { readGalleryRows, writeGalleryRows } = await import("../persistence/gallery-rows.ts");
const { runtimeDatabase } = await import("../persistence/runtime.ts");
const { guideStore, profileStore } = await import("./store.js");
const { userWorkflowsDir } = await import("../custom-workflows.js");
const { loadWorkflowPreferences, saveWorkflowPreferences } =
  await import("../workflow-catalogue.js");
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
const keptId = "image-h3-first-frame-fast";

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
    lastUsed: { [`custom:${oldId}`]: "2026-10-01" },
  },
  { immediate: true },
);
// Owner data the merge must leave byte for byte.
const ownerRecord = { id: "g1", settings: { profileId: `custom:${oldId}` } };
writeGalleryRows(runtimeDatabase(temporary), [ownerRecord]);
const ownerFiles = {
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

test("merging needs the preview's hash, backs up and is safe to repeat", () => {
  const preview = duplicateProfiles();
  assert.throws(() => mergeDuplicateProfiles({ hash: "stale" }), { status: 409 });
  assert.ok(fs.existsSync(path.join(userWorkflowsDir, `${oldId}.json`)));

  const result = mergeDuplicateProfiles({ hash: preview.hash, by: "admin-1" });
  assert.deepEqual(
    result.merged.map(({ from, to }) => [from, to]),
    [[oldId, keptId]],
  );
  assert.ok(!fs.existsSync(path.join(userWorkflowsDir, `${oldId}.json`)));
  assert.ok(profileStore().versions(oldId).length >= 1);
  assert.deepEqual(Object.keys(loadWorkflowPreferences().lastUsed), [`custom:${keptId}`]);
  for (const [name, body] of Object.entries(ownerFiles))
    assert.equal(fs.readFileSync(path.join(temporary, name), "utf8"), body);
  assert.deepEqual(readGalleryRows(runtimeDatabase(temporary)), [ownerRecord]);

  assert.deepEqual(duplicateProfiles().merges, []);
  assert.deepEqual(mergeDuplicateProfiles({ hash: preview.hash }), { merged: [] });
  assert.ok(fs.existsSync(path.join(userWorkflowsDir, "image-radiance-krea2-turbo.json")));
  assert.ok(fs.existsSync(path.join(userWorkflowsDir, "old-a.json")));
});
