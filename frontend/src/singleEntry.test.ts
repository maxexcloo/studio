import assert from "node:assert/strict";
import test from "node:test";

import { UNSAFE_createMemoryHistory } from "react-router";

import { singleEntry } from "./singleEntry.ts";

test("a single-entry history replaces on push and goes back to the exact location it left", () => {
  const history = UNSAFE_createMemoryHistory({ initialEntries: ["/images"], v5Compat: true });
  const saved = new Map<string, string>();
  singleEntry(history, {
    getItem: (name) => saved.get(name) ?? null,
    setItem: (name, value) => void saved.set(name, value),
  });
  history.push("/images", { similar: "a" });
  const gallery = history.location;
  history.push("/images/1", { viewer: true });
  history.replace("/images/2", { viewer: true });
  assert.equal(history.index, 0);
  history.go(-1);
  assert.deepEqual(history.location, gallery);
  history.go(-2);
  assert.equal(history.location.key, gallery.key);
  history.go(-1);
  assert.equal(history.location.pathname, "/images");
  assert.equal(history.location.state, null);
  assert.equal(history.index, 0);
  assert.equal(saved.get("studio-history"), "[]");
});

test("a single-entry history keeps the last 50 locations and survives full storage", () => {
  const history = UNSAFE_createMemoryHistory({ initialEntries: ["/0"], v5Compat: true });
  singleEntry(history, {
    getItem: () => null,
    setItem: () => {
      throw new DOMException("Full", "QuotaExceededError");
    },
  });
  for (let index = 1; index <= 60; index++) history.push(`/${index}`);
  history.go(-50);
  assert.equal(history.location.pathname, "/10");
  history.go(-1);
  assert.equal(history.location.pathname, "/10");
});
