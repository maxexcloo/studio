import assert from "node:assert/strict";
import test from "node:test";
import { lineDiff } from "../src/app/lineDiff.js";

test("a changed line shows as a removal then an addition, with context and folded runs", () => {
  const before = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n");
  const after = before.replace("line 10", "line ten");
  const diff = lineDiff(before, after, { context: 2 });
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 1);
  assert.deepEqual(diff.lines.map((line) => line.type), ["skip", "same", "same", "remove", "add", "same", "same", "skip"]);
  assert.equal(diff.lines[0].count, 7);
  assert.deepEqual(diff.lines.slice(3, 5).map((line) => [line.text, line.oldLine, line.newLine]), [["line 10", 10, 0], ["line ten", 0, 10]]);
});

test("insertions and deletions keep their line numbers, and equal texts have no changes", () => {
  const diff = lineDiff("a\nb\nc\n", "a\nx\nb\nc", { context: 5 });
  assert.deepEqual(diff.lines.map((line) => [line.type, line.text]), [["same", "a"], ["add", "x"], ["same", "b"], ["same", "c"]]);
  assert.equal(lineDiff("same\n", "same").added, 0);
  assert.deepEqual(lineDiff("a\nb", "a").lines.map((line) => line.type), ["same", "remove"]);
});
