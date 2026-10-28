import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Each test file runs in its own process, so these folders stay here.
const outputDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "studio-output-")));
const dataDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "studio-data-")));
process.env.STUDIO_COMFY_OUTPUT_DIR = outputDir;
process.env.STUDIO_DATA_DIR = dataDir;
const store = await import("./gallery-store.js");
test.after(() => {
  for (const folder of [outputDir, dataDir]) fs.rmSync(folder, { recursive: true, force: true });
});

test("search looks through prompts, models and LoRAs; favourites filter by star", () => {
  const done = (id, extra) => ({
    id,
    url: id,
    status: "done",
    type: "image",
    createdAt: new Date().toISOString(),
    ...extra,
  });
  store.setGallery(
    [
      done("s1", { prompt: "a red fox in snow", model: "flux1-dev.safetensors" }),
      done("s2", {
        prompt: "a blue owl",
        model: "sdxl_base.safetensors",
        settings: { loras: [{ name: "Film Grain.safetensors" }] },
      }),
      {
        id: "s3",
        url: "",
        status: "pending",
        type: "image",
        prompt: "running now",
        createdAt: new Date().toISOString(),
      },
    ],
    { persist: false },
  );
  const ids = (filter) =>
    store
      .pageGallery({ filter })
      .items.map((item) => item.id)
      .sort();
  assert.deepEqual(
    ids(store.galleryFilter({ q: "FOX snow" })),
    ["s1", "s3"],
    "every word, any case; a running job stays",
  );
  assert.deepEqual(ids(store.galleryFilter({ q: "sdxl" })), ["s2", "s3"]);
  assert.deepEqual(ids(store.galleryFilter({ q: "grain" })), ["s2", "s3"]);
  assert.equal(store.galleryFilter({ q: "  " }), null);
  assert.deepEqual(ids(store.galleryFilter({ model: "sdxl", lora: "grain" })), ["s2", "s3"]);
  assert.deepEqual(ids(store.galleryFilter({ q: "owl", model: "flux" })), ["s3"]);
  const page = store.pageGallery({ filter: store.galleryFilter({ model: "sdxl" }), limit: 1 });
  const next = store.pageGallery({
    filter: store.galleryFilter({ model: "sdxl" }),
    limit: 1,
    cursor: page.nextCursor,
  });
  assert.deepEqual([...page.items, ...next.items].map((item) => item.id).sort(), ["s2", "s3"]);

  store.setGalleryFavorites(["s2"], true);
  assert.deepEqual(ids(store.galleryFilter({ favorites: true })), ["s2", "s3"]);
  store.setGalleryFavorites(["s2"], false);
  assert.deepEqual(
    ids(store.galleryFilter({ favorites: true })),
    ["s3"],
    "an unstarred image leaves the favourites",
  );
});
