import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compareGalleryItems, galleryBucket } from "./gallery-order.js";
import { sortGalleryItems } from "../src/app/gallery.ts";
import { groupGallery } from "../src/app/runs.js";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-gallery-order-"));
process.env.HEISS_DATA_DIR = scratch;
process.env.COMFY_OUTPUT_DIR = "";
const { pageGallery, setGallery, sortGallery } = await import("./gallery-store.js");
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const item = (id, createdAt, extra = {}) => ({ id, createdAt, prompt: "a lantern", status: "done", type: "image", ...extra });
const ids = (items) => items.map((item) => item.id);

test("server pages and client merges put blank imports last, newest first within both buckets", () => {
  const items = [
    item("import-old", "2026-01-01", { prompt: "", library: { folder: "photos", path: "old.png" } }),
    item("generation", "2026-01-02"),
    item("history-import", "2026-01-05", { prompt: " \n ", jobId: "comfy-history" }),
    item("pending", "2026-01-03", { status: "pending", prompt: "" }),
    item("failed", "2026-01-04", { status: "error", prompt: "" })
  ];
  const expected = ["failed", "pending", "generation", "history-import", "import-old"];
  assert.deepEqual(ids(sortGallery(items)), expected);
  assert.deepEqual(ids(sortGalleryItems(items)), expected);
  assert.deepEqual(ids(items.slice().sort(compareGalleryItems)), expected);
  setGallery(items);
  const collected = [];
  let cursor = "";
  do {
    const page = pageGallery({ cursor, limit: 2 });
    collected.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(ids(collected), expected);
});

test("a removed cursor continues through the bucket boundary and descending id ties", () => {
  const items = [item("z", "2026-01-01"), item("m", "2026-01-01"), item("a", "2026-01-01"), item("import", "2026-12-01", { prompt: "" })];
  setGallery(items);
  const cursor = pageGallery({ limit: 2 }).nextCursor;
  setGallery(items.filter((item) => item.id !== "m"));
  assert.deepEqual(ids(pageGallery({ cursor, limit: 2 }).items), ["a", "import"]);
  const legacyCursor = `${Date.parse("2026-01-01")}|m`;
  assert.deepEqual(ids(pageGallery({ cursor: legacyCursor, limit: 2 }).items), ["a", "import"]);
  const importCursor = `${Date.parse("2026-12-01")}|import`;
  assert.deepEqual(pageGallery({ cursor: importCursor, limit: 2 }).items, []);
});

test("valid dates precede missing and invalid dates, retaining batch indices and id ties", () => {
  const items = [item("invalid", "bad"), item("undated", undefined), item("epoch", "1970-01-01"), item("older", "1960-01-01"), item("batch-1", "2026-01-01", { jobId: "batch", index: 1 }), item("batch-0", "2026-01-01", { jobId: "batch", index: 0 }), item("blank-invalid", "bad", { prompt: "" }), item("blank-dated", "1960-01-01", { prompt: "" })];
  const expected = ["batch-0", "batch-1", "epoch", "older", "undated", "invalid", "blank-dated", "blank-invalid"];
  assert.deepEqual(ids(sortGallery(items)), expected);
  assert.deepEqual(ids(sortGalleryItems(items)), expected);
});

test("concealed or encrypted prompts keep chronological ordering without inspecting secrets", () => {
  const concealed = [
    { privateVault: true }, { vaultLocked: true }, { promptProtected: true },
    { promptEncrypted: "opaque envelope" }, { negativeEncrypted: "opaque envelope" }, { prompt: "enc:v1:opaque" }
  ].map((extra, index) => item(`private-${index}`, "2026-01-02", { prompt: "", ...extra }));
  for (const hidden of concealed) assert.equal(galleryBucket(hidden), 0);
  const sorted = sortGallery([...concealed, item("older-generation", "2026-01-01"), item("new-import", "2026-01-03", { prompt: "" })]);
  assert.equal(sorted.at(-1).id, "new-import");
  assert.equal(sorted.at(-2).id, "older-generation");
  assert.deepEqual(ids(sortGalleryItems(sorted)), ids(sorted));
});

test("moments and runs stay separated when blank imports are newer than generated outputs", () => {
  const generated = [0, 1, 2].map((index) => item(`generated-${index}`, `2026-01-01T00:0${index}:00Z`, { jobId: "same-job" }));
  const imported = [0, 1, 2].map((index) => item(`imported-${index}`, `2026-01-01T00:1${index}:00Z`, { jobId: "same-job", prompt: "" }));
  const ordered = sortGallery([...generated, ...imported]);
  const grouped = groupGallery(ordered);
  assert.equal(grouped.moments.length, 2);
  assert.deepEqual(ids(grouped.moments[0].items), ids(sortGallery(generated)));
  assert.deepEqual(ids(grouped.moments[1].items), ids(sortGallery(imported)));
  assert.equal(grouped.runs.length, 2);
  assert.ok(grouped.runs.every((run) => new Set(run.items.map(galleryBucket)).size === 1));
});
