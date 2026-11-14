import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase } from "../persistence/runtime.ts";
import { stylesWithChoice } from "./projects.ts";
import { createResultNumbers, type Numbered } from "./result-numbers.ts";

test("result numbers start from an account's oldest result and stay with their output", () => {
  const db = openDatabase(":memory:");
  const gallery: Numbered[] = [
    { jobId: "new", index: 0, ownerId: "alice", createdAt: "2026-11-02T00:00:00Z" },
    { jobId: "old", index: 1, ownerId: "alice", createdAt: "2026-11-01T00:00:00Z" },
    { jobId: "old", index: 0, ownerId: "alice", createdAt: "2026-11-01T00:00:00Z" },
    { jobId: "bob", index: 0, ownerId: "bob", createdAt: "2026-11-01T00:00:00Z" },
  ];
  const numbers = createResultNumbers({
    db,
    existing: (ownerId) => gallery.filter((item) => item.ownerId === ownerId),
  });
  // The first numbering takes everything the account already has, oldest first.
  const fresh = { jobId: "queued", index: 0, ownerId: "alice" };
  assert.deepEqual(
    numbers.numbered([gallery[0], fresh]).map((item) => item.number),
    [3, 4],
  );
  assert.deepEqual(numbers.find("alice", 1), { jobId: "old", index: 0 });
  assert.deepEqual(numbers.find("alice", 2), { jobId: "old", index: 1 });
  // Each account counts on its own; items without a job have no number.
  assert.equal(numbers.numbered([gallery[3]])[0].number, 1);
  assert.equal(numbers.numbered([{ ownerId: "alice" }])[0].number, undefined);
  // A restart reads the same numbers back and carries on after the highest.
  const again = createResultNumbers({ db, existing: () => [] });
  assert.equal(again.numbered([{ ...fresh, createdAt: "later" }])[0].number, 4);
  assert.equal(again.numbered([{ jobId: "next", ownerId: "alice" }])[0].number, 5);
  assert.equal(again.find("alice", 99), null);
});

test("a pick replaces its axis's earlier pick in the brief's styles", () => {
  assert.equal(stylesWithChoice("", "Lighting", "warm dusk"), "lighting: warm dusk");
  assert.equal(
    stylesWithChoice("film grain; lighting: cold; pose: seated", "lighting", "warm dusk"),
    "film grain; pose: seated; lighting: warm dusk",
  );
  // The oldest parts give way to keep the brief within its length.
  const long = Array.from({ length: 60 }, (_, index) => `style ${index}`).join("; ");
  const styles = stylesWithChoice(long, "lighting", "warm");
  assert.ok(styles.length <= 600);
  assert.ok(styles.endsWith("lighting: warm"));
  assert.ok(!styles.startsWith("style 0;"));
});
