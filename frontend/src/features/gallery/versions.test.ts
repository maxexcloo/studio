import assert from "node:assert/strict";
import test from "node:test";
import type { MediaItem } from "../../types";
import { versionGroups, versionSources, versionTree } from "./versions.ts";

const result = (id: string, minute: number, parentItemId?: string, derived?: boolean) =>
  ({
    id,
    type: "image",
    status: "done",
    url: `/${id}.png`,
    prompt: "An amber bird",
    sessionId: "session",
    createdAt: `2026-11-13T00:0${minute}:00.000Z`,
    parentItemId,
    derived,
  }) as MediaItem;

// Newest first, as the gallery lists them: an original, two edits of it and two runs of the first.
const original = result("original", 0);
const edit = result("edit", 1, "original");
const other = result("other", 2, "original");
const again = result("again", 3, "edit");
const latest = result("latest", 4, "edit");
const items = [latest, again, other, edit, original];

test("a version tree keeps each branch together, the one with the latest version last", () => {
  const tree = versionTree(items, versionSources(items, []));
  assert.deepEqual(
    tree.map(({ item, source, depth }) => [item.id, source, depth]),
    [
      ["original", undefined, 0],
      ["other", "original", 1],
      ["edit", "original", 1],
      ["again", "edit", 2],
      ["latest", "edit", 2],
    ],
  );
});

test("groups hold only versions, ordered by their latest, not runs sharing a session or prompt", () => {
  const unrelated = result("unrelated", 5);
  const derived = result("derived", 6, "latest", true);
  const groups = versionGroups([derived, unrelated, ...items], []);
  assert.deepEqual(
    groups.map((group) => group.map(({ id }) => id)),
    [["derived"], ["unrelated"], ["original", "other", "edit", "again", "latest"]],
  );
});

test("a version whose source is not loaded starts its own tree", () => {
  const groups = versionGroups([latest, again, edit], []);
  assert.deepEqual(
    groups.map((group) => group.map(({ id }) => id)),
    [["edit", "again", "latest"]],
  );
});
