import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-hidden-removal-"));
// The import itself runs the removal once, on this empty folder.
process.env.STUDIO_DATA_DIR = path.join(temporary, "imported");
const { flagName, removeHidden } = await import("./hidden-migration.js");
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

const quiet = { log() {}, warn() {} };
const view = (filename) =>
  `/comfy/view?${new URLSearchParams({ filename, subfolder: "studio", type: "output" })}`;
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
let count = 0;
function dataDir(files = {}) {
  const dir = path.join(temporary, `data-${(count += 1)}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, value] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(
      path.join(dir, name),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  }
  return dir;
}

test("importing it runs it once for the configured data folder", () => {
  assert.ok(fs.existsSync(path.join(process.env.STUDIO_DATA_DIR, flagName)));
});

test("an install that never used Hidden gets a backup and the flag, and nothing else changes", () => {
  const gallery = [
    {
      id: view("a.png"),
      url: view("a.png"),
      status: "done",
      prompt: "a fox",
      ownerId: "account-a",
    },
  ];
  const markers = { "h:deleted-output": 1 };
  const dir = dataDir({ "gallery.json": gallery, "gallery-hidden.json": markers });
  const before = fs.readFileSync(path.join(dir, "gallery.json"), "utf8");
  const summary = removeHidden({
    dataDir: dir,
    now: new Date("2026-10-20T01:02:03.004Z"),
    log: quiet,
  });
  assert.equal(summary.backup, path.join("backups", "hidden-removal-2026-10-20T01-02-03-004Z"));
  assert.equal(summary.hiddenFound, false);
  assert.equal(summary.vault, null);
  assert.deepEqual(summary.gallery, {
    records: 1,
    unflagged: 0,
    unsuppressed: 0,
    sealedPrompts: 0,
  });
  const backup = path.join(dir, summary.backup);
  if (process.platform !== "win32") assert.equal(fs.statSync(backup).mode & 0o777, 0o700);
  assert.deepEqual(readJson(path.join(backup, "gallery.json")), gallery);
  assert.deepEqual(readJson(path.join(backup, "gallery-hidden.json")), markers);
  assert.deepEqual(readJson(path.join(backup, "summary.json")), summary);
  assert.match(fs.readFileSync(path.join(backup, "README.txt"), "utf8"), /nothing was deleted/);
  assert.equal(fs.readFileSync(path.join(dir, "gallery.json"), "utf8"), before);
  assert.deepEqual(readJson(path.join(dir, "gallery-hidden.json")), markers, "delete markers stay");
  assert.equal(readJson(path.join(dir, flagName)).backup, summary.backup);
});

test("flagged records and sealed prompts become ordinary gallery items, keeping their owner", () => {
  const dir = dataDir({
    "gallery.json": [
      {
        id: "1",
        url: view("1.png"),
        status: "done",
        prompt: "kept",
        ownerId: "account-a",
        privateVault: true,
      },
      {
        id: "2",
        url: view("2.png"),
        status: "done",
        prompt: "a title",
        promptEncrypted: "enc:v1:abc",
        negative: "enc:v1:def",
        hidden: true,
      },
      { id: "3", url: view("3.png"), status: "done", prompt: "plain" },
    ],
    "privacy.json": { version: 2 },
    "hidden-runs.json": { version: 1, runs: [] },
  });
  const summary = removeHidden({ dataDir: dir, log: quiet });
  assert.equal(summary.hiddenFound, true);
  assert.deepEqual(summary.gallery, {
    records: 3,
    unflagged: 2,
    unsuppressed: 0,
    sealedPrompts: 1,
  });
  assert.deepEqual(summary.copied.sort(), ["gallery.json", "hidden-runs.json", "privacy.json"]);
  const gallery = readJson(path.join(dir, "gallery.json"));
  assert.deepEqual(gallery[0], {
    id: "1",
    url: view("1.png"),
    status: "done",
    prompt: "kept",
    ownerId: "account-a",
  });
  assert.deepEqual(gallery[1], {
    id: "2",
    url: view("2.png"),
    status: "done",
    prompt: "a title",
    negative: "",
  });
  assert.deepEqual(gallery[2], { id: "3", url: view("3.png"), status: "done", prompt: "plain" });
  assert.equal(
    readJson(path.join(dir, summary.backup, "gallery.json"))[1].promptEncrypted,
    "enc:v1:abc",
    "the backup keeps the ciphertext",
  );
  assert.ok(fs.existsSync(path.join(dir, "privacy.json")), "nothing is deleted");
});

test("records a marker kept out of view come back; markers for deleted outputs stay", async () => {
  const key = crypto.randomBytes(32);
  const marker = (text) => `h:${crypto.createHmac("sha256", key).update(text).digest("base64url")}`;
  const dir = dataDir({
    ".gallery-marker-key": key.toString("base64url"),
    "gallery.json": [
      {
        id: view("kept.png"),
        url: view("kept.png"),
        status: "done",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    "gallery-hidden.json": {
      [marker(view("kept.png"))]: Date.now(),
      [marker(view("deleted.png"))]: Date.now(),
      [view("old-plain.png")]: 1,
    },
  });
  const summary = removeHidden({ dataDir: dir, log: quiet });
  assert.equal(summary.gallery.unsuppressed, 1);
  assert.equal(summary.hiddenFound, true);
  const markers = readJson(path.join(dir, "gallery-hidden.json"));
  assert.deepEqual(
    Object.keys(markers).sort(),
    [marker(view("deleted.png")), view("old-plain.png")].sort(),
  );
  assert.equal(
    Object.keys(readJson(path.join(dir, summary.backup, "gallery-hidden.json"))).length,
    3,
  );

  // The digest is the gallery store's own, so the store now shows the record.
  process.env.STUDIO_DATA_DIR = dir;
  const store = await import("./gallery-store.js");
  assert.equal(store.markerOf(view("kept.png")), marker(view("kept.png")));
  assert.equal(store.isGalleryHidden(store.gallery[0]), false);
  assert.equal(
    store.isGalleryHidden({ url: view("deleted.png"), createdAt: "2026-01-01T00:00:00.000Z" }),
    true,
  );
});

test("the encrypted vault moves into the backup, counted and flagged as needing the password", () => {
  const dir = dataDir({
    ".private-vault/vault.json": { version: 1 },
    ".private-vault/manifest.enc": "sealed",
    ".private-vault/assets/a.bin": "sealed",
    ".private-vault/assets/b.bin": "sealed",
  });
  const warnings = [];
  const summary = removeHidden({
    dataDir: dir,
    log: { log() {}, warn: (line) => warnings.push(line) },
  });
  assert.deepEqual(summary.vault, { moved: true, encryptedFiles: 4, needsPassword: true });
  assert.equal(fs.existsSync(path.join(dir, ".private-vault")), false);
  assert.equal(
    fs.readFileSync(path.join(dir, summary.backup, ".private-vault", "assets", "a.bin"), "utf8"),
    "sealed",
  );
  assert.match(
    fs.readFileSync(path.join(dir, summary.backup, "README.txt"), "utf8"),
    /4 encrypted file/,
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /needs the owner's Hidden password/);
});

test("it runs once: a second start changes nothing and takes no second backup", () => {
  const dir = dataDir({
    "gallery.json": [{ id: "1", url: view("1.png"), status: "done", privateVault: true }],
  });
  assert.ok(removeHidden({ dataDir: dir, log: quiet }));
  fs.writeFileSync(
    path.join(dir, "gallery.json"),
    JSON.stringify([{ id: "1", url: view("1.png"), status: "done", privateVault: true }]),
  );
  assert.equal(removeHidden({ dataDir: dir, log: quiet }), null);
  assert.equal(readJson(path.join(dir, "gallery.json"))[0].privateVault, true, "left as found");
  assert.equal(fs.readdirSync(path.join(dir, "backups")).length, 1);
});
