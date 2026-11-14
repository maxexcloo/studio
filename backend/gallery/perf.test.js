import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Each test file runs in its own process, so these folders stay here.
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-output-"));
process.env.STUDIO_MEDIA_DIR = outputDir;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-data-"));
process.env.STUDIO_DATA_DIR = dataDir;
const { readGalleryRows } = await import("../persistence/gallery-rows.ts");
const { runtimeDatabase } = await import("../persistence/runtime.ts");
const {
  filterVisibleGallery,
  forgetGalleryItems,
  galleryRevisionValue,
  pageGallery,
  updateGalleryJob,
} = await import("./store.js");
const { setGallery, gallery: galleryRows } = await import("../fixtures/gallery.js");

const output = (name, subfolder = "") => ({
  id: name,
  status: "done",
  type: "image",
  createdAt: new Date().toISOString(),
  url: `/comfy/view?${new URLSearchParams({ filename: name, subfolder, type: "media" })}`,
});

test("an output deleted outside the app drops out of the gallery", async () => {
  fs.mkdirSync(path.join(outputDir, "run"), { recursive: true });
  fs.writeFileSync(path.join(outputDir, "run", "keep.png"), "png");
  fs.writeFileSync(path.join(outputDir, "run", "gone.png"), "png");
  const items = [output("keep.png", "run"), output("gone.png", "run")];
  assert.deepEqual(
    filterVisibleGallery(items).map((item) => item.id),
    ["keep.png", "gone.png"],
  );
  fs.unlinkSync(path.join(outputDir, "run", "gone.png"));
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.deepEqual(
    filterVisibleGallery(items).map((item) => item.id),
    ["keep.png"],
  );
});

// Not Comfy outputs (no /comfy/view URL), so no file checks: this measures the list work alone.
const bigGallery = (count) => {
  const start = Date.parse("2026-01-01T00:00:00Z");
  return Array.from({ length: count }, (_, index) => ({
    id: `local-${index}`,
    jobId: `job-${Math.floor(index / 4)}`,
    index: index % 4,
    status: index % 97 === 0 ? "failed" : "done",
    type: index % 11 === 0 ? "video" : "image",
    prompt: `a quiet harbour at dawn, number ${index}`,
    // Four images per job share a time, like a batch.
    createdAt: new Date(start + Math.floor(index / 4) * 1000).toISOString(),
    settings: { steps: 20, cfg: 4, sampler: "euler", scheduler: "simple", seed: index },
  }));
};

test("paging through 50,000 items serves each once, newest first, with exact counts", () => {
  const items = bigGallery(50_000);
  setGallery(items);
  const seen = [];
  let cursor = "";
  let pages = 0;
  do {
    const page = pageGallery({ limit: 220, cursor });
    assert.equal(page.totalApprox, 50_000);
    seen.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor && pages < 1000);
  assert.equal(new Set(seen).size, seen.length, "no item is served twice");
  assert.equal(seen.length, 50_000);
  assert.deepEqual(
    seen.slice(0, 4),
    ["local-49996", "local-49997", "local-49998", "local-49999"],
    "newest first, a batch in its own order",
  );

  const videos = pageGallery({ type: "video", limit: 500, includeFailed: false });
  assert.ok(videos.items.every((item) => item.type === "video" && item.status !== "failed"));
  assert.equal(
    videos.totalApprox,
    items.filter((item) => item.type === "video" && item.status !== "failed").length,
  );
});

test("paging through a search serves every match once, testing each item once", () => {
  setGallery(bigGallery(5000));
  let tested = 0;
  const filter = (item) => {
    tested += 1;
    return item.type === "video";
  };
  const seen = [];
  let cursor = "";
  let pages = 0;
  do {
    const page = pageGallery({ limit: 100, cursor, filter, filterKey: "videos" });
    seen.push(...page.items.map((item) => item.id));
    assert.equal(page.totalApprox, 455);
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor);
  assert.equal(new Set(seen).size, 455);
  assert.equal(tested, 5000, `each item is tested once across ${pages} pages`);
});

