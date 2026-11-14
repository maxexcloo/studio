import assert from "node:assert/strict";
import test from "node:test";

import { missingComfyOutputs } from "./missing-comfy-outputs.js";

const answer = (status) => Object.assign(new Error(`Comfy ${status}`), { status });
const record = (name, createdAt) => ({
  id: `/comfy/view?filename=${name}&type=output`,
  url: `/comfy/view?filename=${name}&type=output`,
  createdAt,
});

/** The server's gallery over these items, with the worker answering each file as `files` says. */
function fakeGallery(items, files) {
  const gallery = {
    list: items,
    checks: 0,
    items: () => gallery.list,
    check: async (item) => {
      gallery.checks += 1;
      const file = files[new URL(item.url, "http://studio").searchParams.get("filename")];
      if (file instanceof Error) throw file;
      if (!file) throw answer(404);
    },
    remove: (gone) => (gallery.list = gallery.list.filter((item) => !gone.includes(item))),
  };
  return gallery;
}

test("missingComfyOutputs plans and deletes records whose ComfyUI file is gone, keeping the rest", async () => {
  const gone = record("gone.png", "2026-03-01T00:00:00.000Z");
  const there = record("there.png", "2026-03-02T00:00:00.000Z");
  const media = { id: "m", url: "/comfy/view?filename=m.png&subfolder=studio&type=media" };
  const gallery = fakeGallery([gone, there, media], { "there.png": true });

  assert.equal((await missingComfyOutputs("")).skipped.includes("POST"), true, "offline skips");
  const plan = await missingComfyOutputs("", { gallery });
  assert.deepEqual(
    { checked: plan.checked, missing: plan.missing, unknown: plan.unknown, applied: plan.applied },
    { checked: 2, missing: 1, unknown: 0, applied: false },
  );
  assert.deepEqual(plan.examples, [{ id: gone.id, createdAt: gone.createdAt }]);
  assert.match(plan.note, /for good/);
  assert.equal(gallery.list.length, 3, "a dry run deletes nothing");
  assert.equal(gallery.checks, 2, "Studio media is never asked about");

  assert.equal((await missingComfyOutputs("", { gallery, apply: true })).applied, true);
  assert.deepEqual(gallery.list, [there, media]);
  const again = await missingComfyOutputs("", { gallery, apply: true });
  assert.deepEqual([again.missing, again.applied], [0, false], "a second run finds nothing");
});

test("missingComfyOutputs keeps what a worker that doesn't answer leaves unknown", async () => {
  const items = ["a.png", "b.png", "c.png"].map((name) => record(name));
  const down = new TypeError("fetch failed");
  const gallery = fakeGallery(items, { "a.png": down, "b.png": down, "c.png": down });
  const result = await missingComfyOutputs("", { gallery, apply: true });
  assert.deepEqual(
    { checked: result.checked, missing: result.missing, unknown: result.unknown },
    { checked: 0, missing: 0, unknown: 3 },
  );
  assert.equal(result.error, "fetch failed");
  assert.equal(result.applied, false);
  assert.equal(gallery.list.length, 3);

  const busy = fakeGallery([record("x.png")], { "x.png": answer(503) });
  assert.equal((await missingComfyOutputs("", { gallery: busy, apply: true })).unknown, 1);
  assert.equal(busy.list.length, 1);
});
