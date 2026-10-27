import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-profile-routes-"));
process.env.STUDIO_DATA_DIR = dir;
process.env.STUDIO_WORKERS = JSON.stringify([
  {
    id: "primary",
    url: "http://127.0.0.1:9",
    capabilities: ["image", "video", "upscale", "models"],
  },
]);
delete process.env.STUDIO_MCP_PROMPTING_PATH;
const { userWorkflowsDir } = await import("./custom-workflows.js");
const { profileStore, guideStore, createProfileStore } = await import("./profile-store.js");
const editor = await import("./profile-editor.js");
const { registerProfileRoutes } = await import("./profile-routes.js");
const { buildExport } = await import("./profile-export.js");
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const profile = (name, extra = {}) =>
  `${JSON.stringify(
    {
      studio: {
        id: "krea-test",
        name,
        kind: "image",
        family: "krea2",
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
  )}\n`;

/** The stored (uncompressed) entries of a zip, by name. */
function unzip(buffer) {
  const files = {};
  let at = 0;
  while (buffer.readUInt32LE(at) === 0x04034b50) {
    const size = buffer.readUInt32LE(at + 18);
    const nameLength = buffer.readUInt16LE(at + 26);
    const extra = buffer.readUInt16LE(at + 28);
    const name = buffer.subarray(at + 30, at + 30 + nameLength).toString("utf8");
    const start = at + 30 + nameLength + extra;
    files[name] = buffer.subarray(start, start + size).toString("utf8");
    at = start + size;
  }
  return files;
}

async function serve(t) {
  const app = express();
  app.use(express.json());
  const changed = [];
  registerProfileRoutes(app, {
    profiles: () => profileStore(),
    guides: () => guideStore(),
    onSaved: (id) => changed.push(id),
    accountName: () => "admin-1",
    exportOptions: () => ({
      dataDir: dir,
      workflowsDir: userWorkflowsDir,
      catalogue: null,
      manifestFile: "",
      studioVersion: "0.0.0-test",
    }),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, route, body) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      body: response.headers.get("content-type")?.includes("zip")
        ? Buffer.from(await response.arrayBuffer())
        : await response.json(),
      headers: response.headers,
    };
  };
  return { call, changed };
}

test("versions list, show, revert as a new version and approve an AI draft", async (t) => {
  const { call, changed } = await serve(t);
  fs.mkdirSync(userWorkflowsDir, { recursive: true });
  fs.writeFileSync(path.join(userWorkflowsDir, "krea-test.json"), profile("Seed"));
  profileStore().migrate();
  const first = editor.readEditableProfile("krea-test");
  const drafted = editor.saveEditableProfile("krea-test", profile("Drafted"), {
    baseHash: first.hash,
    by: "assistant",
    origin: "ai",
    aiDrafted: true,
  });
  assert.equal(editor.listEditableProfiles()[0].aiDrafted, true);

  const list = await call("GET", "/api/profiles/editable/krea-test/versions");
  assert.deepEqual(
    list.body.versions.map((item) => [item.version, item.origin, item.aiDrafted]),
    [
      [2, "ai", true],
      [1, "seed", false],
    ],
  );
  assert.equal(list.body.versions[0].text, undefined, "the list carries no text");
  assert.equal(list.body.meta.aiDrafted, true);
  const one = await call("GET", "/api/profiles/editable/krea-test/versions/1");
  assert.match(one.body.version.text, /"Seed"/);
  assert.equal((await call("GET", "/api/profiles/editable/krea-test/versions/9")).status, 404);
  assert.equal((await call("GET", "/api/profiles/editable/missing/versions")).status, 404);

  const approved = await call("POST", "/api/profiles/editable/krea-test/approve");
  assert.deepEqual(
    [approved.body.meta.aiDrafted, approved.body.meta.approvedBy],
    [false, "admin-1"],
  );
  assert.equal(editor.listEditableProfiles()[0].aiDrafted, false);

  // A stale base is refused; the current one reverts to version 1 as version 3.
  assert.equal(
    (
      await call("POST", "/api/profiles/editable/krea-test/revert", {
        version: 1,
        baseHash: first.hash,
      })
    ).status,
    409,
  );
  const reverted = await call("POST", "/api/profiles/editable/krea-test/revert", {
    version: 1,
    baseHash: drafted.hash,
  });
  assert.equal(reverted.status, 200);
  assert.match(reverted.body.text, /"Seed"/);
  assert.deepEqual(
    [reverted.body.version.version, reverted.body.version.origin, reverted.body.version.by],
    [3, "studio", "admin-1"],
  );
  assert.deepEqual(
    profileStore()
      .versions("krea-test")
      .map((item) => item.version),
    [3, 2, 1],
    "history only grows",
  );
  assert.equal(
    (await call("POST", "/api/profiles/editable/krea-test/revert", { version: 0 })).status,
    400,
  );
  assert.deepEqual(
    changed,
    ["krea-test", "krea-test"],
    "approve and revert tell Studio who sees what changed",
  );
});

