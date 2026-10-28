import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createImageSearch, createImageVectors, type ImageEncoder } from "./image-search.ts";
import type { IdleItem } from "./idle-work.ts";

const item = (id: string, type = "image"): IdleItem => ({
  id,
  url: `/media/${id}.png`,
  type,
  status: "done",
});
/** A unit vector along `axis` of a 4-dimension space, leaning `lean` towards the next axis. */
const along = (axis: number, lean = 0) => {
  const vector = new Float32Array(4);
  vector[axis] = Math.sqrt(1 - lean * lean);
  vector[(axis + 1) % 4] = lean;
  return vector;
};

test("vectors keep in float16 across restarts and drop another model's", () => {
  const db = new DatabaseSync(":memory:");
  const first = createImageVectors(db, "v1");
  first.set(item("a"), along(0, 0.3));
  assert.equal(first.has(item("a")), true);
  const again = createImageVectors(db, "v1");
  assert.ok(Math.abs(again.get(item("a"))![1] - 0.3) < 0.001, "float16 is close enough");
  assert.equal(createImageVectors(db, "v2").size, 0, "another model starts again");
  assert.equal(createImageVectors(db, "v1").size, 0, "and the old rows are gone");
});

test("idle work reads finished images once and search matches those that look alike", async () => {
  const items = [item("cat"), item("dog"), item("clip", "video")];
  const read: string[] = [];
  const texts: string[] = [];
  let enabled = true;
  let downloaded = true;
  const encoder: ImageEncoder = {
    unavailable: () => "",
    downloaded: () => downloaded,
    embedImage: async (bytes) => {
      const name = new TextDecoder().decode(bytes);
      read.push(name);
      return name === "cat" ? along(0) : along(2);
    },
    embedText: async (text) => {
      texts.push(text);
      return along(0, 0.1);
    },
  };
  const search = createImageSearch({
    enabled: () => enabled,
    encoder,
    vectors: createImageVectors(new DatabaseSync(":memory:"), "v1"),
    idle: () => true,
    items: () => items,
    visible: () => true,
    image: async (record) => new TextEncoder().encode(record.id),
    load: () => null,
    persist: () => {},
    log: { info: () => {} },
  });
  search.startPass();
  await search.settled();
  assert.deepEqual(read.sort(), ["cat", "dog"], "images only");
  assert.equal((await search.status()).remaining, 0);

  const near = await search.near("  Ginger Cat ");
  assert.deepEqual(
    items.filter((record) => near!(record)).map((record) => record.id),
    ["cat"],
  );
  await search.near("ginger cat");
  assert.deepEqual(texts, ["ginger cat"], "a repeated search reuses its vector");

  downloaded = false;
  assert.equal(await search.near("dog"), null, "a search never downloads the model");
  downloaded = true;
  enabled = false;
  assert.equal(await search.near("dog"), null, "off in Settings");
});
