import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { galleryTitles } from "./gallery-titles.js";
import { readGalleryRows, writeGalleryRows } from "./persistence/gallery-rows.ts";
import { closeRuntimeDatabase, runtimeDatabase } from "./persistence/runtime.ts";

test("galleryTitles puts titles in Title Case, renames prompt-cut sets and clears cut titles, once", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-gallery-titles-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const prompt = "Generate images of a tiny tree frog on a dewy leaf, macro";
  const cut = { id: "frog", title: "Generate images of a tiny", index: 0 };
  writeGalleryRows(runtimeDatabase(dataDir), [
    { id: "a", prompt, title: "Jumping Spider On Fingertip", resultSet: cut },
    { id: "b", prompt: "a frog", title: "Tiny Tree Frog on Dewy", resultSet: { ...cut, index: 1 } },
    {
      id: "c",
      prompt: "Mia on a beach",
      resultSet: { id: "mia", title: "Mia", character: { id: "m", name: "Mia" } },
    },
    {
      id: "d",
      prompt: "x",
      title: "Quiet Harbour",
      resultSet: { id: "s", title: "harbour at dawn", variation: "boats On water" },
    },
  ]);
  const plan = { titles: 1, cleared: 1, setItems: 3 };
  assert.deepEqual(galleryTitles(dataDir), { applied: false, ...plan });
  assert.deepEqual(galleryTitles(dataDir, { apply: true }), { applied: true, ...plan });
  const named = { id: "frog", title: "Tiny Tree Frog" };
  assert.deepEqual(
    readGalleryRows(runtimeDatabase(dataDir)).sort((a, b) => a.id.localeCompare(b.id)),
    [
      {
        id: "a",
        prompt,
        title: "Jumping Spider on Fingertip",
        resultSet: { ...named, index: 0 },
      },
      { id: "b", prompt: "a frog", resultSet: { ...named, index: 1 } },
      {
        id: "c",
        prompt: "Mia on a beach",
        resultSet: { id: "mia", title: "Mia", character: { id: "m", name: "Mia" } },
      },
      {
        id: "d",
        prompt: "x",
        title: "Quiet Harbour",
        resultSet: { id: "s", title: "Harbour at Dawn", variation: "Boats on Water" },
      },
    ],
  );
  assert.deepEqual(galleryTitles(dataDir), {
    applied: false,
    titles: 0,
    cleared: 0,
    setItems: 0,
  });
});
