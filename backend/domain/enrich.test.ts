import assert from "node:assert/strict";
import test from "node:test";

import { captionVersion } from "./captions.ts";
import { type EnrichItem, type Enriched, createEnricher } from "./enrich.ts";

/** A task's idle work that wants the items `wants` names, recording what it still holds. */
const task = (wants: (item: EnrichItem) => boolean, held: Set<string>) => ({
  async take(items: EnrichItem[]) {
    const taken = items.filter(wants);
    for (const item of taken) held.add(String(item.id));
    return {
      items: taken,
      release: () => taken.forEach((item) => held.delete(String(item.id))),
    };
  },
});

function enricher({ caption = true, title = true, brief = "", describe = false, titled = "" }) {
  const asked: Record<string, unknown>[] = [];
  const saved: [string, Enriched][] = [];
  const held = new Set<string>();
  const work = createEnricher<EnrichItem>({
    writer: {
      enrich: async (request) => {
        asked.push(request);
        return {
          model: "vision",
          ...(request.caption ? { caption: { text: "A barn.", tags: ["barn"] } } : {}),
          ...(request.title ? { title: "Red Barn" } : {}),
          ...(request.brief ? { review: { score: 3, miss: "no sea" } } : {}),
        };
      },
    },
    captions: task(() => caption, held),
    titles: task(() => title, held),
    reviews: { ...task(() => Boolean(brief), held), brief: () => brief },
    prompts: task(() => describe, held),
    titled: () => titled || undefined,
    explicit: () => false,
    text: () => ({ side: "cloud", uncensored: false }),
    image: async () => ({ mime: "image/jpeg", data: "" }),
    save: (item, enriched) => saved.push([String(item.id), enriched]),
    now: () => 0,
  });
  return { work, asked, saved, held };
}
const item: EnrichItem = { id: "barn", type: "image", status: "done", prompt: "A red barn" };

test("a finished image is read once for its caption, title and review, each saved as the gallery keeps it", async () => {
  const { work, asked, saved, held } = enricher({ brief: "Subjects: the sea" });
  const done = await work.completed([item]);
  assert.equal(asked.length, 1);
  assert.deepEqual(
    [asked[0].caption, asked[0].title, asked[0].brief, asked[0].describe],
    [true, true, "Subjects: the sea", false],
  );
  const caption = {
    text: "A barn.",
    tags: ["barn"],
    model: "vision",
    at: new Date(0).toISOString(),
    version: captionVersion(),
  };
  assert.equal(saved.length, 1);
  const [[id, { review, ...rest }]] = saved;
  assert.equal(id, "barn");
  assert.deepEqual(rest, { caption, title: "Red Barn" });
  assert.deepEqual(
    [review?.score, review?.miss, review?.model, review?.at],
    [3, "no sea", "vision", caption.at],
  );
  assert.match(String(review?.brief), /^[0-9a-f]{12}$/);
  assert.equal(done.get(item)?.title, "Red Barn");
  assert.equal(held.size, 0, "every task's claim is released");
});

test("a title alone needs no read, and a sibling's title is taken without asking", async () => {
  const alone = enricher({ caption: false });
  assert.deepEqual((await alone.work.completed([item])).get(item), {});
  assert.equal(alone.asked.length, 0);
  assert.deepEqual(alone.saved, []);

  const sibling = enricher({ titled: "Old Barn" });
  await sibling.work.completed([item]);
  assert.equal(sibling.asked[0].title, false);
  assert.equal(sibling.saved[0][1].title, "Old Barn");
});

test("the caption work's read fails without a caption, leaving the item to retry", async () => {
  const { work } = enricher({});
  await work.caption(item, new AbortController().signal);
  const failing = createEnricher<EnrichItem>({
    writer: { enrich: async () => ({ model: "vision", title: "Red Barn" }) },
    captions: task(() => true, new Set()),
    titles: task(() => true, new Set()),
    reviews: { ...task(() => false, new Set()), brief: () => "" },
    prompts: task(() => false, new Set()),
    titled: () => undefined,
    explicit: () => false,
    text: () => ({ side: "cloud", uncensored: false }),
    image: async () => ({ mime: "image/jpeg", data: "" }),
    save: () => {},
  });
  await assert.rejects(failing.caption(item, new AbortController().signal), /unusable reply/);
});
