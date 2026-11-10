import assert from "node:assert/strict";
import test from "node:test";
import { withCharacter, withoutCharacter } from "../shared/characters.ts";

test("a character's description joins a prompt once, and removing it restores the prompt", () => {
  const description = "red-haired ranger, green cloak";
  for (const [prompt, joined] of [
    ["", description],
    ["A misty forest", `A misty forest, ${description}`],
    ["A misty forest.", `A misty forest. ${description}`],
  ]) {
    assert.equal(withCharacter(prompt, description), joined);
    assert.equal(withCharacter(joined, description), joined);
    assert.equal(withoutCharacter(joined, description), prompt);
  }
  // Text typed after it stays.
  assert.equal(
    withoutCharacter(`A misty forest, ${description}, at dawn`, description),
    "A misty forest, at dawn",
  );
  assert.equal(withoutCharacter(`${description}. At dawn`, description), "At dawn");
});
