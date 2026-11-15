import assert from "node:assert/strict";
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
const { readRuntimeDocument } = await import("../persistence/runtime.ts");
const saved = () => JSON.stringify(readRuntimeDocument(dataDir, "gallery-hidden"));

const store = await import("./store.js");

test("the list of deleted outputs no longer says what they were", () => {
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
