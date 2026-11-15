import assert from "node:assert/strict";
import test from "node:test";

import type { MediaItem } from "../../types";
import { currentMedia, mediaIdentity, reconcileViewerItems } from "./mediaSource.ts";

const item = (id: string, extra: Partial<MediaItem> = {}): MediaItem => ({
  id,
  url: `/${id}.png`,
  type: "image",
  status: "done",
  ...extra,
});

test("a pending output keeps its identity and viewer position when saved with a new media ID", () => {
  const pending = item("job-0", { jobId: "job", index: 0, status: "pending", url: "" });
  const saved = item("saved", { jobId: "job", index: 0 });
  const older = item("older");
  assert.equal(mediaIdentity(pending), mediaIdentity(saved));
  assert.equal(currentMedia([saved, older], pending), saved);
  assert.deepEqual(reconcileViewerItems([pending, older], [saved, older]), [saved, older]);
});

test("incoming results and reordered result sets do not change an open viewer's neighbours", () => {
  const a = item("a"),
    b = item("b"),
    c = item("c");
  const fresh = item("fresh"),
    older = item("older");
  assert.deepEqual(reconcileViewerItems([a, b, c], [fresh, c, a, b, older]), [a, b, c, older]);
});

test("viewer reconciliation removes excluded results and retains updated metadata", () => {
  const a = item("a"),
    b = item("b");
  const liked = { ...a, rating: "liked" as const };
  assert.deepEqual(reconcileViewerItems([a, b], [liked]), [liked]);
});