test("a change to the gallery shows on the next page request", () => {
  setGallery(bigGallery(1000));
  assert.equal(pageGallery({ limit: 5 }).totalApprox, 1000);
  updateGalleryJob("job-249", { status: "cancelled" });
  assert.equal(pageGallery({ limit: 5 }).totalApprox, 996, "cancelled items leave the list");
  // A cursor whose item is gone continues after its time instead of starting over.
  const first = pageGallery({ limit: 3 });
  setGallery(galleryRows().filter((item) => item.id !== first.items.at(-1).id));
  const next = pageGallery({ limit: 3, cursor: first.nextCursor });
  assert.equal(
    next.items.some((item) => first.items.some((earlier) => earlier.id === item.id)),
    false,
  );
});

test("a large gallery keeps every row, and a change writes only its own row", () => {
  setGallery(bigGallery(50_001));
  const db = runtimeDatabase(dataDir);
  assert.equal(readGalleryRows(db).length, 50_001, "no record is dropped past 50,000");
  const changes = () => db.prepare("SELECT total_changes() AS count").get().count;
  const before = changes();
  updateGalleryJob(galleryRows()[0].id, { prompt: "changed" });
  assert.equal(changes() - before, 1, "only the changed item's row is written");
});

test("a live preview reaches other browsers while rendering, and is never saved", () => {
  setGallery([
    {
      id: "job-1:0",
      jobId: "job-1",
      status: "pending",
      type: "image",
      createdAt: new Date().toISOString(),
    },
  ]);
  const since = galleryRevisionValue();
  updateGalleryJob("job-1", { preview: "data:image/jpeg;base64,AAAA" }, { persist: false });
  assert.ok(galleryRevisionValue() > since);
  assert.equal(pageGallery({}).items[0].preview, "data:image/jpeg;base64,AAAA");
  const before = galleryRevisionValue();
  updateGalleryJob("job-1", { preview: "data:image/jpeg;base64,AAAA" }, { persist: false });
  assert.equal(galleryRevisionValue(), before, "an unchanged patch does not bump the revision");
  updateGalleryJob("job-1", { progress: { value: 2, max: 4 } });
  assert.equal(pageGallery({}).items[0].preview, "data:image/jpeg;base64,AAAA", "kept over a save");
  assert.equal(readGalleryRows(runtimeDatabase(dataDir))[0].preview, undefined);
  updateGalleryJob("job-1", { status: "done" });
  assert.deepEqual(
    pageGallery({}).items.map((item) => [item.status, item.preview]),
    [["done", undefined]],
  );
});

test("progress shown but not saved goes when the item is saved again or deleted", () => {
  const tile = (id) => ({
    id,
    jobId: id,
    status: "pending",
    type: "image",
    createdAt: new Date().toISOString(),
  });
  setGallery([tile("saved"), tile("deleted")]);
  for (const id of ["saved", "deleted"])
    updateGalleryJob(id, { progress: { value: 1, max: 4 } }, { persist: false });
  const progress = () =>
    Object.fromEntries(galleryRows().map((item) => [item.id, item.progress?.value]));
  assert.deepEqual(progress(), { saved: 1, deleted: 1 });
  updateGalleryJob("saved", { status: "done", progress: null });
  forgetGalleryItems(galleryRows().filter((item) => item.id === "deleted"));
  assert.deepEqual(progress(), { saved: undefined });
  setGallery([tile("deleted")]);
  assert.equal(galleryRows()[0].progress, undefined, "a record put back starts without it");
});

test("a search's list is kept across pages and enrichment, and rebuilt when items move", () => {
  setGallery(bigGallery(2000));
  let tested = 0;
  const filter = (item) => {
    tested += 1;
    return item.type === "video";
  };
  const page = (cursor = "") => pageGallery({ limit: 50, cursor, filter, filterKey: "videos" });
  const first = page();
  page(first.nextCursor);
  assert.equal(tested, 2000, "one walk serves every page");
  updateGalleryJob(first.items[0].id, { caption: { text: "a new caption", tags: [] } });
  page(first.nextCursor);
  assert.equal(tested, 2000, "a caption alone doesn't rebuild the list");
  updateGalleryJob(first.items[0].id, { status: "failed" });
  assert.equal(page().totalApprox, first.totalApprox, "failed items still list");
  assert.equal(tested, 4000, "a status change rebuilds it");
});
