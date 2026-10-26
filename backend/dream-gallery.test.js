import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Each test file runs in its own process, so this folder stays here.
process.env.STUDIO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "studio-dream-gallery-"));
const {
  filterVisibleGallery,
  galleryDelta,
  galleryRevisionValue,
  makePendingItems,
  pageGallery,
  setGallery,
  updateGalleryJob,
} = await import("./gallery-store.js");
const { galleryJobResponse } = await import("./gallery-routes.js");

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
  const since = galleryRevisionValue();
  const shown = () => pageGallery({}).items.map((entry) => entry.id);
  assert.deepEqual(shown(), ["mine"]);
  assert.deepEqual(
    filterVisibleGallery([item("a", "unseen"), item("b", "kept"), item("c")]).map(
      (entry) => entry.id,
    ),
    ["b", "c"],
  );
  const alice = { userId: "alice", role: "user", authenticated: true, features: { gallery: true } };
  assert.deepEqual(galleryJobResponse(alice, "job-unseen").payload.items, []);

  // A change to an unkept result never reaches a browser.
  updateGalleryJob("unseen", { favorite: true });
  assert.deepEqual(galleryDelta({ since, owner: "alice" }).upserts, []);
  // Keeping it makes it an ordinary gallery item everywhere.
  updateGalleryJob("unseen", { dream: { ...mark, state: "kept" } });
  assert.deepEqual(
    galleryDelta({ since, owner: "alice" }).upserts.map((entry) => entry.id),
    ["unseen"],
  );
  assert.deepEqual(shown().sort(), ["mine", "unseen"]);
  assert.equal(galleryJobResponse(alice, "job-unseen").payload.items.length, 1);
});
