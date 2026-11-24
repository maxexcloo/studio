import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";
import { tasteSimplify } from "./taste-simplify.js";

test("tasteSimplify plans each account's move, applies it once, and a conflict applies nothing", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-taste-simplify-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const signals = [{ at: "2026-01-01T00:00:00.000Z", kind: "like" }];
  writeRuntimeDocument(dataDir, "taste:a", {
    signals,
    likes: ["learnt"],
    preferences: {
      avoid: ["Smoking"],
      exclusions: ["smoking", "laundry rooms"],
      rules: ["never CGI", "always photographic, never CGI", "no people unless asked"],
      likes: ["lighthouses"],
      note: "Moody evenings.",
      models: ["flux"],
    },
  });
  writeRuntimeDocument(dataDir, "taste:b", { signals, preferences: { exclusions: ["hats"] } });
  const plan = {
    applied: false,
    accounts: [
      {
        account: "a",
        exclusions: ["cgi"],
        preferences: [
          "always photographic, never CGI",
          "no people unless asked",
          "Likes: lighthouses.",
          "Moody evenings.",
        ],
        favourites: { models: ["flux"] },
      },
    ],
    conflicts: [],
  };
  assert.deepEqual(tasteSimplify(dataDir), plan);
  assert.deepEqual(tasteSimplify(dataDir, { apply: true }), { ...plan, applied: true });
  assert.deepEqual(readRuntimeDocument(dataDir, "taste:a"), {
    signals,
    likes: ["learnt"],
    preferences: {
      exclusions: ["smoking", "laundry rooms", "cgi"],
      prefer:
        "always photographic, never CGI\nno people unless asked\nLikes: lighthouses.\nMoody evenings.",
      favourites: { models: ["flux"] },
    },
  });
  assert.deepEqual(readRuntimeDocument(dataDir, "taste:b").preferences, { exclusions: ["hats"] });
  assert.deepEqual(tasteSimplify(dataDir, { apply: true }), {
    applied: true,
    accounts: [],
    conflicts: [],
  });

  writeRuntimeDocument(dataDir, "taste:c", {
    preferences: { avoid: Array.from({ length: 41 }, (_, index) => `motif ${index}`) },
  });
  const refused = tasteSimplify(dataDir, { apply: true });
  assert.equal(refused.applied, false);
  assert.deepEqual(refused.conflicts, ["c: Exclusions would hold 41, over 40."]);
  assert.ok(readRuntimeDocument(dataDir, "taste:c").preferences.avoid);
});
