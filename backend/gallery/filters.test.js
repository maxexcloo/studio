import assert from "node:assert/strict";
import test from "node:test";
import { matchesGalleryFilters, topCaptionTags } from "./filters.js";

const item = {
  model: "flux.safetensors",
  status: "done",
  prompt: "Qwen in the snow",
  settings: {
    modelName: "Flux Fast",
    profileId: "custom:landscape",
    workflow: "Landscape Photo",
    loras: [{ name: "film-grain.safetensors" }],
  },
};

test("structured filters match their own metadata and combine across fields", () => {
  assert.equal(
    matchesGalleryFilters(item, { model: "FLUX", workflow: "landscape", lora: "grain" }),
    true,
  );
  assert.equal(
    matchesGalleryFilters(item, { model: "landscape" }),
    false,
    "workflow identifiers are not model names",
  );
  assert.equal(
    matchesGalleryFilters(item, { model: "qwen" }),
    false,
    "a prompt mention is not a model match",
  );
  assert.equal(matchesGalleryFilters(item, { model: "flux", lora: "portrait" }), false);
  assert.equal(matchesGalleryFilters({ status: "failed" }, { model: "flux" }), false);
  assert.equal(matchesGalleryFilters(item, { workflow: "   " }), true);
});

test("pending jobs remain visible while filtering completed media", () => {
  assert.equal(
    matchesGalleryFilters({ status: "pending" }, { model: "unrelated", workflow: "missing" }),
    true,
  );
});

test("size bands follow the long edge without overlap, and aspects are orientations with a square tolerance", async () => {
  const { aspectOf, matchesGalleryFilters, sizeBandOf } = await import("./filters.js");
  const item = (width, height, extra = {}) => ({ status: "done", width, height, ...extra });
  assert.deepEqual(
    [1024, 1025, 1536, 1537, 2048, 2049].map((edge) => sizeBandOf(item(edge, 512))),
    ["up-to-1k", "1k-1.5k", "1k-1.5k", "1.5k-2k", "1.5k-2k", "over-2k"],
  );
  assert.equal(sizeBandOf(item(768, 2048)), "1.5k-2k");
  assert.deepEqual(
    [
      [1024, 1024],
      [1024, 1000],
      [1000, 1024],
      [1344, 768],
      [768, 1344],
      [1000, 300],
    ].map(([w, h]) => aspectOf(item(w, h))),
    ["square", "square", "square", "landscape", "portrait", "landscape"],
  );

  // Unknown sizes stay unless a size or aspect filter is on; pending jobs always stay.
  const unknown = { status: "done" };
  assert.equal(matchesGalleryFilters(unknown, {}), true);
  assert.equal(matchesGalleryFilters(unknown, { size: "up-to-1k" }), false);
  assert.equal(
    matchesGalleryFilters({ status: "pending" }, { size: "over-2k", aspect: "square" }),
    true,
  );
  assert.equal(
    matchesGalleryFilters(item(2048, 2048), { size: "1.5k-2k", aspect: "square" }),
    true,
  );
  assert.equal(matchesGalleryFilters(item(2048, 2048), { size: "over-2k" }), false);
});

test("a filter with several values matches any of them, and filters still combine", async () => {
  const { filterValues, hasGalleryFilters } = await import("./filters.js");
  assert.equal(matchesGalleryFilters(item, { model: ["sdxl", "flux"] }), true);
  assert.equal(matchesGalleryFilters(item, { model: ["sdxl", "wan"] }), false);
  assert.equal(
    matchesGalleryFilters(item, { model: ["sdxl", "flux"], lora: ["portrait"] }),
    false,
    "filters combine with AND",
  );
  assert.equal(
    matchesGalleryFilters(item, { lora: ["portrait", "grain"], workflow: "landscape" }),
    true,
  );
  assert.equal(matchesGalleryFilters(item, { model: [] }), true, "an empty list is no filter");
  const square = { status: "done", width: 1024, height: 1024 };
  assert.equal(
    matchesGalleryFilters(square, {
      size: ["over-2k", "up-to-1k"],
      aspect: ["landscape", "square"],
    }),
    true,
  );
  assert.equal(matchesGalleryFilters(square, { size: ["over-2k", "1.5k-2k"] }), false);
  assert.equal(matchesGalleryFilters(square, { aspect: ["landscape", "portrait"] }), false);
  assert.deepEqual(filterValues([" a ", "", null, "b"]), ["a", "b"]);
  assert.deepEqual(filterValues("x"), ["x"]);
  assert.equal(hasGalleryFilters({ model: [], size: "" }), false);
  assert.equal(hasGalleryFilters({ aspect: ["square"] }), true);
});

test("caption tags filter whole, any of them, and the facet lists the most used first", () => {
  const tagged = (...tags) => ({ status: "done", caption: { text: "", tags } });
  assert.equal(matchesGalleryFilters(tagged("beach", "sunset"), { tag: ["sunset", "snow"] }), true);
  assert.equal(matchesGalleryFilters(tagged("sunsets"), { tag: "sunset" }), false);
  assert.equal(matchesGalleryFilters({ status: "done" }, { tag: "beach" }), false);
  assert.deepEqual(
    topCaptionTags([tagged("beach", "sunset"), tagged("sunset", "sunset"), tagged("anchor")], 2),
    [
      { value: "sunset", label: "sunset", count: 2 },
      { value: "anchor", label: "anchor", count: 1 },
    ],
  );
});
