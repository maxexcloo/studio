import assert from "node:assert/strict";
import test from "node:test";

import { characterLead, outfitPart, scenePart } from "../../../../shared/characters.ts";
import { forgetCard, rememberCard, withPromptCard } from "./cardParts.ts";

test("editing a saved outfit leaves the draft intact until reapplying it replaces its old text", () => {
  const outfit = {
    id: "out-raincoat",
    name: "Raincoat",
    description: "a yellow raincoat",
    references: [],
  };
  const character = characterLead("red hair");
  const initial = `${character} ${outfitPart(outfit.description)} ${scenePart("A bus stop", true)}`;
  const parts = rememberCard(undefined, "outfits", outfit, initial);
  const edited = { ...outfit, description: "a red raincoat" };
  assert.equal(parts![outfit.id].text, outfitPart("a yellow raincoat"));
  const next = withPromptCard("outfits", edited, initial, {
    cards: [edited],
    parts,
    characters: [{ description: "red hair" }],
  });
  assert.equal(
    next,
    `${character} ${outfitPart(edited.description)} ${scenePart("A bus stop", true)}`,
  );
  const remembered = rememberCard(parts, "outfits", edited, next);
  assert.equal(remembered![outfit.id].text, outfitPart(edited.description));
  assert.deepEqual(forgetCard(remembered, edited.id), {});
});

test("an edited scene replaces its saved contribution while a manually rewritten contribution is preserved", () => {
  const scene = {
    id: "scn-harbour",
    name: "Harbour",
    description: "A quiet harbour",
    references: [],
  };
  const initial = scenePart(scene.description);
  const parts = rememberCard(undefined, "scenes", scene, initial);
  const edited = { ...scene, description: "A busy harbour" };
  assert.equal(
    withPromptCard("scenes", edited, initial, { cards: [edited], parts }),
    scenePart(edited.description),
  );
  assert.equal(
    withPromptCard("scenes", edited, "A hand-written setting.", { cards: [edited], parts }),
    `${scenePart(edited.description)} A hand-written setting.`,
  );
});
