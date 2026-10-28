import assert from "node:assert/strict";
import test from "node:test";
import {
  captionVersion,
  createCaptioner,
  type Caption,
  type CaptionItem,
  type CaptionWriter,
} from "./captions.ts";
import { dailyItems, passConcurrency, type IdleDocument } from "./idle-work.ts";

const image = (id: string, ownerId = "alice", extra: Partial<CaptionItem> = {}): CaptionItem => ({
  id,
  url: `/media/${id}.png`,
  type: "image",
  status: "done",
  ownerId,
  ...extra,
});
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A captioner over fakes: no model is called and no image is read. */
function fixture(items: CaptionItem[], saved: IdleDocument | null = null) {
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
    saved,
    /** While set, replies wait until `release()`; `open` counts calls in flight. */
    hold: false,
    waiting: [] as (() => void)[],
    open: 0,
    most: 0,
  };
  const release = () => state.waiting.splice(0).forEach((resolve) => resolve());
  const writer: CaptionWriter = {
    supportsVision: async () => state.vision,
    caption: async ({ image: picture, signal }) => {
      state.sent.push(picture.data);
      state.most = Math.max(state.most, ++state.open);
      try {
        if (state.fail.has(picture.data)) throw new Error("HTTP 500");
        if (state.hold)
          await new Promise<void>((resolve, reject) => {
            state.waiting.push(resolve);
            signal?.addEventListener("abort", () => reject(new Error("cancelled")));
          });
        return { text: `a picture of ${picture.data}`, tags: ["picture"], model: "vision-model" };
      } finally {
        state.open -= 1;
      }
    },
  };
  const make = () =>
    createCaptioner({
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
      load: () => structuredClone(state.saved),
      persist: (document) => (state.saved = structuredClone(document)),
      now: () => state.clock,
      log: { info: (message) => state.logs.push(message) },
    });
  const later = () => (state.clock += 10_000);
  return { state, captioner: make(), make, later, release };
}
const old = { text: "earlier", model: "vision-model", at: "2026-10-01T08:00:00.000Z" };

test("captions the newest uncaptioned image, one at a time and at most one every 10 s", async () => {
  const { state, captioner, later } = fixture([
    image("new"),
    image("video", "alice", { type: "video" }),
    image("running", "alice", { status: "running" }),
    image("hidden", "alice", { hidden: true } as Partial<CaptionItem>),
    image("captioned", "alice", { caption: old }),
    image("old"),
  ]);
  assert.equal(await captioner.tick(), "done");
  assert.deepEqual(state.items[0].caption, {
    text: "a picture of new",
    tags: ["picture"],
    model: "vision-model",
    at: "2026-10-26T09:00:00.000Z",
    version: captionVersion,
  });
  assert.deepEqual(
    Object.keys(state.items[0]).sort(),
    ["caption", "id", "ownerId", "status", "type", "url"],
    "nothing else on the record changes",
  );
  assert.equal(await captioner.tick(), "spaced");
  later();
  assert.equal(await captioner.tick(), "done");
  later();
  assert.equal(await captioner.tick(), "none", "outside a pass, older captions stay");
  assert.deepEqual(state.sent, ["new", "old"]);
});

test("waits while work runs and yields the moment work appears", async () => {
  const { state, captioner, later } = fixture([image("a"), image("b")]);
  const captionOf = (index: number) => state.items[index].caption;
  state.idle = false;
  assert.equal(await captioner.tick(), "busy");
  assert.deepEqual(state.sent, []);

  state.idle = true;
  state.hold = true;
  const running = captioner.tick();
  await settle();
  assert.equal(await captioner.tick(), "busy", "one caption at a time");
  captioner.interrupt();
  assert.equal(await running, "yielded");
  assert.equal(captionOf(0), undefined, "a yielded image is tried again later");

  state.hold = false;
  later();
  assert.equal(await captioner.tick(), "done");
  assert.equal(captionOf(0)?.text, "a picture of a");
});

test("text work that starts mid-caption makes it step aside within a second", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { state, captioner } = fixture([image("a")]);
  state.hold = true;
  const running = captioner.tick();
  await settle();
  state.idle = false;
  t.mock.timers.tick(1000);
  assert.equal(await running, "yielded");
  assert.equal(state.items[0].caption, undefined);
});

