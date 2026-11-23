import assert from "node:assert/strict";
import test from "node:test";

import {
  cooledMotifs,
  forbiddenMotifs,
  freshConceptProblem,
  mentionsMotif,
  namedMotif,
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

test("A prompt names an excluded motif even after 'no', and aliases catch rewordings", () => {
  assert.equal(namedMotif("A quiet balcony, no smoking allowed", ["smoking"]), "smoking");
  assert.ok(mentionsMotif("Her damp hair clings to her neck", "wet"));
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
