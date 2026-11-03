import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-profile-store-"));
process.env.STUDIO_DATA_DIR = temporary;
process.env.STUDIO_WORKERS = JSON.stringify([
  {
    id: "primary",
    url: "http://127.0.0.1:9",
    capabilities: ["image", "video", "upscale", "models"],
  },
]);
const { createGuideStore, createProfileStore, hashOf, livePrompting } = await import("./store.js");
const editor = await import("./editor.js");
const { loadMcpPrompting, mergedPrompting, ownPrompting } = await import("../mcp/prompting.js");
const { userWorkflowsDir } = await import("../custom-workflows.js");
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
const quiet = { info: () => {}, warn: () => {} };

const profile = (name, extra = {}) =>
  JSON.stringify(
    {
      studio: {
        id: "image-test",
        name,
        kind: "image",
        controls: { prompt: { node: "2", input: "text" } },
        ...extra,
      },
      graph: {
        1: { class_type: "UNETLoader", inputs: { unet_name: "model.safetensors" } },
        2: { class_type: "CLIPTextEncode", inputs: { text: "" } },
      },
    },
    null,
    2,
  );
const scratch = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-versions-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test("profiles migrate once: backups and the current file become versions, seed first, studio after", (t) => {
  const dir = scratch(t);
  const workflows = path.join(dir, "workflows");
  fs.mkdirSync(workflows, { recursive: true });
  fs.mkdirSync(path.join(dir, "backups", "profile-edits"), { recursive: true });
  fs.writeFileSync(path.join(workflows, "edited.json"), profile("Third"));
  fs.writeFileSync(path.join(workflows, "plain.json"), profile("Plain"));
  fs.writeFileSync(
    path.join(dir, "backups", "profile-edits", "edited-2026-10-01T10-00-00-000Z.json"),
    profile("First"),
  );
  fs.writeFileSync(
    path.join(dir, "backups", "profile-edits", "edited-2026-10-02T10-00-00-000Z.json"),
    profile("Second"),
  );
  fs.writeFileSync(
    path.join(workflows, ".studio-edits.json"),
    JSON.stringify({
      edited: {
        editedAt: "2026-10-03T10:00:00.000Z",
        by: "admin-1",
        baseHash: hashOf(profile("First")),
      },
    }),
  );
  const before = fs.readFileSync(path.join(workflows, ".studio-edits.json"), "utf8");
  const store = createProfileStore({ dataDir: dir, workflowsDir: workflows, log: quiet });
  assert.deepEqual(store.migrate(), { profiles: 2, versions: 4 });
  assert.deepEqual(
    store.versions("edited").map((item) => [item.version, item.origin, item.by, item.at]),
    [
      [3, "studio", "admin-1", "2026-10-03T10:00:00.000Z"],
      [2, "studio", "studio", "2026-10-02T10:00:00.000Z"],
      [1, "seed", "seed", "2026-10-01T10:00:00.000Z"],
    ],
  );
  assert.match(store.version("edited", 1).text, /"First"/);
  assert.deepEqual(
    [store.meta("edited").version, store.meta("edited").origin, store.meta("edited").seedHash],
    [3, "studio", hashOf(profile("First"))],
  );
  assert.deepEqual(
    store.versions("plain").map((item) => item.origin),
    ["seed"],
  );
  // Idempotent; a seed deploy that changed an unedited profile is a new seed version.
  assert.deepEqual(store.migrate(), { profiles: 2, versions: 0 });
  fs.writeFileSync(path.join(workflows, "plain.json"), profile("Plain v2"));
  assert.deepEqual(store.migrate(), { profiles: 2, versions: 1 });
  assert.deepEqual(
    store.versions("plain").map((item) => [item.version, item.origin]),
    [
      [2, "seed"],
      [1, "seed"],
    ],
  );
  assert.equal(
    fs.readFileSync(path.join(workflows, ".studio-edits.json"), "utf8"),
    before,
    ".studio-edits.json is left for the deploy script",
  );
  assert.equal(
    fs.readdirSync(path.join(dir, "backups", "profile-edits")).length,
    2,
    "backups stay",
  );
  // The same text again is no new version.
  assert.equal(store.record("plain", profile("Plain v2"), { origin: "studio" }).version, 2);
  assert.deepEqual(fs.readdirSync(path.join(dir, "history", "profiles", "plain")).sort(), [
    "1.json",
    "2.json",
  ]);
});