test("skips text-only models (saying so once), the switch off and accounts without the assistant", async () => {
  const { state, captioner, later } = fixture([image("bob-1", "bob"), image("alice-1")]);
  state.vision = false;
  assert.equal(await captioner.tick(), "unavailable");
  later();
  assert.equal(await captioner.tick(), "unavailable");
  assert.equal(state.logs.length, 1);
  assert.match(state.logs[0], /running text model can't read images/);
  assert.deepEqual(
    [(await captioner.status()).state, (await captioner.status()).reason],
    ["unavailable", "The running text model can't read images."],
  );

  state.vision = true;
  state.enabled = false;
  later();
  assert.equal(await captioner.tick(), "off");

  state.enabled = true;
  state.allowed.delete("bob");
  later();
  assert.equal(await captioner.tick(), "done");
  later();
  assert.equal(await captioner.tick(), "none");
  assert.deepEqual(state.sent, ["alice-1"], "bob's image never reaches the model");
  assert.equal(state.items[0].caption, undefined);
});

test("stops at the daily cap, which a restart keeps, and starts again the next day", async () => {
  const { state, captioner, later } = fixture([image("waiting")], {
    trickle: { day: new Date("2026-10-26T09:00:00Z").toDateString(), count: dailyItems },
  });
  assert.equal(await captioner.tick(), "capped");
  state.clock += 24 * 60 * 60_000;
  later();
  assert.equal(await captioner.tick(), "done");
  assert.equal(state.saved?.trickle?.count, 1);
});

test("an image that fails is skipped; failures in a row pause instead of skipping everything", async () => {
  const { state, captioner, later } = fixture([image("broken"), image("fine")]);
  state.fail.add("broken");
  assert.equal(await captioner.tick(), "failed");
  later();
  assert.equal(await captioner.tick(), "done");
  assert.equal(state.items[1].caption?.text, "a picture of fine");
  later();
  assert.equal(await captioner.tick(), "none");

  const down = fixture([image("a"), image("b"), image("c"), image("d")]);
  for (const id of ["a", "b", "c", "d"]) down.state.fail.add(id);
  assert.equal(await down.captioner.tick(), "failed");
  down.later();
  assert.equal(await down.captioner.tick(), "failed");
  down.later();
  assert.equal(await down.captioner.tick(), "failing");
  down.later();
  assert.equal(await down.captioner.tick(), "failing", "waits a minute before trying again");
  assert.match((await down.captioner.status()).reason, /failing \(HTTP 500\)/);
  down.state.fail.clear();
  down.state.clock += 60_000;
  assert.equal(await down.captioner.tick(), "done");
  assert.equal(down.state.items[0].caption?.text, "a picture of a", "the paused images come back");
});

test("a pass captions everything flat out, two at a time, including older captions", async () => {
  const { state, captioner, release } = fixture([
    image("a"),
    image("b"),
    image("current", "alice", {
      caption: { ...old, tags: [], version: captionVersion },
    }),
    image("outdated", "alice", { caption: old }),
    image("bob-1", "bob"),
    image("d"),
  ]);
  state.allowed.delete("bob");
  assert.deepEqual((await captioner.status()).remaining, 4);
  assert.equal((await captioner.status()).state, "ready");
  state.hold = true;
  captioner.startPass();
  for (let wait = 0; wait < 5; wait++) await settle();
  assert.equal(state.open, passConcurrency, "two in flight at once");
  assert.equal((await captioner.status()).state, "running");
  release();
  for (let wait = 0; wait < 10 && state.sent.length < 4; wait++) {
    await settle();
    release();
  }
  state.hold = false;
  release();
  await captioner.settled();
  assert.equal(state.most, passConcurrency);
  assert.deepEqual(state.sent.sort(), ["a", "b", "d", "outdated"], "no spacing, no current ones");
  const status = await captioner.status();
  assert.deepEqual(
    [status.state, status.done, status.total, status.remaining, status.failed],
    ["finished", 4, 4, 0, 0],
  );
  assert.equal(state.saved?.pass?.state, "finished");
  assert.equal(state.items[3].caption?.version, captionVersion);
  assert.equal(state.saved?.trickle?.count || 0, 0, "a pass doesn't use the trickle's day");
});

test("a pass yields to work, reports waiting and resumes once idle", async () => {
  const { state, captioner } = fixture([image("a"), image("b"), image("c")]);
  state.hold = true;
  captioner.startPass();
  for (let wait = 0; wait < 5; wait++) await settle();
  assert.equal(state.open, 2);
  state.idle = false;
  captioner.interrupt();
  await captioner.settled();
  assert.equal(state.open, 0, "both step aside at once");
  assert.equal(state.items.filter((item) => item.caption).length, 0);
  assert.equal((await captioner.status()).state, "waiting");
  assert.equal(await captioner.tick(), "busy");

  state.idle = true;
  state.hold = false;
  assert.equal(await captioner.tick(), "done");
  await captioner.settled();
  assert.equal((await captioner.status()).state, "finished");
  assert.equal(state.items.filter((item) => item.caption).length, 3);
});

test("a stopped pass stays stopped across a restart; a running one resumes", async () => {
  const { state, captioner, make } = fixture([image("a"), image("b"), image("c")]);
  state.hold = true;
  captioner.startPass();
  await settle();
  captioner.stopPass();
  await captioner.settled();
  assert.equal(state.saved?.pass?.state, "stopped");
  const restarted = make();
  assert.deepEqual(
    [(await restarted.status()).state, (await restarted.status()).remaining],
    ["stopped", 3],
  );
  state.hold = false;
  assert.equal(await restarted.tick(), "done", "the trickle carries on");
  assert.equal(await restarted.tick(), "spaced");

  restarted.startPass();
  state.hold = true;
  await settle();
  const resumed = make();
  assert.equal(state.saved?.pass?.state, "running");
  state.hold = false;
  restarted.stop();
  restarted.interrupt();
  await restarted.settled();
  assert.equal(await resumed.tick(), "done", "no spacing after a restart mid-pass");
  await resumed.settled();
  assert.equal((await resumed.status()).state, "finished");
});
