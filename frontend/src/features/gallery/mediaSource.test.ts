import assert from "node:assert/strict";
import test from "node:test";

import type { MediaItem } from "../../types";
import { currentMedia, mediaIdentity, mediaSource, reconcileViewerItems } from "./mediaSource.ts";

const item = (id: string, extra: Partial<MediaItem> = {}): MediaItem => ({
  id,
  url: `/${id}.png`,
  type: "image",
  status: "done",
  ...extra,
});

test("a saved video without a thumbnail uses its original's poster address", () => {
  const video = item("video", {
    type: "video",
    url: "/comfy/view?filename=clip.mp4&subfolder=owner&worker=video",
  });
  const source = mediaSource(video);
  assert.equal(source.thumbnailUrl, "/comfy/thumb?filename=clip.mp4&subfolder=owner&worker=video");
  assert.equal(source.url, video.url);
});

test("a pending output keeps its identity and viewer position when saved with a new media ID", () => {
  const pending = item("job-0", { jobId: "job", index: 0, status: "pending", url: "" });
  const saved = item("saved", { jobId: "job", index: 0 });
  const older = item("older");
  assert.equal(mediaIdentity(pending), mediaIdentity(saved));
  assert.equal(currentMedia([saved, older], pending), saved);
  assert.deepEqual(reconcileViewerItems([pending, older], [saved, older]), [saved, older]);
});

test("new results extend both ends without reordering the viewer's existing neighbours", () => {
  const a = item("a"),
    b = item("b"),
    c = item("c");
  const fresh = item("fresh"),
    older = item("older");
  assert.deepEqual(reconcileViewerItems([a, b, c], [fresh, c, a, b, older]), [
    fresh,
    a,
    b,
    c,
    older,
  ]);
});

test("a new result that arrives between neighbours can be opened without reopening the viewer", () => {
  const recent = item("recent");
  const newResult = item("new");
  const older = item("older");
  assert.deepEqual(reconcileViewerItems([recent, older], [recent, newResult, older]), [
    recent,
    newResult,
    older,
  ]);
});

test("viewer reconciliation removes excluded results and retains updated metadata", () => {
  const a = item("a"),
    b = item("b");
  const liked = { ...a, rating: "liked" as const };
  assert.deepEqual(reconcileViewerItems([a, b], [liked]), [liked]);
});

test("a disliked current item keeps both neighbours through navigation and Undo", () => {
  const a = item("a"),
    b = item("b"),
    c = item("c");
  const disliked = { ...b, rating: "disliked" as const };
  const held = reconcileViewerItems([a, b, c], [a, c], [disliked]);
  assert.deepEqual(held, [a, disliked, c]);
  assert.equal(held[held.indexOf(disliked) + 1], c);
  assert.equal(held[held.indexOf(c) - 1], disliked);
  assert.deepEqual(reconcileViewerItems(held, [a, b, c]), [a, b, c]);
});
