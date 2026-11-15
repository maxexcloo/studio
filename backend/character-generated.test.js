import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { characterGenerated } from "./character-generated.js";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

test("characterGenerated plans, then drops Generate References' waiting picks from characters", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-character-generated-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const mara = { id: "chr-1", name: "Mara", referenceIds: ["a"] };
  writeRuntimeDocument(dataDir, "characters:owner", {
    characters: [{ ...mara, generated: { jobIds: ["j1", "j2"], at: "" } }, { id: "chr-2" }],
  });
  writeRuntimeDocument(dataDir, "outfits:owner", { outfits: [{ id: "out-1" }] });
  const plan = { characters: 1, cards: [{ id: "chr-1", name: "Mara", jobs: 2 }] };
  assert.deepEqual(characterGenerated(dataDir), { applied: false, ...plan });
  assert.ok(readRuntimeDocument(dataDir, "characters:owner").characters[0].generated);
  assert.deepEqual(characterGenerated(dataDir, { apply: true }), { applied: true, ...plan });
  assert.deepEqual(readRuntimeDocument(dataDir, "characters:owner").characters, [
    mara,
    { id: "chr-2" },
  ]);
  assert.deepEqual(characterGenerated(dataDir, { apply: true }), {
    applied: true,
    characters: 0,
    cards: [],
  });
});
