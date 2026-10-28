import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loraRatings } from "./lora-ratings.js";

test("favourites become thumbs up after a dry run, with a backup, once", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-lora-ratings-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const file = path.join(dataDir, "accounts", "abc", "lora-stacks.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const before = JSON.stringify({
    stacks: {},
    library: {
      favorites: ["a.safetensors", "b.safetensors"],
      ratings: { "b.safetensors": "down" },
    },
  });
  fs.writeFileSync(file, before);

  const plan = loraRatings(dataDir);
  assert.equal(plan.applied, false);
  assert.deepEqual(plan.files, [
    {
      source: "accounts/abc/lora-stacks.json",
      copy: "accounts__abc__lora-stacks.json",
      favourites: 2,
    },
  ]);
  assert.equal(fs.readFileSync(file, "utf8"), before);

  const result = loraRatings(dataDir, { apply: true });
  assert.equal(
    fs.readFileSync(path.join(result.backup, "accounts__abc__lora-stacks.json"), "utf8"),
    before,
  );
  const { library } = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(library, { ratings: { "a.safetensors": "up", "b.safetensors": "down" } });
  assert.deepEqual(loraRatings(dataDir).files, []);
});
