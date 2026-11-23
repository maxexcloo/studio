import assert from "node:assert/strict";
import test from "node:test";

import type { MediaItem } from "../../types";
import { derivations, versionGroups, versionSources, versionTree } from "./versions.ts";

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

test("a result without an ID yet is an original of its own", () => {
  const pending = { ...result("pending", 5), id: undefined } as unknown as MediaItem;
  const groups = versionGroups([pending, ...items], []);
  assert.deepEqual(
    groups.map((group) => group.map(({ id }) => id)),
    [[undefined], ["original", "other", "edit", "again", "latest"]],
  );
});

test("Details finds the direct source, original, and both kinds of direct offshoot", () => {
  const later = result("later", 6, latest.id);
  const derived = result("derived", 5, latest.id, true);
  assert.deepEqual(derivations(latest, [later, derived, ...items], []), {
    sourceId: edit.id,
    source: edit,
    original,
    versions: [later],
    derived: [derived],
  });
  // A partially loaded chain still identifies its immediate source.
  const partial = derivations(latest, [latest, edit], []);
  assert.equal(partial.source, edit);
  assert.equal(partial.original, undefined);
  assert.equal(derivations(latest, [latest], []).sourceId, edit.id);
});
