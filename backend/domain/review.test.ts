import assert from "node:assert/strict";
import test from "node:test";

import type { Project, Review } from "../../shared/projects.ts";
import { type ReviewItem, createReview, reviewReply } from "./review.ts";

const project = (id: string, brief: Partial<Project["brief"]> = {}): Project => ({
  id,
  name: id.toUpperCase(),
  brief: { subjects: "", styles: "", avoid: "", ...brief },
  constraints: { profiles: [], loras: true, aspect: "", resolution: "" },
  createdAt: "",
  updatedAt: "",
});

test("a reply becomes a whole score from 1 to 10, with a miss only at 5 or below; no score is none", () => {
  assert.deepEqual(reviewReply({ score: 8.6, miss: "too dark" }), { score: 9, miss: "" });
  assert.deepEqual(reviewReply({ score: 3, miss: " a  man, not a woman " }), {
    score: 3,
    miss: "a man, not a woman",
  });
  assert.deepEqual(reviewReply({ score: 0 }), { score: 1, miss: "Misses the brief." });
  assert.deepEqual(reviewReply({ score: 42 }), { score: 10, miss: "" });
  assert.deepEqual(reviewReply({ score: "6" }), { score: 6, miss: "" });
  for (const score of [undefined, null, "", "high", Number.NaN])
    assert.equal(reviewReply({ score, miss: "a miss" }), null);
});

test("review scores each unseen project image against its brief and saves it", async () => {
  const saved: [string, Review][] = [];
  const asked: { brief: string; explicit: boolean }[] = [];
  const items: ReviewItem[] = [
    { id: "kept", type: "image", status: "done", dream: { state: "kept", projectId: "beach" } },
    { id: "free", type: "image", status: "done", dream: { state: "unseen" } },
    { id: "blank", type: "image", status: "done", dream: { state: "unseen", projectId: "empty" } },
    { id: "video", type: "video", status: "done", dream: { state: "unseen", projectId: "beach" } },
    { id: "beach", type: "image", status: "done", dream: { state: "unseen", projectId: "beach" } },
  ];
  const review = createReview({
    enabled: () => true,
    writer: {
      supportsVision: async () => true,
      review: async ({ brief, explicit }) => (
        asked.push({ brief, explicit }),
        { score: 3, miss: "no sea", model: "vision" }
      ),
    },
    idle: () => true,
    allowed: () => true,
    text: () => ({ side: "cloud", uncensored: false }),
    items: () => items,
    visible: () => true,
    projects: () => [project("beach", { subjects: "the sea", avoid: "people" }), project("empty")],
    explicit: () => true,
    image: async () => ({ mime: "image/jpeg", data: "" }),
    save: (item, result) => saved.push([String(item.id), result]),
    now: () => 0,
    log: { info() {} },
  });
  assert.equal(await review.tick(), "done");
  assert.deepEqual(asked, [{ brief: "Subjects: the sea\nAvoid: people", explicit: true }]);
  assert.deepEqual(
    saved.map(([id, { brief, ...result }]) => [id, result, typeof brief]),
    [
      [
        "beach",
        { score: 3, miss: "no sea", model: "vision", at: "1970-01-01T00:00:00.000Z" },
        "string",
      ],
    ],
  );
});

test("review checks recent project images, again once the brief changes", async () => {
  const day = 24 * 60 * 60_000;
  let now = 30 * day;
  const made = (age: number) => new Date(now - age * day).toISOString();
  let brief = { subjects: "a fox" };
  const asked: string[] = [];
  const dream = { state: "kept", projectId: "fox" };
  const items: ReviewItem[] = [
    { id: "old", type: "image", status: "done", createdAt: made(8), dream },
    { id: "free", type: "image", status: "done", createdAt: made(0), prompt: "a fox" },
    { id: "no", type: "image", status: "done", createdAt: made(0), rating: "disliked", dream },
    { id: "new", type: "image", status: "done", createdAt: made(1), dream },
  ];
  const review = createReview({
    enabled: () => true,
    writer: {
      supportsVision: async () => true,
      review: async ({ brief }) => (
        asked.push(brief),
        { score: 4, miss: "no fox", model: "vision" }
      ),
    },
    idle: () => true,
    allowed: () => true,
    text: () => ({ side: "cloud", uncensored: false }),
    items: () => items,
    visible: () => true,
    projects: () => [project("fox", brief)],
    explicit: () => false,
    image: async () => ({ mime: "image/jpeg", data: "" }),
    save: (item, result) => Object.assign(item, { review: result }),
    now: () => now,
    log: { info() {} },
  });
  assert.equal(await review.tick(), "done");
  assert.deepEqual(asked, ["Subjects: a fox"]);
  assert.deepEqual(
    items.map((item) => [item.id, item.review?.miss]),
    [
      ["old", undefined],
      ["free", undefined],
      ["no", undefined],
      ["new", "no fox"],
    ],
  );
  now += 60_000;
  assert.equal(await review.tick(), "none");
  brief = { subjects: "two foxes" };
  assert.equal(await review.tick(), "done");
  assert.equal(asked.at(-1), "Subjects: two foxes");
});
