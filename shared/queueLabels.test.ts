import assert from "node:assert/strict";
import test from "node:test";

import { comparisonTitle, isComparisonSet } from "./compare.ts";
import { cleanQueuePrompt, queueJobTitle, queueSetTitle } from "./queueLabels.ts";

test("cleanQueuePrompt strips technical video prompt wrappers", () => {
  assert.equal(
    cleanQueuePrompt(
      "integrated_multimodal_description: [Shot 1] Live-action, handheld tracking shot",
    ),
    "handheld tracking shot",
  );
  assert.equal(cleanQueuePrompt("A lighthouse in fog"), "A lighthouse in fog");
});

test("queueJobTitle names actions clearly when prompts are empty or being written", () => {
  assert.equal(
    queueJobTitle({
      operation: "animate",
      input: { kind: "video", prompt: "", writing: { kind: "animate", theme: "slow-motion" } },
    }),
    "Animate · Slow Motion",
  );
  assert.equal(
    queueJobTitle({
      operation: "animate",
      input: {
        kind: "video",
        prompt: "",
        writing: { kind: "animate", extend: true, theme: "custom" },
      },
    }),
    "Extend Video",
  );
  assert.equal(
    queueJobTitle({
      operation: "image",
      input: { kind: "image", prompt: "", writing: { kind: "set", scope: "image" } },
    }),
    "More Like This Image",
  );
  assert.equal(
    queueJobTitle({
      operation: "image",
      dream: true,
      input: { kind: "video", prompt: "", writing: { kind: "dream" } },
    }),
    "Dream Video",
  );
});

test("queueSetTitle names Dream groups, comparisons, and More Like This sets clearly", () => {
  assert.equal(
    queueSetTitle([
      { dream: true, input: { kind: "image", prompt: "A" } },
      { dream: true, input: { kind: "video", prompt: "B" } },
    ]),
    "Dream · Images & Videos",
  );
  assert.equal(
    queueSetTitle([{ dream: true, input: { kind: "video", prompt: "A" } }]),
    "Dream · Videos",
  );
  assert.equal(
    queueSetTitle([
      { input: { prompt: "A red barn at dusk", resultSet: { title: "Comparison" } } },
    ]),
    "Compare: Red Barn at Dusk",
  );
  assert.equal(
    queueSetTitle([{ input: { prompt: "", writing: { kind: "set", scope: "image" } } }]),
    "More Like This Image",
  );
});

test("comparisonTitle builds descriptive set titles recognised by isComparisonSet", () => {
  const titled = comparisonTitle("A copper bird at dusk", "Steps");
  assert.equal(titled, "Compare Steps: Copper Bird at Dusk");
  assert.equal(isComparisonSet({ title: titled }), true);
  assert.equal(isComparisonSet({ title: "Comparison" }), true);
  assert.equal(isComparisonSet({ title: "Fox Studies" }), false);
});