test("saving through the editor records versions, marks AI drafts until an edit or Approve, and reverts as a new version", () => {
  fs.mkdirSync(userWorkflowsDir, { recursive: true });
  fs.writeFileSync(path.join(userWorkflowsDir, "image-test.json"), profile("Seed Name"));
  const store = createProfileStore({ log: quiet });
  const { hash } = editor.readEditableProfile("image-test");
  const drafted = editor.saveEditableProfile("image-test", profile("AI Name"), {
    baseHash: hash,
    by: "assistant",
    origin: "ai",
    aiDrafted: true,
  });
  assert.deepEqual(
    [drafted.version.version, drafted.version.origin, drafted.version.aiDrafted],
    [2, "ai", true],
  );
  assert.deepEqual(
    store.versions("image-test").map((item) => [item.version, item.origin]),
    [
      [2, "ai"],
      [1, "seed"],
    ],
  );
  assert.equal(store.approve("image-test", { by: "admin-1" }).aiDrafted, false);
  editor.saveEditableProfile("image-test", profile("AI Name", { uncensored: true }), {
    baseHash: drafted.hash,
    by: "assistant",
    origin: "ai",
    aiDrafted: true,
  });
  const edited = editor.saveEditableProfile("image-test", profile("Admin Name"), { by: "admin-1" });
  assert.deepEqual(
    [edited.version.version, edited.version.aiDrafted, edited.version.by],
    [4, false, "admin-1"],
    "an administrator’s edit clears AI-Drafted",
  );
  const reverted = editor.revertEditableProfile("image-test", 1, {
    by: "admin-1",
    baseHash: edited.hash,
  });
  assert.match(reverted.text, /Seed Name/);
  assert.deepEqual(
    store.versions("image-test").map((item) => item.version),
    [5, 4, 3, 2, 1],
    "history only grows",
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(userWorkflowsDir, ".studio-edits.json"), "utf8"))[
      "image-test"
    ].by,
    "admin-1",
    "still written",
  );
  assert.throws(() => editor.revertEditableProfile("image-test", 9), /version was not found/);
});

const startingGuides = () => ({
  reviewed_on: "2026-10-01",
  families: { krea2: { image: "krea2" } },
  packs: {
    krea2: { name: "Krea 2", summary: "Krea summary.", rules: ["R"] },
    other: { name: "Other", summary: "Other summary." },
  },
  profiles: { "custom:fixture": { pack: "other" } },
  variants: {},
  negatives: { "custom:fixture": { effect: "none", notes: "No negative." } },
});

/** The guide store of a data folder whose guides/prompting.json holds `guides`. */
function guidesIn(dir, guides = startingGuides()) {
  fs.mkdirSync(path.join(dir, "guides"), { recursive: true });
  fs.writeFileSync(path.join(dir, "guides", "prompting.json"), JSON.stringify(guides));
  return createGuideStore({ dataDir: dir });
}

test("guide packs save as versions: a stale edit is refused, an AI draft waits for approval and revert adds a version", (t) => {
  const store = guidesIn(scratch(t));
  const { hash } = store.pack("other");
  assert.throws(
    () => store.save("other", { summary: "x" }, { baseHash: "stale" }),
    /changed since you opened it/,
  );
  store.save(
    "other",
    { name: "Other", summary: "Studio summary." },
    { by: "admin-1", baseHash: hash },
  );
  assert.deepEqual(
    [store.pack("other").meta.version, store.pack("other").meta.origin, store.pack("krea2").meta],
    [1, "studio", null],
  );
  store.save(
    "other",
    { summary: "AI summary." },
    { by: "assistant", origin: "ai", aiDrafted: true },
  );
  assert.equal(store.pack("other").meta.aiDrafted, true);
  assert.equal(store.approve("other", { by: "admin-1" }).aiDrafted, false);
  store.revert("other", 1, { by: "admin-1" });
  assert.deepEqual(
    [store.pack("other").pack.summary, store.versions("other").map((item) => item.version)],
    ["Studio summary.", [3, 2, 1]],
  );
  assert.throws(() => store.save("broken", "text"), /JSON object/);
});

test("a guide resolves per profile, binds to a drafted profile and records its export", (t) => {
  const dir = scratch(t);
  const store = guidesIn(dir);
  assert.deepEqual(store.resolve({ id: "custom:fixture", family: "krea2", kind: "image" }), {
    packId: "other",
    source: "profile",
  });
  assert.deepEqual(store.resolve({ id: "custom:new", family: "krea2", kind: "image" }), {
    packId: "krea2",
    source: "family",
  });
  assert.equal(store.resolve({ id: "custom:new", family: "unknown", kind: "image" }), null);
  store.save(
    "drafted",
    { summary: "Drafted." },
    { by: "assistant", origin: "ai", aiDrafted: true },
  );
  store.bind("custom:new", "drafted");
  assert.deepEqual(store.resolve({ id: "custom:new", family: "krea2", kind: "image" }), {
    packId: "drafted",
    source: "profile",
  });
  assert.throws(() => store.bind("custom:new", "missing"), /not found/);
  store.markExported({ drafted: store.pack("drafted").hash });
  assert.equal(store.pack("drafted").meta.exportedHash, store.pack("drafted").hash);
  // The live loader follows the binding without a restart.
  const prompting = livePrompting({ dataDir: dir, log: quiet });
  assert.equal(prompting({ id: "custom:new", family: "krea2", kind: "image" }).summary, "Drafted.");
});

