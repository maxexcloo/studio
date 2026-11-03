import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-gallery-delete-"));
process.env.STUDIO_DATA_DIR = dir;
process.env.STUDIO_MEDIA_DIR = dir;
process.env.STUDIO_MULTI_USER = "1";
const store = await import("./store.js");
const { registerGalleryDeleteRoute } = await import("./routes.js");
const { accountOutputSubfolder } = await import("../account-ownership.js");
const { mediaUrls } = await import("../media-paths.js");

test("an account deletes its own finished item by its URL ID; another owner's answers as missing", async (t) => {
  const app = express();
  app.use((req, _res, next) => {
    const userId = String(req.headers["x-user"]);
    req.studioAccount = { userId, authenticated: true, features: { gallery: true } };
    next();
  });
  registerGalleryDeleteRoute(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  // A finished item's ID is its URL, and an account's subfolder is escaped in it (`%2F`).
  const subfolder = accountOutputSubfolder("alice");
  const filename = "mvzvoi1l-cb839ee3-image_00001_.png";
  fs.mkdirSync(path.join(dir, subfolder), { recursive: true });
  const file = path.join(dir, subfolder, filename);
  fs.writeFileSync(file, "fixture");
  const { url } = mediaUrls(filename, subfolder);
  assert.match(url, /%2F/);
  store.setGallery([{ id: url, url, jobId: "j", status: "done", type: "image", ownerId: "alice" }]);
  const remove = (user) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/gallery/${encodeURIComponent(url)}`, {
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
