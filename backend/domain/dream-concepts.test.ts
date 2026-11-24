import assert from "node:assert/strict";
import test from "node:test";

import {
  boilerplate,
  cooledMotifs,
  forbiddenMotifs,
  freshConceptProblem,
  namedMotif,
  promptBody,
} from "./dream-concepts.ts";

test("Avoids keep phrases whole and split lists only at punctuation or 'or'", () => {
  const forbidden = forbiddenMotifs(["black and white photos", "hats or scarves; neon"], []);
  assert.deepEqual(forbidden, ["black and white photos", "hats", "scarves", "neon"]);
  assert.equal(namedMotif("A black cat on a white rug", forbidden), undefined);
  assert.equal(
    namedMotif("Black and white photos pinned to a wall", forbidden),
    "black and white photos",
  );
});

test("Conditional rules exclude only where nothing can lift them", () => {
  const rules = ["No smoking unless I ask", "Avoid lightning while indoors"];
  assert.deepEqual(forbiddenMotifs([], rules), []);
  assert.deepEqual(forbiddenMotifs([], rules, true), ["smoking"]);
});

test("A prompt names an excluded motif even after 'no'", () => {
  assert.equal(namedMotif("A quiet balcony, no smoking allowed", ["smoking"]), "smoking");
});

test("Motifs of ideas passed as too similar pause unless the brief shows them", () => {
  const record = { motifs: [], recent: [] };
  assert.deepEqual(cooledMotifs(record, "", [], ["paper lantern", "harbor"]), [
    "paper lantern",
    "harbor",
  ]);
  assert.deepEqual(cooledMotifs(record, "Include a paper lantern.", [], ["paper lantern"]), []);
});

test("Novelty ignores the fixed brief that every prompt repeats", () => {
  const fixed =
    "rib-knit sweater a size too small, soft window light, 35mm film grain, muted pastel palette, shallow depth of field, candid documentary photograph";
  const recent = [`A woman tends a rooftop beehive at dawn, ${fixed}`];
  const fresh = `A cyclist fixes a chain beside a canal, ${fixed}`;
  assert.match(freshConceptProblem(recent, recent, [])(fresh, "", [], []), /too close/);
  assert.equal(freshConceptProblem(recent, recent, [], fixed)(fresh, "", [], []), "");
});

test("A shared style clause is no part of an idea's likeness", () => {
  const style =
    "A real, unretouched photograph with coarse 35mm grain, flat JPEG colour, harsh direct flash, crooked framing, blown highlights and a cheap compact camera look.";
  const recent = [
    `${style} A woman tends a rooftop beehive at dawn.`,
    `${style} A cyclist fixes a chain beside a canal.`,
    `${style} Two chess players argue in a park.`,
    `${style} A baker shapes loaves before sunrise.`,
  ];
  const common = boilerplate(recent);
  assert.equal(promptBody(recent[0], common), "A woman tends a rooftop beehive at dawn.");
  assert.equal(promptBody("Just one sentence.", common), "Just one sentence.");
  const fresh = `${style} A diver films a reef shark at noon.`;
  assert.match(freshConceptProblem([], recent, [])(fresh, "", [], []), /too close/);
  assert.equal(freshConceptProblem(recent, recent, [])(fresh, "", [], []), "");
});

test("Words recurring across motif labels cool, as whole labels do", () => {
  const motifs = [["amber glow"], ["amber lamp"], ["amber dress"], ["window light"], ["red light"]];
  const cooled = cooledMotifs({ motifs });
  assert.ok(cooled.includes("amber"));
  assert.ok(!cooled.includes("light"));
});
