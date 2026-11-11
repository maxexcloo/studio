import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.STUDIO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "studio-data-"));
const { validateWorkflow } = await import("./workflow-catalogue.js");

const save = { class_type: "SaveImage", inputs: { filename_prefix: "studio" } };

test("a reference mapped in a mode's graph is found there", () => {
  const { issues, warnings } = validateWorkflow({
    kind: "image",
    graph: { 1: { class_type: "KSampler", inputs: { seed: 1 } }, 9: save },
    imageModes: {
      reference: {
        graph: { 3: { class_type: "LoadImage", inputs: { image: "", strength: 1 } }, 9: save },
      },
    },
    mediaInputs: [
      {
        id: "image",
        min: 1,
        max: 1,
        control: { node: "3", input: "image" },
        strength: { node: "3", input: "strength" },
      },
    ],
  });
  assert.deepEqual(issues, []);
  assert.deepEqual(warnings, []);
});

test("a Grok profile's single cloud node needs no Save Image", () => {
  const { warnings } = validateWorkflow({
    kind: "image",
    graph: { 1: { class_type: "GrokMedia", inputs: { prompt: "", model: "grok" } } },
  });
  assert.deepEqual(warnings, []);
});
