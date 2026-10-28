import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import express from "express";
import { closeRuntimeDatabase } from "../persistence/runtime.ts";
import { createFinishing, registerFinishingRoutes, type FinishingItem } from "./finishing.ts";
import { terminalStatuses } from "./queue.ts";
import { queuePriority, RewriteStore } from "./store.ts";

type Item = FinishingItem & { id: string; ownerId: string };
const image = (id: string, ownerId = "alice", extra: Partial<Item> = {}): Item => ({
  id,
  ownerId,
  type: "image",
  status: "done",
  prompt: "a fox in the snow",
  favorite: true,
  ...extra,
});

/** Finishing with fakes for the gallery, the upscale worker and the queue; nothing upscales. */
function fixture(t: TestContext) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-finishing-"));
  const store = new RewriteStore(":memory:");
  t.after(() => {
    finishing.stop();
    store.close();
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const state = {
    items: [] as Item[],
    allowed: { alice: true, bob: true } as Record<string, boolean>,
    textBusy: false,
    ready: { faceDetail: true } as { reason: string } | { faceDetail: boolean },
    upscales: [] as {
      ownerId: string;
      galleryItemId: string;
      quality: string;
      faceDetail: boolean;
    }[],
    logs: [] as string[],
  };
  const session = (ownerId: string) => store.createSession(ownerId);
  const finishing = createFinishing({
    dataDir,
    store,
    owners: () => ["alice", "bob"],
    allowed: (ownerId) => state.allowed[ownerId] ?? false,
    item: (ownerId, itemId) =>
      state.items.find((item) => item.id === itemId && item.ownerId === ownerId),
    // The captioner's rule: no live job of any kind and no text work.
    idle: () => !state.textBusy && !store.jobs().some((job) => !terminalStatuses.has(job.status)),
    ready: async () => state.ready,
    fullBody: (prompt) => /standing/.test(prompt),
    // Like the upscale route: a queued job at the finishing tier, and the tile shows it queued.
    upscale: async (ownerId, request) => {
      state.upscales.push({ ownerId, ...request });
      const job = store.enqueue(
        ownerId,
        session(ownerId).id,
        { galleryItemId: request.galleryItemId },
        "upscale",
        undefined,
        "worker:image",
        undefined,
        { priority: queuePriority.finishing },
      );
      const item = state.items.find((entry) => entry.id === request.galleryItemId)!;
      item.upscale = { status: "queued" };
      return { status: 200, payload: { ok: true, jobId: job.id } };
    },
    cancel: async (ownerId, jobId) => {
      const job = store.job(ownerId, jobId)!;
      store.save({ ...job, status: "cancelled" });
      const item = state.items.find((entry) => entry.id === job.input.galleryItemId)!;
      item.upscale = { status: "canceled" };
    },
    log: { info: (message) => state.logs.push(message) },
  });
  const live = () => store.jobs().filter((job) => !terminalStatuses.has(job.status));
  /** Completes the running upscale, as saving its output would. */
  const complete = () => {
    for (const job of live()) {
      store.save({ ...job, status: "completed" });
      state.items.find((item) => item.id === job.input.galleryItemId)!.upscale = {
        status: "done",
        url: "/upscaled.png",
      };
    }
  };
  return { finishing, store, state, live, complete, session };
}

test("Finish Starred Images is off until turned on and turning it off forgets the waiting list", async (t) => {
  const { finishing, state, live } = fixture(t);
  assert.deepEqual(finishing.read("alice").settings, {
    enabled: false,
    quality: "balanced",
    faceDetail: true,
  });
  state.items.push(image("a"));
  finishing.starred("alice", ["a"], true);
  await finishing.tick();
  assert.equal(finishing.waiting("alice"), 0);
  assert.equal(live().length, 0);

  await finishing.save("alice", { enabled: true, quality: "high" });
  finishing.starred("alice", ["a"], true);
  assert.equal(finishing.waiting("alice"), 1);
  await finishing.save("alice", { enabled: false });
  assert.equal(finishing.waiting("alice"), 0);
  await finishing.tick();
  assert.equal(live().length, 0);
});

test("Starring queues finishable images once, unstarring takes them off, and one upscale runs at a time", async (t) => {
  const { finishing, state, live, complete } = fixture(t);
  await finishing.save("alice", { enabled: true, quality: "fast" });
  state.items.push(
    image("a"),
    image("b", "alice", { prompt: "a woman standing on a pier" }),
    image("c"),
    image("done", "alice", { upscale: { status: "done", url: "/up.png" } }),
    image("video", "alice", { type: "video" }),
    image("rendering", "alice", { status: "pending" }),
  );
  finishing.starred("alice", ["a", "b", "c", "done", "video", "rendering"], true);
  finishing.starred("alice", ["a"], true);
  assert.equal(finishing.waiting("alice"), 3);
  finishing.starred("alice", ["c"], false);
  assert.equal(finishing.waiting("alice"), 2);

  await finishing.tick();
  await finishing.tick();
  assert.equal(live().length, 1);
  assert.deepEqual(state.upscales, [
    { ownerId: "alice", galleryItemId: "a", quality: "fast", faceDetail: false },
  ]);
  // Unstarring a started image leaves its upscale running.
  finishing.starred("alice", ["a"], false);
  assert.equal(live().length, 1);
  complete();
  await finishing.tick();
  // Face detail joins only a full-body person, and only while the worker has it.
  assert.deepEqual(state.upscales[1], {
    ownerId: "alice",
    galleryItemId: "b",
    quality: "fast",
    faceDetail: true,
  });
  complete();
  await finishing.tick();
  assert.equal(state.upscales.length, 2);
  assert.equal(finishing.waiting("alice"), 0);
});

test("Finishing waits for idle time, yields a waiting upscale to new work and skips an unready worker", async (t) => {
  const { finishing, store, state, live, session } = fixture(t);
  await finishing.save("alice", { enabled: true });
  state.items.push(image("a"));
  finishing.starred("alice", ["a"], true);

  state.textBusy = true;
  await finishing.tick();
  assert.equal(live().length, 0);
  state.textBusy = false;
  const mine = store.enqueue("bob", session("bob").id, { prompt: "mine" }, "image");
  await finishing.tick();
  assert.equal(state.upscales.length, 0);
  store.save({ ...mine, status: "completed" });

  state.ready = { reason: "The SeedVR2 models aren’t installed yet." };
  await finishing.tick();
  await finishing.tick();
  assert.equal(live().length, 0);
  assert.equal(finishing.waiting("alice"), 1);
  assert.deepEqual(state.logs, [
    "[Studio] Finish Starred Images waits: The SeedVR2 models aren’t installed yet.",
  ]);

  state.ready = { faceDetail: false };
  await finishing.tick();
  const [job] = live();
  assert.equal(job.priority, queuePriority.finishing);
  assert.equal(finishing.waiting("alice"), 0);
  // Someone's work arrives before the queue starts it: it is cancelled and waits again.
  finishing.admitted(store.enqueue("bob", session("bob").id, { prompt: "next" }, "image"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.job("alice", job.id)?.status, "cancelled");
  assert.equal(finishing.waiting("alice"), 1);
});

test("Finishing keeps each account's list to itself and leaves accounts that may not upscale alone", async (t) => {
  const { finishing, state, live } = fixture(t);
  await finishing.save("alice", { enabled: true });
  await finishing.save("bob", { enabled: true });
  state.items.push(image("a"), image("b", "bob"));
  // Bob cannot queue Alice's image.
  finishing.starred("bob", ["a"], true);
  assert.equal(finishing.waiting("bob"), 0);
  state.allowed.alice = false;
  finishing.starred("alice", ["a"], true);
  assert.equal(finishing.waiting("alice"), 0);
  state.allowed.alice = true;
  finishing.starred("alice", ["a"], true);
  state.allowed.alice = false;
  finishing.starred("bob", ["b"], true);
  await finishing.tick();
  assert.equal(live().length, 1);
  assert.deepEqual(
    state.upscales.map((upscale) => [upscale.ownerId, upscale.galleryItemId]),
    [["bob", "b"]],
  );

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { studioAccount: { userId: String(req.headers["x-user"]) } });
    next();
  });
  registerFinishingRoutes(app, { finishing });
  const server = app.listen(0);
  t.after(() => server.close());
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (user: string, method = "GET", body?: unknown) =>
    fetch(`${base}/api/finishing${body ? "/settings" : ""}`, {
      method,
      headers: { "content-type": "application/json", "x-user": user },
      body: body ? JSON.stringify(body) : undefined,
    });
  assert.equal((await call("alice")).status, 403);
  assert.deepEqual(await (await call("bob")).json(), {
    settings: { enabled: true, quality: "balanced", faceDetail: true },
    waiting: 0,
  });
  assert.equal((await call("bob", "PUT", { quality: "best" })).status, 400);
  assert.equal((await call("bob", "PUT", { enabled: "yes" })).status, 400);
  const saved = await call("bob", "PUT", { quality: "high", faceDetail: false });
  assert.deepEqual((await saved.json()).settings, {
    enabled: true,
    quality: "high",
    faceDetail: false,
  });
  assert.equal(finishing.read("alice").settings.quality, "balanced");
});
