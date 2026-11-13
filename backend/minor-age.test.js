import assert from "node:assert/strict";
import test from "node:test";
import { minorAge, minorAgeRefusal } from "./minor-age.js";

test("a prompt that states an age under 18 is refused, naming the words", () => {
  for (const [prompt, found] of [
    ["Photo of a 16-year-old girl at the beach", "16-year-old"],
    ["a sixteen year old girl", "sixteen year old"],
    ["Korean woman, 17 years old, Seoul", "17 years old"],
    ["16-17-year-old early bloomer", "16-17-year-old"],
    ["Thai girl 16yo in a café", "16yo"],
    ["girls aged 16–22, varied", "aged 16"],
    ["Age: 15, school uniform", "Age: 15"],
    ["an underage girl", "underage"],
    ["nude teen girl on a bed", "teen"],
    ["Topless schoolgirl in a classroom", "schoolgirl"],
  ])
    assert.equal(minorAge(prompt), found, prompt);
  assert.match(minorAgeRefusal("a 16-year-old girl"), /under 18.*"16-year-old"/);
});

test("adult ages and other numbers pass", () => {
  for (const prompt of [
    "Photograph of a slender 19-year-old Chinese woman",
    "18 year old East Asian girl, 18–22",
    "women aged 18–22 on a city tour",
    "a 21yo Korean woman in Tokyo",
    "Image 2 of the set, page 12, stage 3, 35mm film, f/1.8",
    "A woman doing yoga at 5 yoga mats",
    "teenagers skateboarding in a park at dusk",
    "nude woman, 25, reading in the bath",
    "",
  ])
    assert.equal(minorAge(prompt), "", prompt);
});
