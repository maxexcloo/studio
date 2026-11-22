import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { compareGalleryItems } from "./order.js";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-gallery-order-"));
process.env.STUDIO_DATA_DIR = scratch;
const { galleryChatSets, galleryItems, pageGallery } = await import("./store.js");
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

test("imports stay newest first even without source prompts", () => {
  const imported = item("civitai:42", "2026-01-03", { prompt: "", civitai: { imageId: "42" } });
  const items = [
    item("generation", "2026-01-02"),
    imported,
    item("scan", "2026-01-04", { prompt: "" }),
  ];
  assert.deepEqual(ids(sorted(items)), ["scan", "civitai:42", "generation"]);
  setGallery(items);
  assert.equal(pageGallery({ limit: 1 }).items[0].id, "scan");
});

test("results with and without prompts page in chronological order", () => {
  const items = [
    item("import-old", "2026-01-01", { prompt: "" }),
    item("generation", "2026-01-02"),
    item("history-import", "2026-01-05", { prompt: " \n ", jobId: "comfy-history" }),
    item("pending", "2026-01-03", { status: "pending", prompt: "" }),
    item("failed", "2026-01-04", { status: "failed", prompt: "" }),
  ];
  const expected = ["history-import", "failed", "pending", "generation", "import-old"];
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

test("a removed cursor continues through descending id ties and undated results", () => {
  const items = [
    item("z", "2026-01-01"),
    item("m", "2026-01-01"),
    item("a", "2026-01-01"),
    item("import", undefined, { prompt: "" }),
  ];
  setGallery(items);
  const cursor = pageGallery({ limit: 2 }).nextCursor;
  setGallery(items.filter((item) => item.id !== "m"));
  assert.deepEqual(ids(pageGallery({ cursor, limit: 2 }).items), ["a", "import"]);
});

test("finished arrivals and unrated results keep their chronological order through rating", () => {
  setGallery([
    item("old", "2026-01-01"),
    item("rated", "2026-01-02", { rating: "liked" }),
    item("later", "2026-01-03"),
    item("latest", "2026-01-04"),
    item("pending", "2026-01-05", { status: "pending" }),
    item("disliked", "2026-01-03T03:00:00Z", { rating: "disliked" }),
  ]);
  const arrivals = pageGallery({
    limit: 1,
    query: { status: "done", since: Date.parse("2026-01-02") },
  });
  assert.deepEqual(ids(arrivals.items), ["latest"]);
  const review = { limit: 1, query: { status: "done", unrated: true } };
  const first = pageGallery(review);
  assert.deepEqual(ids(first.items), ["latest"]);
  const allRatings = { limit: 2, includeDisliked: true, query: { status: "done" } };
  const all = pageGallery(allRatings);
  assert.deepEqual(ids(all.items), ["latest", "disliked"]);
  assert.deepEqual(ids(pageGallery({ ...allRatings, cursor: all.nextCursor }).items), [
    "later",
    "rated",
  ]);
  setGallery([
    item("old", "2026-01-01"),
    item("later", "2026-01-03"),
    item("latest", "2026-01-04", { rating: "liked" }),
  ]);
  assert.deepEqual(ids(pageGallery({ ...review, cursor: first.nextCursor }).items), ["later"]);
});

test("age and rating sorts order individual results before slicing", () => {
  const resultSet = { id: "set" };
  setGallery([
    item("old", "2026-01-01", { status: "failed" }),
    item("liked", "2026-01-02", { rating: "liked", resultSet }),
    item("set-peer", "2026-01-03", { status: "failed", resultSet }),
    item("new", "2026-01-04"),
    item("disliked", "2025-12-31", { rating: "disliked" }),
    item("dream", "2026-01-06", { rating: "disliked", dream: { state: "pending" } }),
  ]);
  for (const [sort, expected] of [
    ["oldest", ["old", "liked", "set-peer", "new"]],
    ["liked", ["liked", "new", "set-peer", "old"]],
    ["disliked", ["disliked", "new", "set-peer", "liked", "old"]],
  ]) {
    const collected = [];
    let cursor = "";
    do {
      const page = pageGallery({ sort, limit: 2, cursor });
      assert.equal(page.totalApprox, expected.length);
      collected.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(ids(collected), expected);
    assert.deepEqual(ids(pageGallery({ sort, selection: "all", limit: 2 }).items), expected);
    assert.deepEqual(
      ids(pageGallery({ sort, selection: "failed", limit: 2 }).items),
      expected.filter((id) => id === "old" || id === "set-peer"),
    );
  }
  assert.deepEqual(ids(pageGallery({ sort: "disliked", query: { rating: "liked" } }).items), [
    "liked",
  ]);
});

test("A retry keeps its gallery position but date filters use when it was created", () => {
  const items = [
    item("newer", "2026-01-03"),
    item("retry", "2026-01-04", { galleryAt: "2026-01-02" }),
    item("older", "2026-01-01"),
  ];
  assert.deepEqual(ids(sorted(items)), ["newer", "retry", "older"]);
  setGallery(items);
  const first = pageGallery({ limit: 2 });
  assert.deepEqual(ids(first.items), ["newer", "retry"]);
  assert.deepEqual(ids(pageGallery({ cursor: first.nextCursor }).items), ["older"]);
  assert.deepEqual(ids(pageGallery({ query: { before: Date.parse("2026-01-03") } }).items), [
    "newer",
    "older",
  ]);
  assert.deepEqual(ids(pageGallery({ query: { since: Date.parse("2026-01-04") } }).items), [
    "retry",
  ]);
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
    "blank-dated",
    "undated",
    "invalid",
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

test("members of a result set interleave with other results by time", () => {
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
  assert.deepEqual(ids(collected), ["newest", "set-2", "between", "set-0", "set-1", "oldest"]);
  assert.deepEqual(ids(pageGallery({ query: { setId: "set" } }).items), [
    "set-2",
    "set-0",
    "set-1",
  ]);
});

test("chat sets separate identically titled runs within the owner's conversation and turn", () => {
  const image = (id, date, setId, turnId, extra = {}) =>
    item(id, date, {
      ownerId: "alice",
      chat: { conversationId: "chat", turnId },
      resultSet: { id: setId, title: "Lighting", caption: "Caption", context: { notes: "Notes" } },
      ...extra,
    });
  setGallery([
    image("first-a", "2026-01-01", "first", "turn-1"),
    image("first-b", "2026-01-03", "first", "turn-1"),
    image("second", "2026-01-04", "second", "turn-1", {
      resultSet: { id: "second", title: "Lighting", caption: "Another Caption" },
    }),
    image("third", "2026-01-02", "third", "turn-2"),
    image("failed", "2026-01-06", "failed", "turn-1", { status: "failed" }),
    image("unlisted", "2026-01-06", "unlisted", "turn-1", { rating: "disliked" }),
    image("video", "2026-01-06", "video", "turn-1", { type: "video" }),
    image("private", "2026-01-06", "private", "turn-1", { ownerId: "bob" }),
  ]);
  const conversationId = "chat";
  const sets = galleryChatSets("alice", "image", { conversationId, turnId: "turn-1" });
  assert.deepEqual(
    sets.map((set) => ({ ...set })),
    [
      {
        id: "second",
        title: "Lighting",
        count: 1,
        at: Date.parse("2026-01-04"),
        notes: "Another Caption",
      },
      { id: "first", title: "Lighting", count: 2, at: Date.parse("2026-01-03"), notes: "Notes" },
    ],
  );
  assert.deepEqual(ids(galleryChatSets("alice", "image", { conversationId })), [
    "second",
    "first",
    "third",
  ]);
  assert.deepEqual(ids(galleryChatSets("alice", "video", { conversationId })), ["video"]);
  assert.deepEqual(ids(galleryChatSets("bob", "image", { conversationId })), ["private"]);
});

test("paging carries on when the last shown set member is removed and a new one arrives", () => {
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
  setGallery([...galleryItems().filter((item) => item.id !== "set-0"), set(3, "2026-02-06")]);
  const rest = [];
  let cursor = first.nextCursor;
  while (cursor) {
    const page = pageGallery({ cursor, limit: 2 });
    rest.push(...page.items);
    cursor = page.nextCursor;
  }
  assert.deepEqual(ids(rest), ["set-1", "set-2", "oldest"]);
});

test("each owner pages through only its own items", () => {
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
      ["a", "s1", "b", "s0", "c"].map((id) => `${ownerId}-${id}`),
    );
  }
});

test("an owner's titled item with the same prompt is found by its prompt", async () => {
  const { findGalleryItem } = await import("./store.js");
  setGallery([
    item("untitled", "2026-01-03", { ownerId: "alice" }),
    item("bob's", "2026-01-02", { ownerId: "bob", title: "Bob's Lantern" }),
    item("alice's", "2026-01-01", { ownerId: "alice", title: "Lantern" }),
  ]);
  const titled = (ownerId) => findGalleryItem({ ownerId, prompt: "a lantern", titled: true });
  assert.equal(titled("alice")?.title, "Lantern");
  assert.equal(titled("carol"), undefined);
});
