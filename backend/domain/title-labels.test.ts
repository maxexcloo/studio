import assert from "node:assert/strict";
import test from "node:test";

import { promptWords, replyTitle, shortTitle, titleCase } from "../../shared/titles.ts";

test("Title Case lowers minor words except first and last and keeps a word's own capitals", () => {
  assert.equal(titleCase("jumping spider On fingertip"), "Jumping Spider on Fingertip");
  assert.equal(titleCase("the lighthouse to look at"), "The Lighthouse to Look At");
  assert.equal(titleCase("NASA crew with an iPhone"), "NASA Crew with an iPhone");
  assert.equal(titleCase("red-tailed hawk"), "Red-Tailed Hawk");
});

test("titles shorten by whole phrases, never mid-phrase", () => {
  assert.equal(replyTitle('Title: "sleeping puppy on a cushion"'), "Sleeping Puppy on a Cushion");
  assert.equal(replyTitle("tiny tree frog on dewy leaf"), "Tiny Tree Frog");
  assert.equal(replyTitle("red barn by the river beneath storm clouds"), "Red Barn by the River");
  // A noun phrase without a break keeps its last words, where the noun is.
  assert.equal(
    replyTitle("tiny sleeping Maltese Shih Tzu puppy"),
    "Sleeping Maltese Shih Tzu Puppy",
  );
  assert.equal(shortTitle("hair blowing in the wind", 4), "Hair Blowing");
  assert.equal(replyTitle(""), "");
});

test("prompt titles remove request wording, weights and tags", () => {
  assert.equal(
    promptWords("Generate images of a tiny sleeping Maltese Shih Tzu puppy, warm light"),
    "Sleeping Maltese Shih Tzu Puppy",
  );
  assert.equal(
    promptWords("a (sleeping puppy:1.2) on a cushion, <lora:soft:1>"),
    "Sleeping Puppy on a Cushion",
  );
  assert.equal(promptWords("Generate images of a tiny tree frog on a dewy leaf"), "Tiny Tree Frog");
  assert.equal(promptWords(undefined), "");
});
