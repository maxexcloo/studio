import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loraRatings } from "./ratings.js";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "../persistence/runtime.ts";

test("favourites become thumbs up after a dry run, with a backup, once", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-lora-ratings-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const before = JSON.stringify({
    stacks: {},
    library: {
      favorites: ["a.safetensors", "b.safetensors"],
      ratings: { "b.safetensors": "down" },
    },
  });
  writeRuntimeDocument(dataDir, "lora-stacks:abc", JSON.parse(before));

  const plan = loraRatings(dataDir);
  assert.equal(plan.applied, false);
  assert.deepEqual(plan.files, [
    {
      source: "lora-stacks:abc",
      copy: "accounts__abc__lora-stacks.json",
      favourites: 2,
    },
  ]);
  assert.equal(JSON.stringify(readRuntimeDocument(dataDir, "lora-stacks:abc")), before);

  const result = loraRatings(dataDir, { apply: true });
  assert.equal(
    fs.readFileSync(path.join(result.backup, "accounts__abc__lora-stacks.json"), "utf8"),
    before,
  );
  const { library } = readRuntimeDocument(dataDir, "lora-stacks:abc");
  assert.deepEqual(library, { ratings: { "a.safetensors": "up", "b.safetensors": "down" } });
  assert.deepEqual(loraRatings(dataDir).files, []);
});
