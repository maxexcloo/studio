import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import express from "express";
import { closeRuntimeDatabase } from "../persistence/runtime.ts";
import { createGenerationAdmission } from "./admission.ts";
import {
  createDream,
  registerDreamRoutes,
  type DreamAccess,
  type DreamItem,
  type DreamLoraLibrary,
  type DreamProfile,
} from "./dream.ts";
import { writtenJob, type GenerationQueue } from "./queue.ts";
import { registerRewriteRoutes } from "./routes.ts";
import { queuePriority, RewriteStore } from "./store.ts";
import { createTaste } from "./taste.ts";

const profiles: DreamProfile[] = [
  {
    id: "flux",
    kind: "image",
    label: "FLUX",
    workflow: "family:flux",
    defaults: { width: 1024, height: 1024 },
    options: {
      loras: ["fox.safetensors", "film.safetensors", "ink.safetensors", "klein.safetensors"],
    },
  },
  { id: "qwen", kind: "image", label: "Qwen" },
  { id: "wan", kind: "video", label: "Wan", mediaInputs: [{ id: "start", required: true }] },
];
const everything: DreamAccess = {
  gallery: true,
  image: true,
  video: true,
  assistant: true,
  uncensored: false,
};

/** Dream with fakes for every service; nothing generates and nothing starts on its own. */
function fixture(t: TestContext) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-dream-"));
  const store = new RewriteStore(":memory:");
  t.after(() => {
    store.close();
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const taste = createTaste({ dataDir, writer: () => null });
  const state = {
    clock: Date.now(),
    items: [] as DreamItem[],
    access: Object.fromEntries(
      ["alice", "bob"].map((userId) => [
        userId,
        { ...everything, account: { userId, role: "user" } },
      ]),
    ) as Record<string, DreamAccess>,
    online: { text: true, image: true, video: true } as Record<string, boolean | "parked">,
    textBusy: false,
    prompts: 0,
    calls: [] as { model: string; system: string; user: string }[],
    logs: [] as string[],
    loras: {} as Record<string, DreamLoraLibrary>,
  };
  let dream: ReturnType<typeof createDream>;
  const admission = createGenerationAdmission({
    store,
    queue: { tick: async () => undefined } as unknown as GenerationQueue,
    validate: async () => ({ status: 200, payload: { ok: true } }),
    resourceFor: async (input) => `worker:${input.kind === "video" ? "video" : "image"}`,
    pendingItems: (id, input) => [
      { id: `${id}-0`, jobId: id, status: "pending", prompt: input.prompt },
    ],
    revision: () => 0,
    admitted: (job) => dream.admitted(job),
  });
  dream = createDream({
    dataDir,
    store,
    taste,
    owners: () => ["alice", "bob"],
    access: (ownerId) => state.access[ownerId] ?? null,
    catalogue: async () => ({ profiles, defaults: { imageModel: "flux", videoModel: "wan" } }),
    online: async (kind) => {
      const reach = (value: boolean | "parked") =>
        value === "parked" ? value : value ? "online" : "offline";
      return { text: reach(state.online.text), media: reach(state.online[kind]) };
    },
    textBusy: () => state.textBusy,
    writer: {
      model: async () => "writer",
      chat: async ({ model, messages }) => {
        state.calls.push({ model, system: messages[0].content, user: messages[1].content });
        state.prompts++;
        return {
          text: JSON.stringify({
            prompt: `dream ${state.prompts}`,
            why: "You star foxes.",
            title: "Fox Dream",
          }),
        };
      },
    },
    guide: () => ({ summary: "natural language" }),
    gallery: (ownerId) => state.items.filter((item) => item.ownerId === ownerId),
    visible: (items) => items.filter((item) => !item.dream || item.dream.state === "kept"),
    mark: (ownerId, itemId, mark) => {
      const item = state.items.find((entry) => entry.ownerId === ownerId && entry.id === itemId)!;
      item.dream = mark;
    },
    loraLibrary: (ownerId) => state.loras[ownerId] ?? null,
    // As the LoRA policy would: klein.safetensors is for another model family.
    fitLoras: (_profile, loras) => loras.filter((lora) => lora.name !== "klein.safetensors"),
    reference: (_account, itemId) => ({ id: `asset-${itemId}`, source: "gallery" }),
    // Like the queue's writing stage, then the generation route: a Dream job's pending tile
    // carries its written prompt and mark from the queue record.
    admit: async (input, account, scope, origin) => {
      const result = await admission(input, account, scope, origin);
      let job = store.job(account?.userId || "", String(result.payload.jobId))!;
      if (job.status === "writing")
        job = store.save(
          writtenJob(
            job,
            await dream.write(job, {
              signal: new AbortController().signal,
              onThinking() {},
              onDelta() {},
            }),
          ),
        );
      state.items.unshift({
        id: `${job.id}-0`,
        jobId: job.id,
        ownerId: job.ownerId,
        type: input.kind === "video" ? "video" : "image",
        status: "pending",
        prompt: String(job.input.prompt),
        createdAt: new Date(state.clock).toISOString(),
        settings: { profileId: input.profileId },
        ...(job.dream ? { dream: { state: "unseen" as const, ...job.dream } } : {}),
      });
      return result;
    },
    cancel: async (ownerId, jobId) =>
      store.save({ ...store.job(ownerId, jobId)!, status: "cancelled" }),
    now: () => state.clock,
    random: () => 0,
    log: { info: (message) => state.logs.push(message) },
  });
  /** Finishes a job and its tile, as saving its outputs would. */
  const finish = (ownerId: string, jobId: string) => {
    store.save({ ...store.job(ownerId, jobId)!, status: "completed" });
    for (const item of state.items) if (item.jobId === jobId) item.status = "done";
  };
  const dreamJobs = (ownerId?: string) =>
    store.jobs(ownerId).filter((job) => job.priority === queuePriority.dream);
  const live = (ownerId?: string) =>
    dreamJobs(ownerId).filter((job) => !["completed", "failed", "cancelled"].includes(job.status));
  /** One tick, then the Dream job it queued finished. */
  const dreamOnce = async (ownerId = "alice") => {
    await dream.tick();
    const [job] = live(ownerId);
    if (job) finish(ownerId, job.id);
    return job;
  };
  /** Gallery records of jobs Studio ran for their owner, as the composer, Chat or MCP make them. */
  const generated = (...items: DreamItem[]) => {
    for (const item of items) {
      const ownerId = String(item.ownerId);
      const session = store.createSession(ownerId, "Gallery").id;
      const input = { kind: "image", prompt: "" };
      const job = store.enqueue(
        ownerId,
        session,
        input,
        "image",
        undefined,
        "local-media",
        item.jobId,
      );
      store.save({ ...job, status: "completed" });
      state.items.push({ ...item, jobId: job.id });
    }
  };
  return {
    dream,
    store,
    state,
    admission,
    taste,
    finish,
    dreamJobs,
    live,
    dreamOnce,
    dataDir,
    generated,
  };
}

test("Dream is off until turned on, queues one hidden job only while Studio is idle and yields at once", async (t) => {
  const { dream, store, state, admission, dreamJobs, live } = fixture(t);
  assert.deepEqual(dream.read("alice").settings, {
    enabled: false,
    paused: false,
    buffer: 12,
    dailyImages: 40,
    dailyVideos: 4,
    videos: false,
    spicy: false,
  });
  await dream.tick();
  assert.equal(dreamJobs().length, 0);
  assert.equal(dream.status("alice").status, "off");
  assert.equal(dream.started, false);

  await dream.save("alice", { enabled: true });
  // Someone's own work (or MCP's) is queued: Dream waits.
  const session = store.createSession("bob");
  const user = store.enqueue("bob", session.id, { prompt: "mine" }, "image");
  await dream.tick();
  assert.equal(dreamJobs().length, 0);
  store.save({ ...user, status: "completed" });
  const mcp = store.enqueue(
    "bob",
    session.id,
    { prompt: "chat" },
    "image",
    undefined,
    "worker:image",
    undefined,
    { priority: queuePriority.mcp },
  );
  await dream.tick();
  assert.equal(dreamJobs().length, 0);
  store.save({ ...mcp, status: "completed" });
  // Text work holds it back too.
  state.textBusy = true;
  await dream.tick();
  assert.equal(dreamJobs().length, 0);
  state.textBusy = false;

  await dream.tick();
  const [job] = dreamJobs("alice");
  assert.equal(job.priority, queuePriority.dream);
  assert.equal(job.input.kind, "image");
  assert.equal(job.input.profileId, "flux");
  assert.equal(job.input.prompt, "dream 1");
  assert.equal(job.input.allowFallback, false);
  // The title written with the prompt goes to the result (gallery-store.js).
  assert.equal((job.input.writing as { title?: string }).title, "Fox Dream");
  assert.deepEqual(job.dream && { prompt: job.dream.prompt, why: job.dream.why }, {
    prompt: "dream 1",
    why: "You star foxes.",
  });
  // Its session is Dream's own and never listed as a Chat.
  assert.equal(store.session("alice", job.sessionId)?.hidden, true);
  assert.equal(store.sessions("alice").length, 0);
  assert.equal(dream.status("alice").status, "generating");
  // One Dream job at a time across Studio.
  await dream.tick();
  assert.equal(live().length, 1);

  // A person's request cancels the waiting Dream job before the queue can start it.
  const mine = await admission({ prompt: "now" }, { userId: "bob", role: "user" });
  assert.equal(mine.status, 200);
  assert.equal(store.job("alice", job.id)?.status, "cancelled");
  // Cancelled Dream work doesn't count towards the day.
  assert.deepEqual(dream.today("alice"), { images: 0, videos: 0 });
  // A started Dream job is never pre-empted.
  store.save({ ...store.job("bob", String(mine.payload.jobId))!, status: "completed" });
  await dream.tick();
  const [next] = live("alice");
  store.save({ ...next, status: "running" });
  await admission({ prompt: "later" }, { userId: "bob", role: "user" });
  assert.equal(store.job("alice", next.id)?.status, "running");
  // The person's queue never lists Dream jobs.
  const app = express();
  app.use((req, _res, nextHandler) => {
    Object.assign(req, { studioAccount: { userId: "alice", role: "user" } });
    nextHandler();
  });
  registerRewriteRoutes(app as never, {
    store,
    queue: {
      tick: async () => undefined,
      cancel: async (ownerId: string, jobId: string) =>
        store.save({ ...store.job(ownerId, jobId)!, status: "cancelled" }),
    } as unknown as GenerationQueue,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  assert.deepEqual((await (await fetch(`${base}/api/queue`)).json()).jobs, []);
  assert.deepEqual((await (await fetch(`${base}/api/sessions`)).json()).sessions, []);
  for (let index = 0; index < 10; index++)
    assert.equal(
      (await admission({ prompt: `p${index}` }, { userId: "alice", role: "user" })).status,
      200,
    );
  // Cancel Pending and Cancel All act on the person's own work and leave Dream alone.
  for (const route of ["cancel-pending", "cancel-all"])
    assert.equal((await fetch(`${base}/api/queue/${route}`, { method: "POST" })).status, 200);
  assert.equal(store.job("alice", next.id)?.status, "running");
  assert.ok(
    store
      .jobs("alice")
      .filter((job) => job.priority !== queuePriority.dream)
      .every((job) => job.status === "cancelled"),
  );
});

test("Dream stops at the unseen buffer and today's cap per kind, and animates kept or starred images", async (t) => {
  const { dream, state, dreamOnce, live } = fixture(t);
  await dream.save("alice", { enabled: true, buffer: 2, dailyImages: 3 });
  assert.ok(await dreamOnce());
  assert.ok(await dreamOnce());
  assert.equal(await dreamOnce(), undefined);
  assert.deepEqual(dream.status("alice"), {
    status: "waiting",
    reason: "Dream waits until you have looked at what it made.",
  });
  const [first, second] = dream.unseen("alice");
  assert.deepEqual([first.prompt, second.prompt], ["dream 1", "dream 2"]);
  // The writer saw the recent Dream prompts so it can avoid them.
  assert.match(state.calls[1].user, /- dream 1/);
  dream.discard("alice", String(first.id));
  assert.ok(await dreamOnce());
  dream.keep("alice", String(second.id));
  assert.equal(await dreamOnce(), undefined);
  assert.equal(dream.status("alice").status, "capped");
  assert.deepEqual(dream.today("alice"), { images: 3, videos: 0 });
  // A new day starts a new share.
  state.clock += 86_400_000;
  assert.equal(dream.status("alice").status, "waiting");

  // Videos animate a kept or starred image with the default video profile.
  await dream.save("alice", { buffer: 10, dailyImages: 0, videos: true, dailyVideos: 1 });
  const video = await dreamOnce();
  assert.equal(video?.input.kind, "video");
  assert.equal(video?.input.profileId, "wan");
  assert.deepEqual(video?.input.referenceAssets, [
    { assetId: `asset-${second.id}`, source: "gallery", slot: "start" },
  ]);
  assert.match(state.calls.at(-1)!.user, /first frame was made from: dream 2/);
  assert.equal(await dreamOnce(), undefined);
  assert.equal(dream.status("alice").status, "capped");
  assert.equal(live().length, 0);
});

test("Dream picks the most-starred ready profile and keeps Spicy to accounts with Uncensored Models", async (t) => {
  const { dream, state, dreamOnce, generated } = fixture(t);
  const starred = (id: string, profileId: string, days = 1) =>
    generated({
      id,
      ownerId: "alice",
      type: "image",
      status: "done",
      favorite: true,
      prompt: `starred ${id}`,
      createdAt: new Date(state.clock - days * 86_400_000).toISOString(),
      settings: { profileId },
    });
  starred("a", "qwen");
  starred("b", "qwen");
  starred("c", "flux");
  starred("d", "flux", 40);
  starred("e", "flux", 40);
  await dream.save("alice", { enabled: true, spicy: true });
  const job = await dreamOnce();
  assert.equal(job?.input.profileId, "qwen");
  assert.match(state.calls[0].user, /- starred a/);
  // No uncensored grant: Spicy never applies, whatever the setting says.
  assert.equal(state.calls[0].model, "writer");
  assert.match(state.calls[0].system, /safe for work/);
  state.access.alice.uncensored = true;
  const spicy = await dreamOnce();
  assert.equal(state.calls[1].model, "writer");
  assert.match(state.calls[1].system, /Spicy/);
  assert.equal(spicy?.dream?.spicy, true);
});

test("Dream skips accounts without the prompt assistant and offline services, logging each reason once", async (t) => {
  const { dream, state, dreamJobs } = fixture(t);
  await dream.save("alice", { enabled: true });
  state.access.alice.assistant = false;
  await dream.tick();
  await dream.tick();
  assert.equal(dreamJobs().length, 0);
  assert.deepEqual(dream.status("alice"), {
    status: "unavailable",
    reason: "The prompt assistant is off for this account.",
  });
  assert.equal(state.logs.length, 1);
  state.access.alice.assistant = true;
  state.online.text = false;
  await dream.tick();
  assert.equal(dream.status("alice").reason, "The text model is offline.");
  state.online.text = true;
  state.online.image = false;
  await dream.tick();
  assert.equal(dream.status("alice").reason, "The image worker is offline.");
  state.online.image = "parked";
  await dream.tick();
  assert.match(
    dream.status("alice").reason!,
    /^The image worker is parked: it was stopped on purpose/,
  );
  assert.equal(state.logs.length, 4);
  assert.equal(state.calls.length, 0);
  assert.equal(dreamJobs().length, 0);
  // Pausing stops a waiting Dream job.
  state.online.image = true;
  await dream.tick();
  assert.equal(dreamJobs("alice")[0].status, "queued");
  // A waiting job whose worker goes offline steps aside, and Dream tries again once it is back.
  state.online.image = "parked";
  await dream.tick();
  assert.deepEqual(
    dreamJobs("alice").map((job) => job.status),
    ["cancelled"],
  );
  assert.match(dream.status("alice").reason!, /^The image worker is parked/);
  state.online.image = true;
  await dream.tick();
  assert.equal(dreamJobs("alice").filter((job) => job.status === "queued").length, 1);
  await dream.save("alice", { paused: true });
  assert.ok(dreamJobs("alice").every((job) => job.status === "cancelled"));
  assert.equal(dream.status("alice").status, "paused");
});

/** Serves the Dream routes; `request` answers as the user named in its last argument. */
async function serve(t: TestContext, dream: ReturnType<typeof createDream>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { studioAccount: { userId: String(req.headers["x-user"]), role: "user" } });
    next();
  });
  registerDreamRoutes(app as never, { dream });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return async (route: string, body?: unknown, method = "POST", user = "alice") => {
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/dream${route}`,
      {
        method: body === undefined ? "GET" : method,
        headers: { "content-type": "application/json", "x-user": user },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    return { status: response.status, body: await response.json() };
  };
}

test("Dream routes are owner-scoped: keep, discard and variations move results and teach the taste profile", async (t) => {
  const { dream, store, state, taste, dreamOnce } = fixture(t);
  await dream.save("alice", { enabled: true });
  const job = (await dreamOnce())!;
  await dreamOnce();
  await dreamOnce();
  const request = await serve(t, dream);
  const shown = (await request("")).body;
  assert.equal(shown.settings.enabled, true);
  assert.deepEqual(shown.today, { images: 3, videos: 0 });
  assert.deepEqual(
    shown.unseen.map((item: DreamItem) => item.prompt),
    ["dream 1", "dream 2", "dream 3"],
  );
  assert.equal(shown.spicyAvailable, false);
  assert.equal((await request("", undefined, "GET", "bob")).body.unseen.length, 0);
  const [one, two, three] = shown.unseen.map((item: DreamItem) =>
    encodeURIComponent(String(item.id)),
  );

  assert.equal((await request("/settings", { buffer: 0 }, "PUT")).status, 400);
  assert.equal((await request("/settings", { videos: "yes" }, "PUT")).status, 400);
  assert.equal((await request("/settings", { spicy: true }, "PUT")).status, 403);
  const saved = await request("/settings", { paused: true, dailyVideos: 2 }, "PUT");
  assert.equal(saved.body.settings.paused, true);
  assert.equal(saved.body.settings.dailyVideos, 2);
  assert.equal(saved.body.status, "paused");

  // Another account can't judge Alice's results.
  assert.equal((await request(`/${one}/keep`, {}, "POST", "bob")).status, 404);
  const kept = await request(`/${one}/keep`, {});
  assert.equal(kept.body.item.dream.state, "kept");
  assert.equal((await request(`/${one}/discard`, {})).status, 409);
  assert.equal((await request(`/${two}/discard`, {})).body.item.dream.state, "discarded");
  assert.deepEqual(
    taste.read("alice").signals.map((signal) => [signal.kind, signal.jobId]),
    [
      ["discard", state.items.find((item) => item.prompt === "dream 2")?.jobId],
      ["keep", job.id],
    ],
  );
  const discarded = await request("/discarded?limit=1");
  assert.equal(discarded.body.items[0].prompt, "dream 2");
  assert.equal(discarded.body.nextCursor, "");

  // Variations keep the result and queue the person's own job with new seeds.
  assert.equal((await request(`/${three}/variations`, { count: 9 })).status, 400);
  const varied = await request(`/${three}/variations`, { count: 3 });
  assert.equal(varied.status, 202);
  assert.equal(varied.body.item.dream.state, "kept");
  const variation = store.job("alice", varied.body.jobId)!;
  assert.equal(variation.priority, queuePriority.manual);
  assert.equal(variation.dream, undefined);
  assert.equal(variation.input.count, 3);
  assert.equal(variation.input.prompt, "dream 3");
  assert.equal(store.session("alice", variation.sessionId)?.hidden, undefined);
  assert.equal((await request("")).body.unseen.length, 0);
  // Without gallery access Dream is closed.
  state.access.alice.gallery = false;
  assert.equal((await request("")).status, 403);
});

test("starring an unseen, finished Dream result keeps it", (t) => {
  const { dream, state, taste } = fixture(t);
  const mark = { prompt: "p", why: "", at: new Date(state.clock).toISOString() };
  for (const [id, status] of [
    ["done", "done"],
    ["pending", "pending"],
  ])
    state.items.push({
      id,
      jobId: `job-${id}`,
      ownerId: "alice",
      type: "image",
      status,
      dream: { ...mark, state: "unseen" },
    });
  dream.starred("alice", ["done", "pending"]);
  dream.starred("bob", ["done"]);
  assert.deepEqual(
    state.items.map((item) => item.dream?.state),
    ["kept", "unseen"],
  );
  assert.deepEqual(
    taste.read("alice").signals.map((signal) => [signal.kind, signal.jobId]),
    [["keep", "job-done"]],
  );
});

test("Dream keeps every discard, most recently discarded first", (t) => {
  const { dream, state } = fixture(t);
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 0, minute)).toISOString();
  for (let index = 0; index < 600; index++)
    state.items.push({
      id: `old-${index}`,
      ownerId: "alice",
      type: "image",
      status: "done",
      dream: { prompt: "p", why: "", at: at(0), state: "discarded", decidedAt: at(index) },
    });
  state.items.push({
    id: "fresh",
    jobId: "job-fresh",
    ownerId: "alice",
    type: "image",
    status: "done",
    dream: { prompt: "p", why: "", at: at(0), state: "unseen" },
  });
  dream.discard("alice", "fresh");
  assert.equal(dream.discarded("alice").length, 601);
  assert.equal(dream.discarded("alice")[0].id, "fresh");
});

test("Calibration offers the account's older Studio generations, unjudged first, and only teaches the taste profile", async (t) => {
  const { dream, state, taste, generated } = fixture(t);
  const old = new Date(state.clock - 2 * 86_400_000).toISOString();
  const image = (id: string, extra: Partial<DreamItem> = {}): DreamItem => ({
    id,
    jobId: `job-${id}`,
    ownerId: "alice",
    type: "image",
    status: "done",
    prompt: `prompt ${id}`,
    createdAt: old,
    settings: { profileId: "flux" },
    ...extra,
  });
  generated(
    image("a"),
    image("b"),
    image("c"),
    image("new", { createdAt: new Date(state.clock).toISOString() }),
    image("clip", { type: "video" }),
    image("unseen", { dream: { prompt: "p", why: "", at: old, state: "unseen" } }),
    image("bobs", { ownerId: "bob" }),
  );
  // Not Studio generations of this account: an upload or import without a job here, and a record
  // attributed to alice whose job another account ran.
  state.items.push(
    image("upload", { jobId: "imported" }),
    image("borrowed", { jobId: "job-bobs" }),
  );
  const request = await serve(t, dream);
  const offered = async () =>
    (await request("/calibration?limit=10")).body.items.map((item: DreamItem) => item.id).sort();
  assert.deepEqual(await offered(), ["a", "b", "c"]);

  assert.equal((await request("/calibration", { liked: ["a", "b"], passed: ["c"] })).status, 400);
  assert.equal((await request("/calibration", {})).status, 400);
  assert.equal((await request("/calibration", { liked: ["a"], passed: ["a"] })).status, 400);
  for (const id of ["bobs", "upload", "borrowed"])
    assert.equal((await request("/calibration", { liked: [id] })).status, 404);
  assert.equal((await request("/calibration", { liked: ["new"] })).status, 404);
  assert.equal((await request("/calibration", { liked: ["a"], passed: ["b"] })).status, 200);
  assert.equal((await request("/calibration", { passed: ["c"] })).status, 200);
  assert.deepEqual(
    taste.read("alice").signals.map((signal) => [signal.kind, signal.jobId, signal.prompt]),
    [
      ["calibrate-pass", "job-c", "prompt c"],
      ["calibrate-pass", "job-b", "prompt b"],
      ["calibrate-like", "job-a", "prompt a"],
    ],
  );
  // Judged images come after unjudged ones; nothing in the gallery changed.
  generated(image("d"));
  assert.equal((await request("/calibration?limit=1")).body.items[0].id, "d");
  assert.deepEqual(
    state.items.filter((item) => item.dream).map((item) => [item.id, item.dream?.state]),
    [["unseen", "unseen"]],
  );
});

test("Dream loads up to two of the account's thumbs-up LoRAs the profile can use", async (t) => {
  const { dream, state, store, dreamOnce } = fixture(t);
  // A LoRA for another family is left out; the run goes ahead without it.
  state.loras.alice = { ratings: { "klein.safetensors": "up" }, strengths: {} };
  await dream.save("alice", { enabled: true });
  assert.deepEqual((await dreamOnce())!.input.loras, []);
  state.loras.alice = {
    ratings: {
      "klein.safetensors": "up",
      "not-installed.safetensors": "up",
      "fox.safetensors": "up",
      "film.safetensors": "up",
      "ink.safetensors": "down",
    },
    strengths: { "family:flux": { "fox.safetensors": 0.6 } },
  };
  await dream.save("alice", { enabled: true });
  const job = (await dreamOnce())!;
  const loras = store.job("alice", job.id)!.input.loras as { name: string; strength: number }[];
  assert.deepEqual(loras.map((lora) => [lora.name, lora.strength]).sort(), [
    ["film.safetensors", 1],
    ["fox.safetensors", 0.6],
  ]);
  state.loras.alice.ratings["ink.safetensors"] = "up";
  assert.equal(((await dreamOnce())!.input.loras as unknown[]).length, 2);
  assert.match(state.calls.at(-1)!.user, /favourite LoRAs: /);
  // Without LoRA access nothing is added.
  state.loras = {};
  const next = (await dreamOnce())!;
  assert.deepEqual(store.job("alice", next.id)!.input.loras, []);
});

test("Every fourth image compares one thing on a kept image's prompt; answers keep, discard and teach", async (t) => {
  const { dream, state, store, taste, finish, live, dreamOnce } = fixture(t);
  // A kept image alice generated with FLUX: the comparison's starting point.
  const session = store.createSession("alice", "Gallery").id;
  const base = store.enqueue(
    "alice",
    session,
    { kind: "image", profileId: "flux", prompt: "a fox in snow", steps: 20, cfg: 3.5, loras: [] },
    "image",
  );
  store.save({ ...base, status: "completed" });
  state.items.push({
    id: "base",
    jobId: base.id,
    ownerId: "alice",
    type: "image",
    status: "done",
    favorite: true,
    prompt: "a fox in snow",
    settings: { profileId: "flux" },
  });
  await dream.save("alice", { enabled: true, dailyImages: 10 });
  for (let made = 0; made < 3; made++) assert.ok(await dreamOnce());
  await dream.tick();
  const [a, b] = live("alice");
  assert.deepEqual(
    [a, b].map((job) => [job.input.profileId, job.input.prompt, job.input.seed, job.dream?.pair]),
    [
      [
        "flux",
        "a fox in snow",
        "0",
        { id: a.dream!.pair!.id, side: 0, question: "Which Model?", label: "FLUX" },
      ],
      [
        "qwen",
        "a fox in snow",
        "0",
        { id: a.dream!.pair!.id, side: 1, question: "Which Model?", label: "Qwen" },
      ],
    ],
  );
  // One side waits for the other before the pair shows.
  finish("alice", a.id);
  assert.ok(!dream.unseen("alice").some((item) => item.dream?.pair));
  finish("alice", b.id);
  assert.equal(dream.unseen("alice").filter((item) => item.dream?.pair).length, 2);

  const request = await serve(t, dream);
  const pair = a.dream!.pair!.id;
  assert.equal((await request(`/pairs/${pair}/answer`, { answer: "maybe" })).status, 400);
  assert.equal(
    (await request(`/pairs/${pair}/answer`, { answer: "b" }, "POST", "bob")).status,
    404,
  );
  assert.equal((await request(`/pairs/${pair}/answer`, { answer: "b" })).status, 200);
  assert.deepEqual(
    state.items.filter((item) => item.dream?.pair).map((item) => item.dream!.state),
    ["kept", "discarded"],
  );
  const [signal] = taste.read("alice").signals;
  assert.deepEqual(
    [signal.kind, signal.question, signal.answer, signal.profileId, signal.over?.profileId],
    ["preferred", "Which Model?", "Qwen over FLUX", "qwen", "flux"],
  );
  // The same image never starts a second comparison.
  assert.deepEqual(dream.read("alice").compared, ["base"]);

  // More Like This keeps the result and steers the next ideas toward it.
  const [next] = dream.unseen("alice");
  assert.equal((await request(`/${next.id}/more`, {})).status, 200);
  const steered = (await dreamOnce())!;
  assert.equal((steered.input.writing as { like?: string }).like, next.prompt);
  assert.match(state.calls.at(-1)!.user, new RegExp(`More like this one: ${next.prompt}`));
  assert.equal(dream.read("alice").steer?.remaining, 3);
});
