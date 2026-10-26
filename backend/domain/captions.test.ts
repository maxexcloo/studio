import assert from "node:assert/strict";
import test from "node:test";
import {
  createCaptioner,
  dailyCaptions,
  type Caption,
  type CaptionItem,
  type CaptionWriter,
} from "./captions.ts";

const image = (id: string, ownerId = "alice", extra: Partial<CaptionItem> = {}): CaptionItem => ({
  id,
  url: `/media/${id}.png`,
  type: "image",
  status: "done",
  ownerId,
  ...extra,
});

/** A captioner over fakes: no model is called and no image is read. */
function fixture(items: CaptionItem[]) {
  const state = {
    clock: Date.parse("2026-10-26T09:00:00Z"),
    items,
    enabled: true,
    idle: true,
    vision: true,
    allowed: new Set(["alice", "bob"]),
    sent: [] as string[],
    fail: new Set<string>(),
    logs: [] as string[],
    /** Holds the next caption reply open until released. */
    hold: null as null | (() => void),
  };
  const writer: CaptionWriter = {
    settings: () => ({ model: "vision-model" }),
    supportsVision: async () => state.vision,
    caption: async ({ image: picture, signal }) => {
      state.sent.push(picture.data);
      if (state.fail.has(picture.data)) throw new Error("HTTP 500");
      if (state.hold)
        await new Promise<void>((resolve, reject) => {
          state.hold = resolve;
          signal?.addEventListener("abort", () => reject(new Error("cancelled")));
        });
      return { text: `a picture of ${picture.data}`, model: "vision-model" };
    },
  };
  const captioner = createCaptioner({
    enabled: () => state.enabled,
    writer,
    idle: () => state.idle,
    allowed: (ownerId) => state.allowed.has(ownerId),
    items: () => state.items,
    visible: (item) => !(item as { hidden?: boolean }).hidden,
    image: async (item) => ({ mime: "image/jpeg", data: item.id || "" }),
    save: (item, caption: Caption) => {
      state.items = state.items.map((entry) => (entry === item ? { ...entry, caption } : entry));
    },
    now: () => state.clock,
    log: { info: (message) => state.logs.push(message) },
  });
  const later = () => (state.clock += 10_000);
  return { state, captioner, later };
}

test("captions the newest uncaptioned image, one at a time and at most one every 10 s", async () => {
  const { state, captioner, later } = fixture([
    image("new"),
    image("video", "alice", { type: "video" }),
    image("running", "alice", { status: "running" }),
    image("library", "alice", { library: true }),
    image("hidden", "alice", { hidden: true } as Partial<CaptionItem>),
    image("old"),
  ]);
  assert.equal(await captioner.tick(), "captioned");
  assert.deepEqual(state.items[0].caption, {
    text: "a picture of new",
    model: "vision-model",
    at: "2026-10-26T09:00:00.000Z",
  });
  assert.deepEqual(
    Object.keys(state.items[0]).sort(),
    ["caption", "id", "ownerId", "status", "type", "url"],
    "nothing else on the record changes",
  );
  assert.equal(await captioner.tick(), "spaced");
  later();
  assert.equal(await captioner.tick(), "captioned");
  later();
  assert.equal(await captioner.tick(), "none");
  assert.deepEqual(state.sent, ["new", "old"]);
});

test("waits while work runs and yields the moment work appears", async () => {
  const { state, captioner, later } = fixture([image("a"), image("b")]);
  const captionOf = (index: number) => state.items[index].caption;
  state.idle = false;
  assert.equal(await captioner.tick(), "busy");
  assert.deepEqual(state.sent, []);

  state.idle = true;
  state.hold = () => undefined;
  const running = captioner.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await captioner.tick(), "busy", "one caption at a time");
  captioner.interrupt();
  assert.equal(await running, "yielded");
  assert.equal(captionOf(0), undefined, "a yielded image is tried again later");

  state.hold = null;
  later();
  assert.equal(await captioner.tick(), "captioned");
  assert.equal(captionOf(0)?.text, "a picture of a");
});

test("text work that starts mid-caption makes it step aside within a second", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { state, captioner } = fixture([image("a")]);
  state.hold = () => undefined;
  const running = captioner.tick();
  await new Promise((resolve) => setImmediate(resolve));
  state.idle = false;
  t.mock.timers.tick(1000);
  assert.equal(await running, "yielded");
  assert.equal(state.items[0].caption, undefined);
});

test("skips text-only models (saying so once), the switch off and accounts without the assistant", async () => {
  const { state, captioner, later } = fixture([image("bob-1", "bob"), image("alice-1")]);
  state.vision = false;
  assert.equal(await captioner.tick(), "text-only");
  later();
  assert.equal(await captioner.tick(), "text-only");
  assert.equal(state.logs.length, 1);
  assert.match(state.logs[0], /vision-model can't read images/);

  state.vision = true;
  state.enabled = false;
  later();
  assert.equal(await captioner.tick(), "off");

  state.enabled = true;
  state.allowed.delete("bob");
  later();
  assert.equal(await captioner.tick(), "captioned");
  later();
  assert.equal(await captioner.tick(), "none");
  assert.deepEqual(state.sent, ["alice-1"], "bob's image never reaches the model");
  assert.equal(state.items[0].caption, undefined);
});

test("stops at the daily cap, counted from stored captions, and starts again the next day", async () => {
  const today = { text: "earlier", model: "vision-model", at: "2026-10-26T08:00:00.000Z" };
  const { state, captioner, later } = fixture([
    image("waiting"),
    ...Array.from({ length: dailyCaptions }, (_, index) =>
      image(`done-${index}`, "alice", { caption: today }),
    ),
  ]);
  assert.equal(await captioner.tick(), "capped");
  state.clock += 24 * 60 * 60_000;
  later();
  assert.equal(await captioner.tick(), "captioned");
});

test("an image that fails is skipped instead of retried in a loop", async () => {
  const { state, captioner, later } = fixture([image("broken"), image("fine")]);
  state.fail.add("broken");
  assert.equal(await captioner.tick(), "failed");
  later();
  assert.equal(await captioner.tick(), "captioned");
  assert.equal(state.items[1].caption?.text, "a picture of fine");
  later();
  assert.equal(await captioner.tick(), "none");
});
