import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { temporaryFolder } from "./fixtures/temporary.js";

process.env.STUDIO_DATA_DIR = temporaryFolder("studio-data-");
const {
  flushWorkflowPreferences,
  loadWorkflowPreferences,
  markWorkflowUsed,
  saveWorkflowPreferences,
  validateWorkflow,
} = await import("./workflow-catalogue.js");
const { userWorkflowsDir } = await import("./custom-workflows.js");

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

test("last use keeps only profiles that still exist", () => {
  fs.mkdirSync(userWorkflowsDir, { recursive: true });
  fs.writeFileSync(
    path.join(userWorkflowsDir, "kept.json"),
    JSON.stringify({ studio: { id: "kept", name: "Kept", kind: "image" }, graph: { 9: save } }),
  );
  saveWorkflowPreferences(
    {
      lastUsed: { "custom:kept": "2026-11-01", "custom:gone": "2026-10-01" },
    },
    { immediate: true },
  );
  markWorkflowUsed("custom:removed");
  flushWorkflowPreferences();
  assert.deepEqual(loadWorkflowPreferences(), { lastUsed: { "custom:kept": "2026-11-01" } });
});
