import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { compareGalleryItems } from "./order.js";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-gallery-order-"));
process.env.STUDIO_DATA_DIR = scratch;
const { galleryItems, pageGallery } = await import("./store.js");
const { setGallery } = await import("../fixtures/gallery.js");
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const item = (id, createdAt, extra = {}) => ({
  id,
  createdAt,
  prompt: "a lantern",
  status: "done",
  type: "image",
  ...extra,
});
const ids = (items) => items.map((item) => item.id);
const sorted = (items) => items.slice().sort(compareGalleryItems);

test("explicit Civitai imports stay newest first even without source prompts", () => {
  const imported = item("civitai:42", "2026-01-03", { prompt: "", civitai: { imageId: "42" } });
  const items = [
    item("generation", "2026-01-02"),
    imported,
    item("scan", "2026-01-04", { prompt: "" }),
  ];
  assert.deepEqual(ids(sorted(items)), ["civitai:42", "generation", "scan"]);
  setGallery(items);
  assert.equal(pageGallery({ limit: 1 }).items[0].id, "civitai:42");
});

test("server pages and client merges put blank imports last, newest first within both buckets", () => {
  const items = [
    item("import-old", "2026-01-01", { prompt: "" }),
    item("generation", "2026-01-02"),
    item("history-import", "2026-01-05", { prompt: " \n ", jobId: "comfy-history" }),
    item("pending", "2026-01-03", { status: "pending", prompt: "" }),
    item("failed", "2026-01-04", { status: "failed", prompt: "" }),
  ];
  const expected = ["failed", "pending", "generation", "history-import", "import-old"];
  assert.deepEqual(ids(sorted(items)), expected);
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
  const items = [
    item("z", "2026-01-01"),
    item("m", "2026-01-01"),
    item("a", "2026-01-01"),
    item("import", "2026-12-01", { prompt: "" }),
  ];
  setGallery(items);
  const cursor = pageGallery({ limit: 2 }).nextCursor;
  setGallery(items.filter((item) => item.id !== "m"));
  assert.deepEqual(ids(pageGallery({ cursor, limit: 2 }).items), ["a", "import"]);
});

test("valid dates precede missing and invalid dates, retaining batch indices and id ties", () => {
  const items = [
    item("invalid", "bad"),
    item("undated", undefined),
    item("epoch", "1970-01-01"),
    item("older", "1960-01-01"),
    item("batch-1", "2026-01-01", { jobId: "batch", index: 1 }),
    item("batch-0", "2026-01-01", { jobId: "batch", index: 0 }),
    item("blank-invalid", "bad", { prompt: "" }),
    item("blank-dated", "1960-01-01", { prompt: "" }),
  ];
  const expected = [
    "batch-0",
    "batch-1",
    "epoch",
    "older",
    "undated",
    "invalid",
    "blank-dated",
    "blank-invalid",
  ];
  assert.deepEqual(ids(sorted(items)), expected);
  setGallery(items);
  assert.deepEqual(ids(galleryItems()), expected, "SQLite orders as the comparator does");
});

test("a ranked page (Find Similar) orders by score, leaves out the unscored and pages by position", () => {
  setGallery([
    item("a", "2026-01-03"),
    item("b", "2026-01-02"),
    item("c", "2026-01-01"),
    item("pending", "2026-01-04", { status: "pending" }),
  ]);
  const scores = { a: 0.2, b: 0.9, c: 0.5 };
  const rank = (entry) => scores[entry.id];
  const first = pageGallery({ rank, limit: 2 });
  assert.deepEqual(ids(first.items), ["b", "c"]);
  assert.equal(first.totalApprox, 3);
  assert.deepEqual(ids(pageGallery({ rank, limit: 2, cursor: first.nextCursor }).items), ["a"]);
});

test("a result set's results page together in set order, where its newest result sorts", () => {
  const set = (index) => ({ resultSet: { id: "set", title: "Variety Test", index } });
  setGallery([
    item("newest", "2026-01-05"),
    item("set-2", "2026-01-04", set(2)),
    item("between", "2026-01-03"),
    item("set-0", "2026-01-02", set(0)),
    item("set-1", "2026-01-01", set(1)),
    item("oldest", "2025-12-31"),
  ]);
  const collected = [];
  let cursor = "";
  do {
    const page = pageGallery({ cursor, limit: 2 });
    collected.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(ids(collected), ["newest", "set-0", "set-1", "set-2", "between", "oldest"]);
});

test("paging inside a set carries on through it when a newer result moves the set", () => {
  const set = (index, createdAt) =>
    item(`set-${index}`, createdAt, { resultSet: { id: "moving", title: "Moving", index } });
  setGallery([
    item("newest", "2026-02-05"),
    set(0, "2026-02-04"),
    set(1, "2026-02-03"),
    set(2, "2026-02-02"),
    item("oldest", "2026-02-01"),
  ]);
  const first = pageGallery({ limit: 2 });
  assert.deepEqual(ids(first.items), ["newest", "set-0"]);
  // A result added to the set since sorts first, so the set now stands at the top.
  setGallery([...galleryItems(), set(3, "2026-02-06")]);
  const rest = [];
  let cursor = first.nextCursor;
  while (cursor) {
    const page = pageGallery({ cursor, limit: 2 });
    rest.push(...page.items);
    cursor = page.nextCursor;
  }
  assert.deepEqual(ids(rest), ["set-1", "set-2", "set-3", "oldest"]);
});

test("each owner pages through only its own items, sets kept together", () => {
  const owned = (ownerId, id, createdAt, set) =>
    item(`${ownerId}-${id}`, createdAt, {
      ownerId,
      ...(set !== undefined && { resultSet: { id: `${ownerId}-set`, index: set } }),
    });
  setGallery(
    ["alice", "bob"].flatMap((ownerId) => [
      owned(ownerId, "a", "2026-03-05"),
      owned(ownerId, "s1", "2026-03-04", 1),
      owned(ownerId, "b", "2026-03-03"),
      owned(ownerId, "s0", "2026-03-02", 0),
      owned(ownerId, "c", "2026-03-01"),
    ]),
  );
  for (const ownerId of ["alice", "bob"]) {
    const seen = [];
    let cursor = "";
    do {
      const page = pageGallery({ cursor, limit: 2, query: { ownerId } });
      assert.equal(page.totalApprox, 5);
      seen.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(
      ids(seen),
      ["a", "s0", "s1", "b", "c"].map((id) => `${ownerId}-${id}`),
    );
  }
});
