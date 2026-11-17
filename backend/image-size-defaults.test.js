import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { imageSizeDefaults } from "./image-size-defaults.js";
import { createProfileStore } from "./profile/store.js";

test("imageSizeDefaults sets the Krea 2 family's default size to 1K, versioned, once", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-image-size-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const dir = path.join(dataDir, "workflows");
  fs.mkdirSync(dir);
  const profile = (id, family, width, height) => ({
    studio: {
      id,
      kind: "image",
      family,
      backends: {
        radiance: {
          description: `Default: ${width}×${height}, 8 steps.`,
          defaults: { width, height, steps: 8 },
          graph: { 1: { inputs: { width, height } } },
        },
      },
    },
  });
  const write = (value) =>
    fs.writeFileSync(path.join(dir, `${value.studio.id}.json`), JSON.stringify(value));
  write(profile("kroma", "krea2", 1536, 2048));
  write(profile("wide", "krea2", 2048, 1536));
  write(profile("flux", "flux3", 1536, 2048));
  assert.deepEqual(imageSizeDefaults(dataDir), { applied: false, profiles: ["kroma"] });
  assert.deepEqual(imageSizeDefaults(dataDir, { apply: true }), {
    applied: true,
    profiles: ["kroma"],
  });
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "kroma.json"), "utf8")).studio.backends
    .radiance;
  assert.deepEqual(saved.defaults, { width: 768, height: 1024, steps: 8 });
  assert.equal(saved.description, "Default: 768×1024, 8 steps.");
  // The graph's own inputs are left as they were.
  assert.deepEqual(saved.graph[1].inputs, { width: 1536, height: 2048 });
  assert.equal(createProfileStore({ dataDir }).meta("kroma").version, 1);
  assert.deepEqual(imageSizeDefaults(dataDir, { apply: true }).profiles, []);
});
