import assert from "node:assert/strict";
import test from "node:test";

import type { Project, Review } from "../../shared/projects.ts";
import { type ReviewItem, createReview, digest, reviewReply } from "./review.ts";

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

test("the digest groups results by project, ranks them by score and keeps misses apart", () => {
  const item = (id: string, projectId: string | undefined, score?: number, miss = "") => ({
    id,
    createdAt: `2026-11-1${id.at(-1)}T00:00:00.000Z`,
    dream: { state: "unseen", ...(projectId ? { projectId } : {}) },
    ...(score === undefined ? {} : { review: { score, miss, model: "m", at: "" } }),
  });
  const groups = digest(
    [
      item("a1", "beach", 6),
      item("a2", "beach", 9),
      item("a3", "beach", 2, "no sea"),
      item("a4", "beach"),
      item("a5", "beach", 4, "indoors"),
      item("b6", "gone", 8),
      item("b7", undefined),
      item("c8", "city", 7),
    ],
    [project("city"), project("beach"), project("empty")],
  );
  assert.deepEqual(
    groups.map(({ projectId, name, items, misses }) => [
      projectId,
      name,
      items.map((entry) => entry.id),
      misses.map((entry) => entry.id),
    ]),
    [
      ["city", "CITY", ["c8"], []],
      // Unreviewed results follow the scored ones.
      ["beach", "BEACH", ["a2", "a1", "a4"], ["a5", "a3"]],
      // A deleted project's results join those without one.
      [null, "Other", ["b6", "b7"], []],
    ],
  );
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
    rules: () => [],
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

test("review checks recent images against their owner's rules, again once the rules change", async () => {
  const day = 24 * 60 * 60_000;
  let now = 30 * day;
  const made = (age: number) => new Date(now - age * day).toISOString();
  let rules = ["always photographic, never CGI"];
  const asked: string[] = [];
  const items: ReviewItem[] = [
    { id: "old", type: "image", status: "done", createdAt: made(8), prompt: "a fox" },
    { id: "clip", type: "video", status: "done", createdAt: made(0), prompt: "a fox" },
    { id: "no", type: "image", status: "done", createdAt: made(0), rating: "disliked" },
    { id: "new", type: "image", status: "done", createdAt: made(1), prompt: "a fox" },
  ];
  const review = createReview({
    writer: {
      supportsVision: async () => true,
      review: async ({ brief }) => (
        asked.push(brief),
        { score: 4, miss: "breaks 'never CGI': looks rendered", model: "vision" }
      ),
    },
    idle: () => true,
    allowed: () => true,
    text: () => ({ side: "cloud", uncensored: false }),
    items: () => items,
    visible: () => true,
    projects: () => [],
    rules: () => rules,
    explicit: () => false,
    image: async () => ({ mime: "image/jpeg", data: "" }),
    save: (item, result) => Object.assign(item, { review: result }),
    now: () => now,
    log: { info() {} },
  });
  assert.equal(await review.tick(), "done");
  assert.deepEqual(asked, ["Rules:\n- always photographic, never CGI\nPrompt: a fox"]);
  assert.deepEqual(
    items.map((item) => [item.id, item.review?.miss]),
    [
      ["old", undefined],
      ["clip", undefined],
      ["no", undefined],
      ["new", "breaks 'never CGI': looks rendered"],
    ],
  );
  now += 60_000;
  assert.equal(await review.tick(), "none");
  rules = ["never CGI"];
  now += 60_000;
  assert.equal(await review.tick(), "done");
  assert.equal(asked.at(-1), "Rules:\n- never CGI\nPrompt: a fox");
});
