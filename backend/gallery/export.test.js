import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import express from "express";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-account-export-"));
const output = path.join(temporary, "output");
process.env.STUDIO_DATA_DIR = path.join(temporary, "data");
process.env.STUDIO_MEDIA_DIR = output;
process.env.STUDIO_MULTI_USER = "1";
const { setGallery } = await import("../fixtures/gallery.js");
const { accountOutputSubfolder } = await import("../account-ownership.js");
const { exportFilename, sendGalleryExport } = await import("./export.js");
const { registerGalleryHistoryRoutes } = await import("./routes.js");
const ownerA = { studioAccount: { userId: "account-a" } };
const ownerB = { studioAccount: { userId: "account-b" } };
for (const [owner, name] of [
  ["account-a", "account-a.png"],
  ["account-b", "account-b.png"],
]) {
  const folder = accountOutputSubfolder(owner);
  fs.mkdirSync(path.join(output, folder), { recursive: true });
  fs.writeFileSync(path.join(output, folder, name), owner);
}
setGallery(
  [
    {
      id: "a",
      ownerId: "account-a",
      status: "done",
      type: "image",
      filename: "account-a.png",
      outputName: "account-a.png",
      url: `/comfy/view?filename=account-a.png&subfolder=${accountOutputSubfolder("account-a")}&type=media`,
    },
    {
      id: "b",
      ownerId: "account-b",
      status: "done",
      type: "image",
      filename: "account-b.png",
      outputName: "account-b.png",
      url: `/comfy/view?filename=account-b.png&subfolder=${accountOutputSubfolder("account-b")}&type=media`,
    },
  ],
  { persist: false },
);

async function archive(req, ids = null) {
  const response = new (class extends EventEmitter {
    chunks = [];
    write(chunk) {
      this.chunks.push(Buffer.from(chunk));
      return true;
    }
    end(chunk) {
      if (chunk) this.chunks.push(Buffer.from(chunk));
      this.emit("finish");
    }
    destroy() {
      this.emit("close");
    }
  })();
  await sendGalleryExport(response, { req, ids });
  return Buffer.concat(response.chunks).toString("latin1");
}

test("gallery exports include only the signed-in account outputs in account mode", async () => {
  const a = await archive(ownerA);
  assert.match(a, /gallery\/account-a\.png/);
  assert.doesNotMatch(a, /gallery\/account-b\.png/);
  const b = await archive(ownerB);
  assert.match(b, /gallery\/account-b\.png/);
  assert.doesNotMatch(b, /gallery\/account-a\.png/);
  const anonymous = await archive(null);
  assert.doesNotMatch(anonymous, /account-[ab]\.png/);
});

test("a selection exports only its own items, still within the account", async () => {
  setGallery(
    [
      {
        id: "a",
        ownerId: "account-a",
        status: "done",
        type: "image",
        filename: "account-a.png",
        outputName: "account-a.png",
        url: `/comfy/view?filename=account-a.png&subfolder=${accountOutputSubfolder("account-a")}&type=media`,
      },
      {
        id: "a2",
        ownerId: "account-a",
        status: "done",
        type: "image",
        filename: "account-a.png",
        outputName: "account-a-2.png",
        url: `/comfy/view?filename=account-a.png&subfolder=${accountOutputSubfolder("account-a")}&type=media&copy=2`,
      },
      {
        id: "b",
        ownerId: "account-b",
        status: "done",
        type: "image",
        filename: "account-b.png",
        outputName: "account-b.png",
        url: `/comfy/view?filename=account-b.png&subfolder=${accountOutputSubfolder("account-b")}&type=media`,
      },
    ],
    { persist: false },
  );
  const picked = await archive(ownerA, new Set(["a2", "b"]));
  assert.match(picked, /gallery\/account-a-2\.png/);
  assert.doesNotMatch(picked, /gallery\/account-a\.png/);
  assert.doesNotMatch(picked, /account-b\.png/);
});

test("downloads are named for Studio with the date", () => {
  const date = new Date("2026-10-20T12:00:00Z");
  assert.equal(exportFilename("gallery", "zip", date), "studio-gallery-2026-10-20.zip");
  assert.equal(exportFilename("selection", "zip", date), "studio-selection-2026-10-20.zip");
});

test("a posted selection of any size downloads through a link only its account opens", async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.studioAccount = { userId: String(req.headers["x-user"]) };
    next();
  });
  registerGalleryHistoryRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  // Far more IDs than a URL could carry.
  const ids = ["a2", "b", ...Array.from({ length: 2000 }, (_, index) => `missing-${index}`)];
  const posted = await fetch(`${base}/api/gallery/export`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user": "account-a" },
    body: JSON.stringify({ ids }),
  });
  const { href } = await posted.json();
  const other = await fetch(base + href, { headers: { "x-user": "account-b" } });
  assert.equal(other.status, 404);
  const own = await fetch(base + href, { headers: { "x-user": "account-a" } });
  assert.match(own.headers.get("content-disposition"), /studio-selection-/);
  const archive = Buffer.from(await own.arrayBuffer()).toString("latin1");
  assert.match(archive, /gallery\/account-a-2\.png/);
  assert.doesNotMatch(archive, /account-b\.png/);
});
