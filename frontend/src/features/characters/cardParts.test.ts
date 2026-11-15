import assert from "node:assert/strict";
import test from "node:test";

import { characterLead, outfitPart, scenePart } from "../../../../shared/characters.ts";
import {
  forgetCard,
  promptCardApplied,
  rememberCard,
  removeCard,
  removeCharacter,
  withPromptCard,
} from "./cardParts.ts";

test("editing a saved outfit leaves the draft intact until reapplying it replaces its old text", () => {
  const outfit = {
    id: "out-raincoat",
    name: "Raincoat",
    description: "a yellow raincoat",
    references: [],
  };
  const character = characterLead("red hair");
  const initial = `${character} ${outfitPart(outfit.description)} ${scenePart("A bus stop", true)}`;
  const characterParts = rememberCard(
    undefined,
    "characters",
    { id: "chr-ranger", description: "red hair" },
    "",
    character,
  );
  const parts = rememberCard(characterParts, "outfits", outfit, character, initial);
  const edited = { ...outfit, description: "a red raincoat" };
  assert.equal(parts![outfit.id].text, outfitPart("a yellow raincoat"));
  const next = withPromptCard("outfits", edited, initial, parts);
  assert.equal(
    next,
    `${character} ${outfitPart(edited.description)} ${scenePart("A bus stop", true)}`,
  );
  const remembered = rememberCard(parts, "outfits", edited, initial, next);
  assert.equal(remembered![outfit.id].text, outfitPart(edited.description));
  assert.deepEqual(forgetCard(remembered, edited.id), characterParts);
});

test("applying an outfit preserves manually written text matching another saved outfit", () => {
  const yellow = {
    id: "out-yellow",
    name: "Yellow",
    description: "a yellow raincoat",
    references: [],
  };
  const red = { ...yellow, id: "out-red", name: "Red", description: "a red raincoat" };
  const typed = `${outfitPart(yellow.description)} At a bus stop.`;
  assert.equal(
    promptCardApplied("outfits", yellow, typed),
    undefined,
    "matching text alone does not select a card",
  );
  assert.equal(withPromptCard("outfits", red, typed), `${outfitPart(red.description)} ${typed}`);
});

test("an edited scene replaces its saved contribution while a manually rewritten contribution is preserved", () => {
  const scene = {
    id: "scn-harbour",
    name: "Harbour",
    description: "A quiet harbour",
    references: [],
  };
  const initial = scenePart(scene.description);
  const parts = rememberCard(undefined, "scenes", scene, "", initial);
  const edited = { ...scene, description: "A busy harbour" };
  assert.equal(withPromptCard("scenes", edited, initial, parts), scenePart(edited.description));
  assert.equal(
    withPromptCard("scenes", edited, "A hand-written setting.", parts),
    `${scenePart(edited.description)} A hand-written setting.`,
  );
});

test("applying a card to existing text never makes removal or a later edit own that text", () => {
  for (const kind of ["outfits", "scenes"] as const) {
    const card = { id: `${kind}-one`, name: "One", description: "a quiet harbour", references: [] };
    const typed = kind === "outfits" ? outfitPart(card.description) : scenePart(card.description);
    const next = withPromptCard(kind, card, typed);
    assert.equal(next, typed);
    const parts = rememberCard(undefined, kind, card, typed, next);
    assert.equal(parts![card.id].ownsText, false);
    assert.ok(promptCardApplied(kind, card, next, parts));
    assert.equal(
      promptCardApplied(kind, { ...card, id: "a-different-card" }, next, parts),
      undefined,
    );
    assert.equal(removeCard(card.id, next, parts).prompt, typed);
    const edited = { ...card, description: "a busy harbour" };
    assert.equal(promptCardApplied(kind, edited, next, parts), undefined);
    const replaced = withPromptCard(kind, edited, next, parts);
    assert.ok(replaced.includes(typed));
    const recorded = rememberCard(parts, kind, edited, next, replaced);
    assert.equal(removeCard(card.id, replaced, recorded).prompt, typed);
  }
});

test("removing an edited character removes its old recorded text and images, preserving the current description and other references", () => {
  const asset = (id: string) => ({ id, name: id, thumbnailUrl: "", width: 64, height: 64 });
  const original = {
    id: "chr-ranger",
    description: "red hair",
    references: [asset("old-reference")],
  };
  const before = characterLead(original.description);
  const parts = rememberCard(undefined, "characters", original, "", before);
  const edited = { ...original, description: "black hair", references: [asset("new-reference")] };
  const typed = `${before} ${characterLead(edited.description)} At a bus stop.`;
  const references = [asset("old-reference"), asset("new-reference"), asset("unrelated-reference")];
  const removed = removeCharacter(edited, references, typed, parts);
  assert.equal(removed.prompt, `${characterLead(edited.description)} At a bus stop.`);
  assert.deepEqual(
    removed.references.map((asset) => asset.id),
    ["new-reference", "unrelated-reference"],
  );
  assert.deepEqual(removed.cardParts, {});
  assert.deepEqual(removeCharacter(edited, references, typed, undefined), {
    prompt: typed,
    references,
    cardParts: {},
  });
});
