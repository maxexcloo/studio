import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createGalleryTable,
  readGalleryRows,
  writeGalleryRows,
} from "./persistence/gallery-rows.ts";
import { openDatabase } from "./persistence/runtime.ts";
import { Store } from "./domain/store.ts";
import { gallerySources, versionSources } from "./version-sources.js";
import { isVersion, versionPromptOverlap } from "../shared/versions.ts";

const source = { input: { profileId: "sdxl", prompt: "a red fox in the snow at dawn" } };

test("a run from a result's settings is a version on any model while it keeps most of the prompt", () => {
  const run = (input) => ({ operation: "image", input: { ...source.input, ...input } });
  assert.equal(versionPromptOverlap, 0.5);
  assert.equal(isVersion(run({ prompt: "a red fox in the snow at dusk" }), source), true);
  assert.equal(isVersion(run({ prompt: "a castle on a hill under stars" }), source), false);
  assert.equal(isVersion(run({ profileId: "flux" }), source), true);
  // Edits and animations work on the result itself, whatever their prompt.
  assert.equal(
    isVersion({ operation: "refine", input: { prompt: "make it night" } }, source),
    true,
  );
});

test("versions regroup by recorded source after a dry run, with a backup, once", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-version-sources-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = new Store(openDatabase(path.join(dataDir, "studio.sqlite")));
  const session = store.createSession("", "Chat", {});
  const enqueue = (input, operation = "image", parent) =>
    store.enqueue("", session.id, input, operation, parent);
  const first = enqueue(source.input);
  store.db
    .prepare("UPDATE studio_queue SET record = json_set(record, '$.items', json(?)) WHERE id = ?")
    .run(JSON.stringify([{ id: "fox" }]), first.id);
  // A Chat edit of the fox, a later Chat turn that only followed it, and one that changed it all.
  const edit = enqueue(
    { ...source.input, prompt: "make it night", referenceAssets: [{ assetId: "fox" }] },
    "refine",
    first.id,
  );
  enqueue({ ...source.input, prompt: "a lighthouse" }, "image", first.id);
  enqueue({ prompt: "a castle", referenceAssets: [{ assetId: "fox" }] }, "image", first.id);
  store.db.close();

  const plan = versionSources(dataDir);
  assert.equal(plan.applied, false);
  assert.equal(plan.recorded.length, 2);
  assert.deepEqual(plan.recorded[0], { id: edit.id, parentItemId: "fox" });
  assert.equal(plan.ungrouped, 1);
  assert.equal(plan.derived, 1);

  const result = versionSources(dataDir, { apply: true });
  const backup = JSON.parse(fs.readFileSync(path.join(result.backup, "studio_queue.json"), "utf8"));
  assert.equal(backup.length, 2);
  const after = new Store(openDatabase(path.join(dataDir, "studio.sqlite")));
  assert.equal(after.job("", edit.id).parentItemId, "fox");
  after.db.close();
  assert.deepEqual(versionSources(dataDir).recorded, []);
});

test("gallery results take their run's source after a dry run, with a backup, once", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-gallery-sources-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = new Store(openDatabase(path.join(dataDir, "studio.sqlite")));
  const chat = store.createSession("alice", "Chat", {});
  const bobChat = store.createSession("bob", "Chat", {});
  const fromFox = { parentItemId: "/media/fox.png" };
  const run = (ownerId, input, operation, origin) =>
    store.enqueue(
      ownerId,
      ownerId === "alice" ? chat.id : bobChat.id,
      input,
      operation,
      undefined,
      undefined,
      undefined,
      origin,
    );
  const fox = `gallery:${Buffer.from("/media/fox.png").toString("base64url")}`;
  const first = run("alice", source.input, "image");
  // A Prompt run from the fox outside its Chat that kept it and one that changed it all, an edit
  // from before runs recorded their source, which names the fox only as its reference, and Bob's
  // edit naming Alice's fox, which is never his source.
  const prompt = run("alice", source.input, "image", fromFox);
  const castle = run("alice", { profileId: "sdxl", prompt: "a castle" }, "image", fromFox);
  const edit = run("alice", { prompt: "night", referenceAssets: [{ assetId: fox }] }, "refine");
  const foreign = run("bob", { prompt: "mine", referenceAssets: [{ assetId: fox }] }, "refine");
  // A run on another model that an earlier rule marked derived.
  const flux = run("alice", { ...source.input, profileId: "flux" }, "image", fromFox);
  const item = (url, job) => ({
    id: url,
    url,
    jobId: job.id,
    ownerId: job.ownerId,
    prompt: job.input.prompt,
    settings: { profileId: job.input.profileId },
  });
  store.db.exec(createGalleryTable);
  writeGalleryRows(store.db, [
    item("/media/fox.png", first),
    item("/media/prompt.png", prompt),
    item("/media/castle.png", castle),
    item("/media/edit.png", edit),
    item("/media/foreign.png", foreign),
    { ...item("/media/flux.png", flux), ...fromFox, derived: true },
  ]);
  store.db.close();

  const plan = gallerySources(dataDir);
  assert.equal(plan.applied, false);
  assert.deepEqual(
    plan.filled.map(({ key, ...fields }) => [key, fields]),
    [
      ["/media/prompt.png", fromFox],
      ["/media/castle.png", { ...fromFox, derived: true }],
      ["/media/edit.png", fromFox],
    ],
  );
  assert.equal(plan.referenced, 1);
  assert.deepEqual(plan.versions, ["/media/flux.png"]);

  const result = gallerySources(dataDir, { apply: true });
  const backup = JSON.parse(
    fs.readFileSync(path.join(result.backup, "studio_gallery.json"), "utf8"),
  );
  assert.equal(backup.length, 4);
  const db = openDatabase(path.join(dataDir, "studio.sqlite"));
  const rows = new Map(readGalleryRows(db).map((row) => [row.id, row]));
  db.close();
  assert.equal(rows.get("/media/edit.png").parentItemId, "/media/fox.png");
  assert.equal(rows.get("/media/castle.png").derived, true);
  assert.equal(rows.get("/media/foreign.png").parentItemId, undefined);
  assert.equal(rows.get("/media/flux.png").derived, undefined);
  assert.equal(rows.get("/media/flux.png").parentItemId, "/media/fox.png");
  const again = gallerySources(dataDir);
  assert.deepEqual([again.filled, again.versions], [[], []]);
});
