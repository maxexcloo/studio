import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import express from "express";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-gallery-delete-"));
process.env.STUDIO_DATA_DIR = dir;
process.env.STUDIO_MEDIA_DIR = dir;
process.env.STUDIO_MULTI_USER = "1";
const store = await import("./store.js");
const { registerGalleryDeleteRoute } = await import("./routes.js");
const { accountOutputSubfolder } = await import("../account-ownership.js");
const { mediaUrls } = await import("../media-paths.js");

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const userId = String(req.headers["x-user"]);
  req.studioAccount = { userId, authenticated: true, features: { gallery: true } };
  next();
});
registerGalleryDeleteRoute(app);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}/api/gallery`;
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A finished item with its file: its ID is its URL, with the account's subfolder escaped (`%2F`). */
function finishedItem(ownerId, name) {
  const subfolder = accountOutputSubfolder(ownerId);
  fs.mkdirSync(path.join(dir, subfolder), { recursive: true });
  const file = path.join(dir, subfolder, `${name}_00001_.png`);
  fs.writeFileSync(file, "fixture");
  const { url } = mediaUrls(path.basename(file), subfolder);
  return { file, item: { id: url, url, jobId: name, status: "done", type: "image", ownerId } };
}

test("an account deletes its own finished item by its URL ID; another owner's answers as missing", async () => {
  const { file, item } = finishedItem("alice", "mvzvoi1l-cb839ee3-image");
  assert.match(item.url, /%2F/);
  store.setGallery([item]);
  const remove = (user) =>
    fetch(`${base}/${encodeURIComponent(item.url)}`, {
      method: "DELETE",
      headers: { "x-user": user },
    });

  const other = await remove("bob");
  assert.equal(other.status, 404);
  assert.equal((await other.json()).error, "That item was not found.");
  assert.equal(store.gallery.length, 1);

  const own = await remove("alice");
  assert.equal(own.status, 200);
  assert.equal((await own.json()).removed, 1);
  assert.equal(store.gallery.length, 0);
  assert.equal(fs.existsSync(file), false);
});

test("one request deletes many of the account's own items and leaves another owner's", async () => {
  const own = Array.from({ length: 300 }, (_, index) => finishedItem("alice", `own-${index}`));
  const other = finishedItem("bob", "other");
  store.setGallery([...own, other].map(({ item }) => item));
  const ids = [...own, other].map(({ item }) => item.id);

  const response = await fetch(`${base}/delete`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user": "alice" },
    body: JSON.stringify({ ids }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.removed, ids.slice(0, own.length));
  assert.equal(result.files.deleted, own.length);
  assert.deepEqual(store.gallery, [other.item]);
  assert.equal(
    own.some(({ file }) => fs.existsSync(file)),
    false,
  );
  assert.equal(fs.existsSync(other.file), true);
});
