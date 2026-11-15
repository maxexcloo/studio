import assert from "node:assert/strict";
import test from "node:test";

import { promptWords, replyTitle } from "../../shared/titles.ts";

test("automatic titles use short Title Case content labels", () => {
  assert.equal(replyTitle('Title: "sleeping puppy on a cushion"'), "Sleeping Puppy on a Cushion");
  assert.equal(
    replyTitle("sleeping Maltese Shih Tzu puppy near the window"),
    "Sleeping Maltese Shih Tzu Puppy",
  );
  assert.equal(replyTitle("a study of NASA astronauts"), "A Study of NASA Astronauts");
  assert.equal(replyTitle(""), "");
});

test("prompt labels remove request boilerplate, weights and tags before shortening", () => {
  assert.equal(
    promptWords("Generate images of a tiny sleeping Maltese Shih Tzu puppy, warm light"),
    "Tiny Sleeping Maltese Shih Tzu",
  );
  assert.equal(
    promptWords("a (sleeping puppy:1.2) on a cushion, <lora:soft:1>"),
    "Sleeping Puppy on a Cushion",
  );
  assert.equal(
    promptWords("a red barn by the river beneath storm clouds"),
    "Red Barn by the River",
  );
  assert.equal(promptWords(undefined), "");
});