test("guide bindings are edited, removed, reverted and approved as versions, and a stale edit is refused", (t) => {
  const store = guidesIn(scratch(t));
  const first = store.bindings();
  assert.deepEqual(first.bindings.profiles, { "custom:fixture": { pack: "other" } });
  const edited = store.saveBindings(
    {
      ...first.bindings,
      profiles: { "custom:other": { pack: "krea2" } },
      negatives: {},
    },
    { by: "chat-admin", origin: "chat", aiDrafted: true, baseHash: first.hash },
  );
  assert.deepEqual(edited.bindings.profiles, { "custom:other": { pack: "krea2" } });
  assert.equal(edited.meta.aiDrafted, true);
  // The bindings before the first edit are version 1, so revert can go back.
  assert.deepEqual(
    store.versions("_bindings").map(({ version, origin }) => [version, origin]),
    [
      [2, "chat"],
      [1, "seed"],
    ],
  );
  assert.throws(() => store.saveBindings(first.bindings, { baseHash: first.hash }), {
    status: 409,
  });
  // A binding to a pack that doesn't exist fails the loader's check and is not saved.
  assert.throws(() =>
    store.saveBindings({ ...edited.bindings, profiles: { "custom:x": { pack: "missing" } } }),
  );
  assert.equal(store.approve("_bindings", { by: "admin" }).aiDrafted, false);
  const reverted = store.revertBindings(1, { by: "admin", baseHash: edited.hash });
  assert.deepEqual(reverted.bindings, first.bindings);
  assert.equal(reverted.meta.version, 3);

  store.moveProfileBindings({
    from: "custom:fixture",
    to: "custom:kept",
    remove: ["custom:fixture"],
  });
  const moved = store.bindings().bindings;
  assert.deepEqual(moved.profiles, { "custom:kept": { pack: "other" } });
  assert.deepEqual(Object.keys(moved.negatives), ["custom:kept"]);
  // Packs list without the bindings' history.
  assert.deepEqual(Object.keys(store.read().packs).sort(), ["krea2", "other"]);
});

test("the guide loader reads the store, reloads on change and fills negatives", (t) => {
  const dir = scratch(t);
  const prompting = livePrompting({ dataDir: dir, log: quiet });
  const fixture = { id: "custom:fixture", family: "krea2", kind: "image" };
  assert.equal(prompting(fixture), null, "no guides before the store exists");
  const store = guidesIn(dir);
  assert.equal(prompting(fixture).summary, "Other summary.");
  assert.deepEqual(prompting(fixture).negative, { effect: "none", notes: "No negative." });
  assert.deepEqual(prompting(fixture), loadMcpPrompting(store.file)(fixture));
  store.save("other", { summary: "Edited in Studio." }, { by: "admin-1" });
  assert.equal(
    prompting(fixture).summary,
    "Edited in Studio.",
    "a saved guide applies without a restart",
  );
  assert.equal(prompting({ id: "x", family: "krea2", kind: "image" }).summary, "Krea summary.");
  // A profile's own fields go over its guide's; the rest still follow the guide.
  const own = prompting({ ...fixture, prompting: { negative: { effect: "optional" } } });
  assert.deepEqual([own.summary, own.negative], ["Edited in Studio.", { effect: "optional" }]);
});

test("a profile keeps only the prompting fields that differ from its guide", () => {
  const guide = { id: "krea2", summary: "S", rules: ["R"], mode: { id: "base", rules: ["M"] } };
  const own = { id: "krea2", summary: "S", rules: ["R"], mode: { id: "fast", rules: ["F"] } };
  assert.deepEqual(ownPrompting(guide, own), { mode: { id: "fast", rules: ["F"] } });
  assert.deepEqual(mergedPrompting(guide, ownPrompting(guide, own)), own);
  assert.deepEqual(mergedPrompting(guide, {}), guide);
  assert.deepEqual(mergedPrompting(null, own), own);
  assert.equal(mergedPrompting(null, undefined), null);
});
