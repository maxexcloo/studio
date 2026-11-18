import assert from "node:assert/strict";
import test from "node:test";

import { type ReflectionItem, daysOf, samenessOf } from "./reflection.ts";

const images = (count: number, look: (index: number) => string) =>
  Array.from({ length: count }, (_, index) => ({ id: `${index}`, title: look(index) }));
// Items alike when they share a look.
const likeness = (a: ReflectionItem, b: ReflectionItem) => (a.title === b.title ? 0.95 : 0.5);

test("sameness flags recent results converging on one look, against the person's own baseline", () => {
  const varied = samenessOf(
    images(80, (index) => `look ${index % 20}`),
    likeness,
  );
  assert.equal(varied.converging, false);
  assert.deepEqual(varied.examples, []);
  // The newest 40 share three looks; the 40 before were varied.
  const narrowing = samenessOf(
    images(80, (index) => (index < 40 ? `look ${index % 3}` : `look ${index}`)),
    likeness,
  );
  assert.equal(narrowing.converging, true);
  assert.ok(narrowing.recent! > narrowing.earlier!);
  assert.equal(narrowing.examples.length, 4);
  // Without a baseline, only a strong majority of alike pairs counts.
  assert.equal(
    samenessOf(
      images(30, () => "one look"),
      likeness,
    ).converging,
    true,
  );
  assert.equal(
    samenessOf(
      images(30, (index) => `look ${index % 3}`),
      likeness,
    ).converging,
    false,
  );
  // Too few read images say nothing.
  assert.equal(
    samenessOf(
      images(5, () => "one look"),
      likeness,
    ).recent,
    null,
  );
});

test("days count each model's results, likes and dislikes in the person's time zone", () => {
  const item = (createdAt: string, modelName: string, rating?: string): ReflectionItem => ({
    id: createdAt + modelName,
    status: "done",
    createdAt,
    rating,
    model: "custom:image-kromafine",
    settings: { profileId: "custom:image-kromafine", profileName: "Kromafine", modelName },
  });
  const rows = daysOf(
    [
      item("2026-11-17T14:00:00Z", "kromafine-iq8r", "liked"),
      item("2026-11-17T13:00:00Z", "kromafine-iq8r", "disliked"),
      item("2026-11-17T12:00:00Z", "kromafine-fp8"),
      { ...item("2026-11-17T11:00:00Z", "kromafine-fp8"), dream: { state: "unseen" } },
    ],
    "Australia/Sydney",
    false,
  );
  assert.deepEqual(
    rows.map(({ day, model, made, liked, disliked }) => [day, model, made, liked, disliked]),
    [
      ["2026-11-18", "kromafine-iq8r", 2, 1, 1],
      ["2026-11-17", "kromafine-fp8", 1, 0, 0],
    ],
  );
});
