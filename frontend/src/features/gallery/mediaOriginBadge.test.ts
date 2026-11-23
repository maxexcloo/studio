import assert from "node:assert/strict";
import test from "node:test";

import type { DreamItem } from "../dream/queries";
import { mediaOriginBadge } from "./mediaOriginBadge.ts";

const item: DreamItem = { id: "item", type: "image", status: "done", url: "/item.png" };
const dream = { state: "kept", prompt: "", why: "", at: "" } as const;

test("gallery badges use saved provenance and favour comparisons over their source", () => {
  const badge = (fields: Partial<DreamItem>, inComparison = false) =>
    mediaOriginBadge({ ...item, ...fields }, inComparison)?.label;

  assert.equal(badge({}), undefined);
  assert.equal(badge({ parentItemId: "source" }), "From Edit or Recreate");
  assert.equal(badge({ uploaded: true }), "From Upload");
  assert.equal(
    badge({ uploaded: true, source: { url: "/original", title: "Original" } }),
    "From Import",
  );
  assert.equal(badge({ chat: { conversationId: "conversation" } }), "From Chat");
  assert.equal(badge({ dream }), "From Dream");
  assert.equal(badge({ dream: { ...dream, projectId: "project" } }), "From Project");
  assert.equal(
    badge({ dream: { ...dream, arm: "extend" }, type: "video" }),
    "From Video Extension",
  );
  assert.equal(
    badge({ dream: { ...dream, arm: "recreate" }, type: "video" }),
    "From Video Remaster",
  );
  assert.equal(badge({ dream }, true), "In Comparison");
  assert.equal(
    badge({ dream: { ...dream, pair: { id: "pair", side: 0, question: "", label: "" } } }),
    "In Comparison",
  );
});
