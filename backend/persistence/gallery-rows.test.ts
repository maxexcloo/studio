import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readGalleryRows, writeGalleryRows } from "./gallery-rows.ts";
import { closeRuntimeDatabase, runtimeDatabase } from "./runtime.ts";

test("Studio writes each gallery change to its row at once, never a preview", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-gallery-rows-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const item = (id: string, minute: number) => ({
    id,
    type: "image",
    status: "done",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
  });
  writeGalleryRows(runtimeDatabase(dataDir), [item("kept", 2), item("removed", 1)]);
  closeRuntimeDatabase(dataDir);

  const run = (source: string) =>
    execFileSync(process.execPath, ["--input-type=module", "--eval", source], {
      cwd: new URL("../../", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, STUDIO_DATA_DIR: dataDir, STUDIO_ENV_FILE: "/dev/null" },
    });
  run(`
    import assert from 'node:assert/strict';
    import {forgetGalleryItems,galleryItem,galleryItems,putGalleryItems,setGalleryFavorites} from './backend/gallery/store.js';
    assert.deepEqual(galleryItems().map(item=>item.id),['kept','removed']);
    setGalleryFavorites(['kept'],true);
    forgetGalleryItems([galleryItem('removed')]);
    putGalleryItems([{id:'added',type:'image',status:'done',createdAt:'2026-01-02T00:00:00Z',preview:'data:'}]);
  `);
  const rows = readGalleryRows(runtimeDatabase(dataDir)) as {
    id: string;
    favorite?: boolean;
    preview?: string;
  }[];
  assert.deepEqual(rows.map((row) => row.id).sort(), ["added", "kept"]);
  assert.equal(rows.find((row) => row.id === "kept")?.favorite, true);
  assert.equal(rows.find((row) => row.id === "added")?.preview, undefined);
});