test("a profile’s guide view, guide edits, guide versions, revert and approve", async (t) => {
  const { call } = await serve(t);
  const guides = guideStore();
  guides.save("krea2", { name: "Krea 2", summary: "Seed guide." }, { by: "seed", origin: "seed" });
  const store = guides.read();
  fs.writeFileSync(
    guides.file,
    JSON.stringify({ ...store, families: { krea2: { image: "krea2" } } }),
  );
  const view = await call("GET", "/api/profiles/editable/krea-test/guide");
  assert.deepEqual(
    [view.body.packId, view.body.source, view.body.pack.summary],
    ["krea2", "family", "Seed guide."],
  );
  assert.equal(
    (await call("PUT", "/api/profiles/guides/krea2", { pack: { summary: "x" }, baseHash: "stale" }))
      .status,
    409,
  );
  const saved = await call("PUT", "/api/profiles/guides/krea2", {
    pack: JSON.stringify({ name: "Krea 2", summary: "Edited." }),
    baseHash: view.body.hash,
  });
  assert.deepEqual(
    [saved.body.pack.summary, saved.body.meta.version, saved.body.meta.by],
    ["Edited.", 2, "admin-1"],
  );
  assert.equal((await call("PUT", "/api/profiles/guides/krea2", { pack: "{ nope" })).status, 400);
  guides.save(
    "krea2",
    { name: "Krea 2", summary: "AI." },
    { by: "assistant", origin: "ai", aiDrafted: true },
  );
  const versions = await call("GET", "/api/profiles/guides/krea2/versions");
  assert.deepEqual(
    versions.body.versions.map((item) => [item.version, item.origin]),
    [
      [3, "ai"],
      [2, "studio"],
      [1, "seed"],
    ],
  );
  assert.equal(
    (await call("GET", "/api/profiles/guides/krea2/versions/1")).body.version.pack.summary,
    "Seed guide.",
  );
  assert.equal(
    (await call("POST", "/api/profiles/guides/krea2/approve")).body.meta.aiDrafted,
    false,
  );
  const reverted = await call("POST", "/api/profiles/guides/krea2/revert", {
    version: 2,
    baseHash: versions.body.hash,
  });
  assert.deepEqual([reverted.body.pack.summary, reverted.body.meta.version], ["Edited.", 4]);
  // Guidance in the profile's own JSON wins, and is shown as such.
  const text = profile("Owned", { prompting: { id: "own", summary: "Own guidance." } }).replace(
    '"krea-test"',
    '"owned"',
  );
  fs.writeFileSync(path.join(userWorkflowsDir, "owned.json"), text);
  const owned = await call("GET", "/api/profiles/editable/owned/guide");
  assert.deepEqual([owned.body.source, owned.body.owned.summary], ["owned", "Own guidance."]);
  fs.rmSync(path.join(userWorkflowsDir, "owned.json"));
});

test("the export bundle says what changed and lists unreviewed drafts", async (t) => {
  const { call } = await serve(t);
  // An AI draft that is not yet approved.
  editor.createEditableProfile(
    "drafted-one",
    profile("Drafted One").replace('"krea-test"', '"drafted-one"'),
    { by: "assistant" },
  );
  const response = await call("GET", "/api/profiles/export");
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-disposition"),
    /attachment; filename="studio-profiles-.*\.zip"/,
  );
  const files = unzip(response.body);
  assert.deepEqual(Object.keys(files).sort(), [
    "EXPORT.json",
    "profiles/drafted-one.json",
    "profiles/krea-test.json",
    "prompting.json",
  ]);
  assert.equal(
    files["profiles/krea-test.json"],
    fs.readFileSync(path.join(userWorkflowsDir, "krea-test.json"), "utf8"),
    "profiles go out exactly as on disk",
  );
  const prompting = JSON.parse(files["prompting.json"]);
  assert.equal(prompting.meta, undefined, "the seed format has no meta");
  assert.equal(prompting.packs.krea2.summary, "Edited.");
  const report = JSON.parse(files["EXPORT.json"]);
  assert.deepEqual([report.format, report.layout, report.studioVersion], [2, "ai", "0.0.0-test"]);
  assert.deepEqual(report.unreviewed, { profiles: ["drafted-one"], guides: [] });
  assert.deepEqual(report.changed.profiles.sort(), ["drafted-one", "krea-test"]);
  assert.deepEqual(
    report.profiles.find((item) => item.id === "drafted-one"),
    {
      id: "drafted-one",
      name: "Drafted One",
      version: 1,
      origin: "ai",
      aiDrafted: true,
      by: "assistant",
      changedSinceSeed: true,
      changedSinceExport: true,
    },
  );
  assert.equal(
    fs.readdirSync(path.join(dir, "exports")).filter((name) => name.endsWith(".zip")).length,
    1,
    "kept in the data folder",
  );
  // The next export says nothing changed since.
  const again = JSON.parse(unzip((await call("GET", "/api/profiles/export")).body)["EXPORT.json"]);
  assert.deepEqual(again.changed, { profiles: [], guides: [] });
});

