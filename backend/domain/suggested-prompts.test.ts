import assert from "node:assert/strict";
import test from "node:test";
import { createPromptSuggester, type SuggestedPromptItem } from "./suggested-prompts.ts";

const item = (id: string, extra: Partial<SuggestedPromptItem> = {}): SuggestedPromptItem => ({
  id,
  url: `/media/${id}`,
  type: "image",
  status: "done",
  ownerId: "alice",
  prompt: "",
  ...extra,
});

/** A suggester over fakes: no model is called. */
function fixture(items: SuggestedPromptItem[], vision: boolean) {
  const state = { items, enabled: true, sent: [] as { images: number; hint: string }[] };
  const suggester = createPromptSuggester({
    enabled: () => state.enabled,
    writer: {
      supportsVision: async () => vision,
      describe: async ({ images, hint }) => {
        state.sent.push({ images: images.length, hint });
        return { available: true, prompt: `A prompt from ${images.length ? "the picture" : hint}` };
      },
    },
    idle: () => true,
    allowed: (ownerId) => ownerId === "alice",
    items: () => state.items,
    visible: () => true,
    image: async () => ({ mime: "image/jpeg", data: "AA==" }),
    save: (target, suggestedPrompt) => {
      state.items = state.items.map((entry) =>
        entry === target ? { ...entry, suggestedPrompt } : entry,
      );
    },
    log: { info: () => {} },
  });
  return { state, suggester };
}

test("a model that reads images suggests prompts for promptless items, kept apart from their prompt", async () => {
  const { state, suggester } = fixture(
    [
      item("upload"),
      item("clip", { type: "video", uploaded: true }),
      item("made", { prompt: "a red barn" }),
      item("done", { suggestedPrompt: "Kept" }),
      item("bob", { ownerId: "bob" }),
    ],
    true,
  );
  while ((await suggester.tick()) === "done");
  await suggester.settled();
  assert.deepEqual(
    state.items.map((entry) => [entry.prompt, entry.suggestedPrompt]),
    [
      ["", "A prompt from the picture"],
      ["", "A prompt from the picture"],
      ["a red barn", undefined],
      ["", "Kept"],
      ["", undefined],
    ],
  );
});

test("without vision the caption is the hint, and an uncaptioned item waits", async () => {
  const { state, suggester } = fixture(
    [item("captioned", { caption: { text: "a dog on a beach" } }), item("bare")],
    false,
  );
  while ((await suggester.tick()) === "done");
  await suggester.settled();
  assert.deepEqual(state.sent, [{ images: 0, hint: "a dog on a beach" }]);
  assert.deepEqual(
    state.items.map((entry) => entry.suggestedPrompt),
    ["A prompt from a dog on a beach", undefined],
  );
});

test("switched off, no prompt is suggested and the model is never asked", async () => {
  const { state, suggester } = fixture([item("upload")], true);
  state.enabled = false;
  assert.equal(await suggester.tick(), "off");
  assert.deepEqual(state.sent, []);
  assert.equal(state.items[0].suggestedPrompt, undefined);
});
