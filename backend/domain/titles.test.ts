import assert from "node:assert/strict";
import test from "node:test";
import { createTitler, type TitleItem } from "./titles.ts";

const item = (id: string, extra: Partial<TitleItem> = {}): TitleItem => ({
  id,
  url: `/media/${id}.png`,
  type: "image",
  status: "done",
  ownerId: "alice",
  prompt: `a red barn ${id}, golden hour`,
  ...extra,
});

/** A titler over fakes: no model is called. */
function fixture(items: TitleItem[]) {
  const state = { items, idle: true, sent: [] as string[] };
  const titler = createTitler({
    writer: {
      title: async ({ prompt }) => {
        state.sent.push(prompt);
        return { title: `Title of ${prompt.split(" ")[3]}` };
      },
    },
    idle: () => state.idle,
    allowed: (ownerId) => ownerId === "alice",
    items: () => state.items,
    visible: () => true,
    save: (target, title) => {
      state.items = state.items.map((entry) => (entry === target ? { ...entry, title } : entry));
    },
    log: { info: () => {} },
  });
  return { state, titler };
}

test("new results are titled as they complete, without waiting for Studio to be idle", async () => {
  const { state, titler } = fixture([item("new"), item("bob", { ownerId: "bob" })]);
  state.idle = false;
  await titler.completed(state.items);
  assert.deepEqual(
    state.items.map((entry) => entry.title),
    ["Title of new,", undefined],
    "the account without the prompt assistant is never titled",
  );
});

test("the rest are backfilled while idle, newest first and flat out, skipping titled and promptless items", async () => {
  const { state, titler } = fixture([
    item("a"),
    item("titled", { title: "Kept" }),
    item("bare", { prompt: "" }),
    item("video", { type: "video" }),
    item("running", { status: "running" }),
  ]);
  state.idle = false;
  assert.equal(await titler.tick(), "busy");
  state.idle = true;
  assert.equal(await titler.tick(), "done");
  await titler.settled();
  assert.equal(await titler.tick(), "none");
  assert.deepEqual(
    state.items.map((entry) => entry.title),
    ["Title of a,", "Kept", undefined, "Title of video,", undefined],
  );
  assert.equal(state.sent.length, 2);
});