test("the catalogue and manifest join the bundle when there are any", (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-export-"));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  fs.mkdirSync(path.join(scratch, "workflows"));
  const manifest = path.join(scratch, "models.json");
  fs.writeFileSync(manifest, '[{"path":"loras/a.safetensors","sha256":"x"}]\n');
  const catalogue = {
    loraView: () => ({
      catalogue: { "b.safetensors": { title: "B" }, "a.safetensors": { title: "A" } },
    }),
  };
  const built = buildExport({
    workflowsDir: path.join(scratch, "workflows"),
    profiles: createProfileStore({ dataDir: scratch, log: {} }),
    guides: { read: () => null },
    catalogue,
    manifestFile: manifest,
  });
  const names = Object.fromEntries(built.files.map((file) => [file.name, file.body]));
  assert.deepEqual(Object.keys(JSON.parse(names["lora-catalogue.json"])), [
    "a.safetensors",
    "b.safetensors",
  ]);
  assert.equal(names["models.json"], fs.readFileSync(manifest, "utf8"));
  assert.equal(names["prompting.json"], undefined);
});

test("chat edits through the same routes record chat as the origin, and a chat draft stays AI-Drafted", async (t) => {
  const app = express();
  app.use(express.json());
  // MCP's admin tools reach these routes with the administrator's MCP credential (multi-user-auth.js).
  app.use((req, _res, next) => {
    if (req.headers["x-test-chat"])
      req.studioAccount = { userId: "admin-1", role: "administrator", credential: "mcp-admin" };
    next();
  });
  editor.registerProfileEditorRoutes(app, { accountName: () => "admin-1" });
  registerProfileRoutes(app, {
    profiles: () => profileStore(),
    guides: () => guideStore(),
    accountName: () => "admin-1",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, route, body, chat = true) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { "content-type": "application/json", ...(chat ? { "x-test-chat": "1" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };

  const listed = await call("GET", "/api/profiles/guides");
  assert.ok(listed.body.packs.some((pack) => pack.packId === "krea2" && pack.version >= 1));
  const pack = await call("GET", "/api/profiles/guides/krea2");
  assert.equal(pack.body.packId, "krea2");
  assert.equal((await call("GET", "/api/profiles/guides/missing")).status, 404);
  const drafted = await call("PUT", "/api/profiles/guides/krea2", {
    pack: { ...pack.body.pack, summary: "From chat." },
    baseHash: pack.body.hash,
    draft: true,
  });
  assert.deepEqual([drafted.body.meta.origin, drafted.body.meta.aiDrafted], ["chat", true]);
  // The UI's draft flag means nothing: only chat drafts are AI-Drafted.
  const ui = await call(
    "PUT",
    "/api/profiles/guides/krea2",
    {
      pack: { ...pack.body.pack, summary: "From Studio." },
      baseHash: drafted.body.hash,
      draft: true,
    },
    false,
  );
  assert.deepEqual([ui.body.meta.origin, ui.body.meta.aiDrafted], ["studio", false]);
  const reverted = await call("POST", "/api/profiles/guides/krea2/revert", {
    version: drafted.body.meta.version,
    baseHash: ui.body.hash,
  });
  assert.equal(reverted.body.meta.origin, "chat");

  const current = editor.readEditableProfile("krea-test");
  assert.equal(
    (
      await call("PUT", "/api/profiles/editable/krea-test", {
        text: profile("Chat"),
        baseHash: "f".repeat(64),
      })
    ).status,
    409,
    "a stale base is refused",
  );
  const edited = await call("PUT", "/api/profiles/editable/krea-test", {
    text: profile("Chat"),
    baseHash: current.hash,
    draft: true,
  });
  assert.deepEqual([edited.body.version.origin, edited.body.version.aiDrafted], ["chat", true]);
  const back = await call("POST", "/api/profiles/editable/krea-test/revert", {
    version: 1,
    baseHash: edited.body.hash,
  });
  assert.deepEqual([back.body.version.origin, back.body.version.aiDrafted], ["chat", false]);
});
