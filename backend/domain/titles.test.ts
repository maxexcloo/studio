import assert from "node:assert/strict";
import test from "node:test";

import { type TitleItem, createTitler } from "./titles.ts";

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
  const state = {
    items,
    idle: true,
    enabled: true,
    sent: [] as string[],
    walks: 0,
    changes: 0,
    now: Date.parse("2026-11-14T00:00:00Z"),
  };
  const titler = createTitler({
    enabled: () => state.enabled,
    writer: {
      title: async ({ prompt }) => {
        state.sent.push(prompt);
        return { title: `Title of ${prompt.split(" ")[3]}` };
      },
    },
    idle: () => state.idle,
    allowed: (ownerId) => ownerId === "alice",
    items: () => {
      state.walks += 1;
      return state.items;
    },
    titled: (target) =>
      state.items.find(
        (other) =>
          other.title && other.prompt === target.prompt && other.ownerId === target.ownerId,
      )?.title,
    changes: () => state.changes,
    visible: () => true,
    save: (target, title) => {
      state.items = state.items.map((entry) => (entry === target ? { ...entry, title } : entry));
    },
    log: { info: () => {} },
    now: () => state.now,
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

test("an idle tick that found nothing reads the gallery again only once it changes", async () => {
  const { state, titler } = fixture([item("titled", { title: "Kept" })]);
  assert.equal(await titler.tick(), "none");
  const walks = state.walks;
  assert.equal(await titler.tick(), "none");
  assert.equal(state.walks, walks);
  // Past the recheck it looks once more, then rests again for the next while.
  state.now += 6 * 60_000;
  assert.equal(await titler.tick(), "none");
  assert.equal(state.walks, walks + 1);
  state.now += 60_000;
  assert.equal(await titler.tick(), "none");
  assert.equal(state.walks, walks + 1);
  state.items = [...state.items, item("new")];
  state.changes += 1;
  assert.equal(await titler.tick(), "done");
});

test("switched off, nothing is titled and the model is never asked", async () => {
  const { state, titler } = fixture([item("a")]);
  state.enabled = false;
  await titler.completed(state.items);
  assert.equal(await titler.tick(), "off");
  assert.deepEqual(state.sent, []);
  assert.equal(state.items[0].title, undefined);
});

test("a result whose owner already titled the same prompt reuses that title without a call", async () => {
  const prompt = "a red barn shared, golden hour";
  const { state, titler } = fixture([
    item("again", { prompt }),
    item("theirs", { prompt, ownerId: "bob", title: "Not Alice's" }),
    item("first", { prompt, title: "Red Barn" }),
  ]);
  await titler.completed([state.items[0]]);
  assert.equal(state.items[0].title, "Red Barn");
  assert.deepEqual(state.sent, []);
});
