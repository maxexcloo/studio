import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-markers-"));
const dataDir = path.join(temporary, "data");
fs.mkdirSync(path.join(dataDir, ".thumbnails"), { recursive: true });
process.env.STUDIO_DATA_DIR = dataDir;
process.env.STUDIO_WORKERS = JSON.stringify([
  {
    id: "primary",
    url: "http://127.0.0.1:9",
    capabilities: ["image", "video", "upscale", "models"],
  },
]);

const view = (filename) =>
  `/comfy/view?${new URLSearchParams({ filename, subfolder: "studio", type: "output" })}`;
const { readRuntimeDocument, writeRuntimeDocument } = await import("../persistence/runtime.ts");
const saved = () => JSON.stringify(readRuntimeDocument(dataDir, "gallery-hidden"));
// A marker list as older versions wrote it: output names in the clear.
writeRuntimeDocument(dataDir, "gallery-hidden", { [view("image_00007_.png")]: Date.now() });

const store = await import("./store.js");
const thumbnails = await import("../thumbnails.js");

test("the list of deleted outputs no longer says what they were", () => {
  assert.ok(!saved().includes("image_00007_"), "the old readable list was turned into digests");
  const old = { url: view("image_00007_.png"), createdAt: new Date(0).toISOString() };
  assert.equal(store.isGalleryHidden(old), true, "and it still works");

  store.hideGalleryItems([{ url: view("image_00008_.png") }]);
  const after = saved();
  assert.ok(!after.includes("image_00008_"));
  assert.equal(
    store.isGalleryHidden({ url: view("image_00008_.png"), createdAt: new Date(0).toISOString() }),
    true,
  );
  assert.equal(store.isGalleryHidden({ url: view("image_00009_.png") }), false);
  // Putting it back (or ComfyUI reusing the name) clears it again.
  store.addGalleryItems([
    {
      id: view("image_00008_.png"),
      url: view("image_00008_.png"),
      status: "done",
      createdAt: new Date(0).toISOString(),
    },
  ]);
  assert.equal(
    store.isGalleryHidden({ url: view("image_00008_.png"), createdAt: new Date(0).toISOString() }),
    false,
  );
});

test("forgetting an image deletes its cached thumbnails, and its upscale's", async () => {
  const cacheName = (filename) =>
    crypto.createHash("sha1").update(`output:studio:${filename}:768:72`).digest("hex");
  const dir = path.join(dataDir, ".thumbnails");
  for (const name of ["image_00010_.png", "upscale_00010_.png", "image_00011_.png"])
    fs.writeFileSync(path.join(dir, `${cacheName(name)}-${"a".repeat(64)}.webp`), "thumb");
  const removed = await thumbnails.forgetItemThumbnails({
    url: view("image_00010_.png"),
    upscale: { url: view("upscale_00010_.png") },
  });
  assert.equal(removed, 2);
  const left = fs.readdirSync(dir);
  assert.ok(
    left.some((name) => name.startsWith(cacheName("image_00011_.png"))),
    "other images keep theirs",
  );
  assert.ok(!left.some((name) => name.startsWith(cacheName("image_00010_.png"))));
});
