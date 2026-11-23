import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Store } from "./domain/store.ts";
import { readGalleryRows, writeGalleryRows } from "./persistence/gallery-rows.ts";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  runtimeDatabase,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";
import { hashOf } from "./profile/store.js";
import { uncensoredNames } from "./uncensored-names.js";

test("uncensoredNames renames Spicy records and prompt styles to Uncensored, once", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-uncensored-names-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const db = runtimeDatabase(dataDir);
  writeRuntimeDocument(dataDir, "dream:a", { settings: { enabled: true, spicy: true } });
  writeGalleryRows(db, [
    {
      id: "dreamt",
      dream: { prompt: "p", spicy: true },
      nextSteps: { spicy: true, items: [] },
      assistant: { preset: "spicy" },
      caption: { tags: ["spicy food"] },
    },
    { id: "plain", caption: { tags: ["spicy food"] } },
  ]);
  const styles = [
    { id: "spicy", kind: "animate", label: "Spicy", instruction: "i", enabled: true },
    { id: "spicy", kind: "improve", label: "Mine", instruction: "i", enabled: true },
    { id: "enhance", kind: "improve", label: "Enhance", instruction: "i", enabled: true },
  ];
  fs.writeFileSync(path.join(dataDir, "prompt-styles.json"), JSON.stringify({ styles, meta: {} }));
  const history = path.join(dataDir, "history", "prompt-styles");
  fs.mkdirSync(history, { recursive: true });
  fs.writeFileSync(path.join(history, "1.json"), JSON.stringify({ hash: hashOf(styles), styles }));

  const plan = {
    rows: { studio_documents: 1, studio_gallery: 1 },
    styleFiles: 2,
    conflicts: [],
  };
  assert.deepEqual(uncensoredNames(dataDir), { applied: false, ...plan });
  assert.deepEqual(uncensoredNames(dataDir, { apply: true }), { applied: true, ...plan });

  assert.deepEqual(readRuntimeDocument(dataDir, "dream:a"), {
    settings: { enabled: true, uncensored: true },
  });
  const [dreamt, plain] = readGalleryRows(db).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(dreamt.dream, { prompt: "p", uncensored: true });
  assert.deepEqual(dreamt.nextSteps, { uncensored: true, items: [] });
  assert.deepEqual(dreamt.assistant, { preset: "uncensored" });
  assert.deepEqual(plain.caption, { tags: ["spicy food"] });
  const renamed = [
    { ...styles[0], id: "uncensored", label: "Uncensored" },
    { ...styles[1], id: "uncensored" },
    styles[2],
  ];
  const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(read(path.join(dataDir, "prompt-styles.json")).styles, renamed);
  assert.deepEqual(read(path.join(history, "1.json")), { hash: hashOf(renamed), styles: renamed });

  assert.deepEqual(uncensoredNames(dataDir, { apply: true }), {
    applied: true,
    rows: { studio_documents: 0, studio_gallery: 0 },
    styleFiles: 0,
    conflicts: [],
  });
});

test("uncensoredNames renames queue records, and a conflict applies nothing", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-uncensored-names-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  new Store(runtimeDatabase(dataDir));
  const db = runtimeDatabase(dataDir);
  db.prepare("INSERT INTO studio_sessions VALUES ('s', 'a', '', ?)").run(
    JSON.stringify({ inputs: { writing: { theme: "spicy", spicy: true } } }),
  );
  db.prepare("INSERT INTO studio_queue VALUES ('j', 'a', 's', '', 'completed', ?)").run(
    JSON.stringify({ input: { writing: { spicy: true } }, outputs: [{ dream: { spicy: true } }] }),
  );
  const both = { settings: { spicy: true, uncensored: false } };
  writeRuntimeDocument(dataDir, "dream:b", both);

  const conflicted = uncensoredNames(dataDir, { apply: true });
  assert.equal(conflicted.applied, false);
  assert.deepEqual(conflicted.conflicts, [
    "studio_documents dream:b: holds both spicy and uncensored.",
  ]);
  assert.deepEqual(readRuntimeDocument(dataDir, "dream:b"), both);

  writeRuntimeDocument(dataDir, "dream:b", { settings: { uncensored: false } });
  assert.equal(uncensoredNames(dataDir, { apply: true }).applied, true);
  const record = (table) => JSON.parse(db.prepare(`SELECT record FROM ${table}`).get().record);
  assert.deepEqual(record("studio_sessions"), {
    inputs: { writing: { theme: "uncensored", uncensored: true } },
  });
  assert.deepEqual(record("studio_queue"), {
    input: { writing: { uncensored: true } },
    outputs: [{ dream: { uncensored: true } }],
  });
});
