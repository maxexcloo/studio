import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-gallery-import-"));
process.env.STUDIO_DATA_DIR = temporary;
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
const { importRecord, importUpload } = await import("./import.js");

const picture = (background) =>
  sharp({ create: { width: 24, height: 16, channels: 3, background } })
    .jpeg()
    .toBuffer();

test("an import keeps its prompt, model, time and source, and runs again without a copy", async () => {
  const record = {
    prompt: "A lighthouse at dusk",
    model: "Grok Imagine",
    createdAt: "2026-07-21T00:18:49.129Z",
    source: { url: "https://grok.com/imagine/post/abc", title: "Grok Imagine" },
  };
  const buffer = await picture("navy");
  const first = await importUpload({ buffer, mime: "image/jpeg", name: "a.jpg" }, record, "n");
  assert.equal(first.added, true);
  assert.deepEqual(
    [
      first.item.uploaded,
      first.item.ownerId,
      first.item.prompt,
      first.item.model,
      first.item.createdAt,
      first.item.source,
      first.item.filename,
    ],
    [true, "n", record.prompt, record.model, record.createdAt, record.source, record.prompt],
  );
  const again = await importUpload({ buffer, mime: "image/jpeg", name: "a.jpg" }, record, "n");
  assert.deepEqual([again.added, again.item.id], [false, first.item.id]);
  const elsewhere = await importUpload({ buffer, mime: "image/jpeg", name: "a.jpg" }, record, "m");
  assert.equal(elsewhere.added, true, "another account's import is its own");
});

test("an unreadable record is left out rather than stored", () => {
  assert.deepEqual(
    importRecord({
      prompt: 7,
      createdAt: "2999-01-01T00:00:00Z",
      source: { url: "javascript:alert(1)", title: "x" },
    }),
    { prompt: "", model: "", createdAt: "", source: undefined },
  );
  assert.deepEqual(importRecord(null), {
    prompt: "",
    model: "",
    createdAt: "",
    source: undefined,
  });
});
