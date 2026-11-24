import assert from "node:assert/strict";
import test from "node:test";

import { temporaryFolder } from "./fixtures/temporary.js";

// Each test file runs in its own process, so this folder stays here.
process.env.STUDIO_DATA_DIR = temporaryFolder("studio-dream-gallery-");
const {
  filterVisibleGallery,
  galleryItems,
  hasGalleryMedia,
  pageGallery,
  setGalleryRatings,
  unseenDreamItem,
  updateGalleryJob,
  visibleGallery,
} = await import("./gallery/store.js");
const { setGallery } = await import("./fixtures/gallery.js");
const { makePendingItems } = await import("./gallery/records.js");
const { galleryJobResponse } = await import("./gallery/routes.js");
const { openDatabase, runtimeTransaction } = await import("./persistence/runtime.ts");
const { Store } = await import("./domain/store.ts");
const queue = new Store(openDatabase(":memory:"));

const mark = { prompt: "a fox at dawn", why: "You star foxes.", at: new Date().toISOString() };
const item = (id, dream) => ({
  id,
  url: `/media/${id}.png`,
  jobId: `job-${id}`,
  ownerId: "alice",
  type: "image",
  status: "done",
  prompt: id,
  createdAt: new Date().toISOString(),
  ...(dream ? { dream: { ...mark, state: dream } } : {}),
});

test("Dream results stay out of the gallery, its delta and MCP job reads until kept", () => {
  // The pending tile carries the mark from the start, so not even a placeholder shows.
  const [pending] = makePendingItems("job-pending", {
    kind: "image",
    prompt: "p",
    ownerId: "alice",
    dream: { ...mark, state: "unseen" },
  });
  assert.equal(pending.dream.state, "unseen");
  setGallery([item("mine"), item("unseen", "unseen"), item("gone", "discarded"), pending]);
  const shown = () => pageGallery({}).items.map((entry) => entry.id);
  assert.deepEqual(shown(), ["mine"]);
  assert.deepEqual(
    filterVisibleGallery([item("a", "unseen"), item("b", "kept"), item("c")]).map(
      (entry) => entry.id,
    ),
    ["b", "c"],
  );
  // Captions still read Dream's pool, so a discard teaches what it showed.
  assert.ok(hasGalleryMedia(item("d", "discarded")));
  const alice = { userId: "alice", role: "user", authenticated: true, features: { gallery: true } };
  assert.deepEqual(galleryJobResponse(queue, alice, "job-unseen").payload.items, []);

  // A change to an unkept result keeps it out of the gallery.
  updateGalleryJob("unseen", { rating: "liked" });
  assert.deepEqual(shown(), ["mine"]);
  // Keeping it makes it an ordinary gallery item everywhere.
  updateGalleryJob("unseen", { dream: { ...mark, state: "kept" } });
  assert.deepEqual(shown().sort(), ["mine", "unseen"]);
  assert.equal(galleryJobResponse(queue, alice, "job-unseen").payload.items.length, 1);
  // A dislike hides an item from the gallery, kept for the Disliked view.
  updateGalleryJob("mine", { rating: "disliked" });
  assert.deepEqual(shown(), ["unseen"]);
  assert.deepEqual(
    filterVisibleGallery(galleryItems({ rating: "disliked" }), { disliked: true }).map(
      (entry) => entry.id,
    ),
    ["mine"],
  );
  // Comparisons still read their disliked variants, by job or item.
  for (const query of [{ jobIds: ["job-mine"] }, { ids: ["mine"] }])
    assert.deepEqual(
      visibleGallery(query, { disliked: true }).map((entry) => entry.id),
      ["mine"],
    );
});

test("An explicit Dream source is finished, unseen and owned by the caller", () => {
  setGallery([
    item("unseen", "unseen"),
    item("draft", "draft"),
    item("gone", "discarded"),
    { ...item("running", "unseen"), status: "running" },
  ]);
  assert.equal(unseenDreamItem("alice", "unseen", "job-unseen")?.id, "unseen");
  assert.equal(unseenDreamItem("alice", "unseen")?.id, "unseen");
  assert.equal(unseenDreamItem("alice", "unseen", "job-draft"), undefined);
  assert.equal(unseenDreamItem("bob", "unseen", "job-unseen"), undefined);
  for (const id of ["draft", "gone", "running"]) {
    assert.equal(unseenDreamItem("alice", id), undefined);
  }
  assert.deepEqual(pageGallery({ ownerId: "alice" }).items, []);
});

test("Dream reads its results, an owner's liked items and a chat's items by query", () => {
  const projectItem = item("kept", "kept");
  projectItem.dream.projectId = "coast";
  setGallery([
    item("plain"),
    { ...item("liked"), rating: "liked" },
    projectItem,
    item("unseen", "unseen"),
    item("gone", "discarded"),
    { ...item("asked"), chat: { conversationId: "chat-1" } },
    { ...item("bobs"), ownerId: "bob", rating: "liked" },
    { ...item("bobs-kept", "kept"), ownerId: "bob" },
  ]);
  const ids = (query) =>
    galleryItems({ ownerId: "alice", ...query })
      .map((entry) => entry.id)
      .sort();
  assert.deepEqual(ids({ dreamState: "unseen" }), ["unseen"]);
  assert.deepEqual(ids({ dreamState: ["kept", "discarded"] }), ["gone", "kept"]);
  assert.deepEqual(ids({ dreamProject: "coast", dreamState: "kept", status: "done" }), ["kept"]);
  assert.deepEqual(ids({ liked: true }), ["kept", "liked"]);
  assert.deepEqual(ids({ notDream: true }), ["asked", "liked", "plain"]);
  assert.deepEqual(ids({ conversationIds: ["chat-1"] }), ["asked"]);
  assert.deepEqual(ids({ before: Date.now() + 1000, jobIds: ["job-plain", "job-asked"] }), [
    "asked",
    "plain",
  ]);
  assert.deepEqual(ids({ before: 0 }), []);
  assert.equal(ids({ sample: 2 }).length, 2);
});

test("A gallery rating rolls back with its enclosing judgement", () => {
  const saved = item("rated");
  setGallery([saved]);
  const rating = () => galleryItems({ ids: [saved.id] })[0].rating;
  assert.throws(
    () =>
      runtimeTransaction(process.env.STUDIO_DATA_DIR, () => {
        assert.equal(setGalleryRatings([saved.id], "liked", "alice").length, 1);
        assert.equal(rating(), "liked");
        throw new Error("Judgement could not be saved.");
      }),
    /Judgement could not be saved/,
  );
  assert.equal(rating(), undefined);
});
