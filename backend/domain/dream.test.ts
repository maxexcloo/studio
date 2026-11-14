import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import express from "express";
import type { CardKind, Character } from "../../shared/characters.ts";
import { closeRuntimeDatabase, openDatabase } from "../persistence/runtime.ts";
import { createGenerationAdmission } from "./admission.ts";
import {
  createDream,
  dreamRequest,
  suggestionsFrom,
  type DreamAccess,
  type DreamInspiration,
  type DreamItem,
  type DreamLoraLibrary,
  type DreamProfile,
} from "./dream.ts";
import { registerDreamRoutes } from "./dream-routes.ts";
import { createProjects } from "./projects.ts";
import { writtenJob, type GenerationQueue } from "./queue.ts";
import { registerRewriteRoutes } from "./routes.ts";
import { queuePriority, Store } from "./store.ts";
import { createTaste, tasteSignal } from "./taste.ts";

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
const everything: DreamAccess = { uncensored: false };

/** Dream with fakes for every service; nothing generates and nothing starts on its own. */
function fixture(t: TestContext, catalogue = profiles) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-dream-"));
  const store = new Store(openDatabase(":memory:"));
  t.after(() => {
    store.close();
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const taste = createTaste({ dataDir, writer: () => null });
  const projects = createProjects({ dataDir, now: () => state.clock });
  const state = {
    clock: Date.now(),
    items: [] as DreamItem[],
    access: Object.fromEntries(
      ["alice", "bob"].map((userId) => [
        userId,
        { ...everything, account: { userId, role: "user" } },
      ]),
    ) as Record<string, DreamAccess | null>,
    online: { text: true, image: true, video: true } as Record<string, boolean | "parked">,
    textBusy: false,
    slots: 1,
    prompts: 0,
    calls: [] as { model: string; system: string; user: string }[],
    logs: [] as string[],
    loras: {} as Record<string, DreamLoraLibrary>,
    inspiration: [] as DreamInspiration[],
    /** Rolls for the next chance draws (out of 100); every other draw is 0. */
    rolls: [] as number[],
    /** The account's cards, or null without Characters. */
    cards: { characters: [], outfits: [], scenes: [] } as Record<CardKind, Character[]> | null,
    /** Where videos run: the profile Animate would choose, or why none can. */
    video: { id: "wan", cloud: false, note: "" } as { id: string; cloud: boolean; note: string },
    videoRefusal: "",
    /** The text model's reply when asked for suggestions. */
    suggestions: { suggestions: [] } as unknown,
  };
  const admission = createGenerationAdmission({
    store,
    queue: { tick: async () => undefined } as unknown as GenerationQueue,
    validate: async () => ({ status: 200, payload: { ok: true } }),
    resourceFor: async (input) => `worker:${input.kind === "video" ? "video" : "image"}`,
    pendingItems: (id, input) => [
      { id: `${id}-0`, jobId: id, status: "pending", prompt: input.prompt },
    ],
    revision: () => 0,
  });
  const dream = createDream({
    dataDir,
    store,
    taste,
    projects: (ownerId) => projects.list(ownerId),
    chats: (ownerId) => projects.chats(ownerId),
    owners: () => ["alice", "bob"],
    access: (ownerId) => state.access[ownerId] ?? null,
    catalogue: async () => ({
      profiles: catalogue,
      defaults: { imageModel: "flux", videoModel: "wan" },
    }),
    online: async (kind) => {
      const reach = (value: boolean | "parked") =>
        value === "parked" ? value : value ? "online" : "offline";
      return { text: reach(state.online.text), media: reach(state.online[kind]) };
    },
    textBusy: () => state.textBusy,
    slots: () => state.slots,
    writer: {
      model: async () => "writer",
      chat: async ({ model, messages }) => {
        state.calls.push({ model, system: messages[0].content, user: messages[1].content });
        if (messages[0].content.startsWith("You find what recurs"))
          return { text: JSON.stringify(state.suggestions) };
        state.prompts++;
        return {
          text: JSON.stringify({
            prompt: `dream ${state.prompts}`,
            why: "You star foxes.",
            title: `Fox Dream ${state.prompts}`,
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
    remove: (ownerId, itemIds) => {
      state.items = state.items.filter(
        (item) => item.ownerId !== ownerId || !itemIds.includes(String(item.id)),
      );
    },
    loraLibrary: (ownerId) => state.loras[ownerId] ?? null,
    // As the LoRA policy would: klein.safetensors is for another model family.
    fitLoras: (_profile, loras) => loras.filter((lora) => lora.name !== "klein.safetensors"),
    inspiration: () => state.inspiration,
    reference: (_account, itemId, frame) => ({
      id: frame ? `${frame}-frame-${itemId}` : `asset-${itemId}`,
      source: "gallery",
    }),
    // As Animate chooses: an Extend keeps its video's model.
    videoProfile: async (_ownerId, _account, { extend }) => {
      if (state.videoRefusal) throw new Error(state.videoRefusal);
      const own = catalogue.find((profile) => profile.id === extend);
      return {
        ...state.video,
        profile: own || catalogue.find((profile) => profile.id === state.video.id)!,
      };
    },
    cards: () => state.cards,
    createCard: (_account, kind, fields) => {
      const card = { id: `${kind}-${state.cards![kind].length + 1}`, ...fields } as Character;
      state.cards![kind].push(card);
      return card;
    },
    minorAge: (text) => /\b16\b/.exec(text)?.[0] || "",
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
    random: (size) => (size === 100 && state.rolls.length ? state.rolls.shift()! : 0),
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
  /** Gallery records of jobs Studio ran for their owner, as the composer or MCP make them. */
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
    projects,
  };
}

test("Dream is off until turned on, queues one hidden job per account only while Studio is idle and waits below other work", async (t) => {
  const { dream, store, state, admission, dreamJobs, live } = fixture(t);
  assert.deepEqual(dream.read("alice").settings, {
    enabled: false,
    paused: false,
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
  // The title written with the prompt goes to the result (gallery/store.js).
  assert.equal((job.input.writing as { title?: string }).title, "Fox Dream 1");
  assert.deepEqual(job.dream && { prompt: job.dream.prompt, why: job.dream.why }, {
    prompt: "dream 1",
    why: "You star foxes.",
  });
  // Its session is Dream's own.
  assert.equal(store.session("alice", job.sessionId)?.title, "Dream");
  assert.equal(dream.status("alice").status, "generating");
  // One Dream job per account: Alice gets no second one, but Bob gets his own.
  await dream.tick();
  assert.equal(live("alice").length, 1);
  await dream.save("bob", { enabled: true });
  await dream.tick();
  assert.equal(live("bob").length, 1);
  // Turning Dream off cancels its waiting job; cancelled Dream work doesn't count towards the day.
  await dream.save("bob", { enabled: false });
  assert.equal(live("bob").length, 0);
  assert.deepEqual(dream.today("bob"), { images: 0, videos: 0 });

  // A person's request leaves the waiting Dream job waiting below it, and Dream queues no more.
  const mine = await admission({ prompt: "now" }, { userId: "bob", role: "user" });
  assert.equal(mine.status, 200);
  await dream.tick();
  assert.deepEqual(
    live().map((each) => [each.id, each.status]),
    [[job.id, "queued"]],
  );
  // A started Dream job finishes.
  store.save({ ...store.job("bob", String(mine.payload.jobId))!, status: "completed" });
  store.save({ ...store.job("alice", job.id)!, status: "running" });
  await admission({ prompt: "later" }, { userId: "bob", role: "user" });
  assert.equal(store.job("alice", job.id)?.status, "running");
  // The person's queue lists their Dream job, marked as Dream's.
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
  assert.deepEqual(
    (await (await fetch(`${base}/api/queue`)).json()).jobs.map(
      (each: { id: string; dream?: true }) => [each.id, each.dream],
    ),
    [[job.id, true]],
  );
  for (let index = 0; index < 10; index++)
    assert.equal(
      (await admission({ prompt: `p${index}` }, { userId: "alice", role: "user" })).status,
      200,
    );
  // Cancel Pending and Cancel All act on the person's own work and leave Dream alone.
  for (const route of ["cancel-pending", "cancel-all"])
    assert.equal((await fetch(`${base}/api/queue/${route}`, { method: "POST" })).status, 200);
  assert.equal(store.job("alice", job.id)?.status, "running");
  assert.ok(
    store
      .jobs("alice")
      .filter((job) => job.priority !== queuePriority.dream)
      .every((job) => job.status === "cancelled"),
  );
});

test("Dream keeps one job per worker going, so every idle GPU takes part", async (t) => {
  const { dream, state, dreamJobs } = fixture(t);
  state.slots = 2;
  await dream.save("alice", { enabled: true });
  await dream.tick();
  await dream.tick();
  assert.equal(dreamJobs("alice").length, 2);
  // A third waits for a worker.
  await dream.tick();
  assert.equal(dreamJobs("alice").length, 2);
  assert.equal(dream.status("alice").status, "generating");
});

test("Dream stops at today's cap per kind, however much waits unseen, and animates kept or starred images", async (t) => {
  const { dream, state, dreamOnce, live } = fixture(t);
  await dream.save("alice", { enabled: true, dailyImages: 3 });
  assert.ok(await dreamOnce());
  assert.ok(await dreamOnce());
  assert.ok(await dreamOnce());
  assert.equal(await dreamOnce(), undefined);
  const [first, second] = dream.unseen("alice");
  assert.deepEqual([first.prompt, second.prompt], ["dream 1", "dream 2"]);
  // The writer saw the recent Dream ideas so it can avoid them.
  assert.match(state.calls[1].user, /- Fox Dream 1/);
  dream.keep("alice", String(second.id));
  assert.equal(dream.status("alice").status, "capped");
  assert.deepEqual(dream.today("alice"), { images: 3, videos: 0 });
  // A new day starts a new share.
  state.clock += 86_400_000;
  assert.equal(dream.status("alice").status, "waiting");

  // Videos animate a kept or starred image with the default video profile.
  await dream.save("alice", { dailyImages: 0, videos: true, dailyVideos: 1 });
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

test("Dream draws a ready profile by its taste, explores one axis at a time and keeps Spicy to accounts with Uncensored Models", async (t) => {
  const { dream, state, taste, dreamOnce, generated } = fixture(t);
  const starred = (id: string, profileId: string) => {
    generated({
      id,
      ownerId: "alice",
      type: "image",
      status: "done",
      favorite: true,
      prompt: `starred ${id}`,
      settings: { profileId },
    });
    taste.record("alice", [tasteSignal("star", id, { profileId, tags: ["fox"] })]);
  };
  starred("a", "qwen");
  starred("b", "qwen");
  taste.record("alice", [tasteSignal("discard", "c", { profileId: "flux" })]);
  await dream.save("alice", { enabled: true, spicy: true });
  const job = await dreamOnce();
  assert.equal(job?.input.profileId, "qwen");
  assert.equal(job?.dream?.arm, "exploit");
  assert.match(state.calls[0].user, /- starred [ab]/);
  // An exploited idea features something they like.
  assert.match(state.calls[0].system, /feature this, which they like: fox\./);
  // No uncensored grant: Spicy never applies, whatever the setting says.
  assert.equal(state.calls[0].model, "writer");
  assert.match(state.calls[0].system, /safe for work/);
  state.access.alice!.uncensored = true;
  const spicy = await dreamOnce();
  assert.equal(state.calls[1].model, "writer");
  assert.match(state.calls[1].system, /Spicy/);
  assert.equal(spicy?.dream?.spicy, true);
  // Losing the grant after queueing: the job is written safe for work.
  state.access.alice!.uncensored = false;
  await dream.write(spicy!, {
    signal: new AbortController().signal,
    onThinking() {},
    onDelta() {},
  });
  assert.match(state.calls[2].system, /safe for work/);
  // A share of ideas explores one axis; the first tries the profile used least, here one never used.
  state.rolls = [99];
  const explored = await dreamOnce();
  assert.equal(explored?.input.profileId, "flux");
  assert.equal(explored?.dream?.arm, "explore:profile");
  assert.equal(explored?.dream?.why, "Trying FLUX for the first time · You star foxes.");
  // The next explores the prompt: half from a Library import, on its profile with its LoRAs, for
  // Uncensored Models only, since imports carry no content rating.
  state.access.alice!.uncensored = true;
  state.loras.alice = {
    ratings: { "fox.safetensors": "up", "film.safetensors": "up", "ink.safetensors": "down" },
    strengths: {},
  };
  state.inspiration = [
    {
      prompt: "a lighthouse in a storm",
      profileId: "flux",
      loras: [
        { name: "fox.safetensors", strength: 0.7 },
        { name: "ink.safetensors", strength: 1 },
        { name: "missing.safetensors", strength: 1 },
      ],
    },
  ];
  state.rolls = [99];
  const inspired = await dreamOnce();
  assert.equal(inspired?.input.profileId, "flux");
  assert.equal(inspired?.dream?.arm, "explore:prompt");
  assert.deepEqual(inspired?.input.loras, [
    { name: "fox.safetensors", strength: 0.7, enabled: true },
  ]);
  assert.match(state.calls.at(-1)!.user, /Inspiration prompt: a lighthouse in a storm/);
  assert.match(state.calls.at(-1)!.system, /Start from the inspiration prompt/);
  assert.equal(inspired?.dream?.why, "Inspired by an import · You star foxes.");
  // Without an import, an explored prompt goes beyond their taste on the profile it drew.
  state.access.alice!.uncensored = false;
  state.loras = {};
  state.rolls = [99];
  await dreamOnce();
  state.rolls = [99];
  const beyond = await dreamOnce();
  assert.deepEqual([beyond?.input.profileId, beyond?.dream?.arm], ["qwen", "explore:prompt"]);
  assert.doesNotMatch(state.calls.at(-1)!.user, /Inspiration/);
  assert.match(state.calls.at(-1)!.system, /Explore this time: go beyond their taste profile/);
});

test("Dream skips unavailable accounts and offline services, logging each reason once", async (t) => {
  const { dream, state, dreamJobs } = fixture(t);
  await dream.save("alice", { enabled: true });
  const alice = state.access.alice;
  state.access.alice = null;
  await dream.tick();
  await dream.tick();
  assert.equal(dreamJobs().length, 0);
  assert.deepEqual(dream.status("alice"), {
    status: "unavailable",
    reason: "This account is unavailable.",
  });
  assert.equal(state.logs.length, 1);
  state.access.alice = alice;
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
    /^The image worker is stopped: an administrator can start it/,
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
  assert.match(dream.status("alice").reason!, /^The image worker is stopped/);
  state.online.image = true;
  await dream.tick();
  assert.equal(dreamJobs("alice").filter((job) => job.status === "queued").length, 1);
  await dream.save("alice", { paused: true });
  assert.ok(dreamJobs("alice").every((job) => job.status === "cancelled"));
  assert.equal(dream.status("alice").status, "paused");
  await dream.tick();
  assert.equal(state.logs.at(-1), "[Studio] Dream skips account alice: Paused.");
});

/** Serves the Dream routes; `request` answers as the user named in its last argument. */
async function serve(
  t: TestContext,
  { dream, projects }: Pick<ReturnType<typeof fixture>, "dream" | "projects">,
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { studioAccount: { userId: String(req.headers["x-user"]), role: "user" } });
    next();
  });
  registerDreamRoutes(app as never, { dream, projects });
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
  const fx = fixture(t);
  const { dream, store, state, taste, dreamOnce } = fx;
  await dream.save("alice", { enabled: true });
  const job = (await dreamOnce())!;
  await dreamOnce();
  await dreamOnce();
  const request = await serve(t, fx);
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

  assert.equal((await request("/settings", { dailyImages: -1 }, "PUT")).status, 400);
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
    taste.read("alice").signals.map((signal) => [signal.kind, signal.jobId, signal.arm]),
    [
      ["discard", state.items.find((item) => item.prompt === "dream 2")?.jobId, "exploit"],
      ["keep", job.id, "exploit"],
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
  assert.notEqual(variation.sessionId, store.job("alice", job.id)?.sessionId);
  assert.equal((await request("")).body.unseen.length, 0);
  // A gone or disabled account's Dream is closed.
  state.access.alice = null;
  assert.equal((await request("")).status, 403);
});

test("Dream's ideas take the account's projects in turn and While You Were Away groups them", async (t) => {
  const fx = fixture(t);
  const { dream, state, projects, dreamOnce } = fx;
  await dream.save("alice", { enabled: true });
  const beach = projects.create("alice", {
    name: "Beach",
    brief: { subjects: "the sea", avoid: "people" },
  });
  const city = projects.create("alice", { name: "City" });
  for (let index = 0; index < 3; index++) await dreamOnce();
  assert.deepEqual(
    state.items.map((item) => item.dream?.projectId),
    [beach.id, city.id, beach.id],
  );
  // The brief steers the writer; a project without one adds nothing.
  assert.match(
    state.calls[0].user,
    /Project brief \(Beach\):\n- Subjects: the sea\n- Avoid: people/,
  );
  assert.match(state.calls[0].system, /keep to its brief/);
  assert.doesNotMatch(state.calls[1].user, /Project brief/);

  const [last, , first] = state.items;
  last.review = { score: 9, miss: "", model: "m", at: "" };
  first.review = { score: 2, miss: "people", model: "m", at: "" };
  const request = await serve(t, fx);
  const shown = (await request("")).body;
  assert.deepEqual(
    shown.digest.map((group: { name: string; items: DreamItem[]; misses: DreamItem[] }) => [
      group.name,
      group.items.map((item) => item.prompt),
      group.misses.map((item) => item.prompt),
    ]),
    [
      ["Beach", ["dream 3"], ["dream 1"]],
      ["City", ["dream 2"], []],
    ],
  );

  // A visit answers when the one before it ended; views within half an hour are one visit.
  assert.equal(shown.since, null);
  assert.equal((await request("/visit", {})).body.since, null);
  const firstVisit = new Date(state.clock).toISOString();
  state.clock += 10 * 60_000;
  assert.equal((await request("/visit", {})).body.since, null);
  state.clock += 31 * 60_000;
  assert.equal(
    (await request("/visit", {})).body.since,
    new Date(Date.parse(firstVisit) + 10 * 60_000).toISOString(),
  );
  assert.equal((await request("")).body.since, (await request("/visit", {})).body.since);
});

test("A quiet chat hands its project to Dream, which continues its work one axis at a time", async (t) => {
  const { dream, state, store, projects, dreamOnce } = fixture(t);
  await dream.save("alice", { enabled: true });
  const beach = projects.create("alice", { name: "Beach", brief: { avoid: "crowds" } });
  projects.attach("alice", "chat-1", beach.id);
  /** An image the chat made, with the input it ran with. */
  const chatImage = (id: string, prompt: string, extra: Partial<DreamItem> = {}) => {
    const input = {
      kind: "image",
      prompt,
      profileId: "flux",
      steps: 20,
      width: 832,
      height: 1216,
      loras: [
        { name: "fox.safetensors", strength: 0.8, enabled: true },
        { name: "klein.safetensors", strength: 1, enabled: true },
      ],
      referenceAssets: [{ assetId: "character", slot: "reference" }],
    };
    const session = store.createSession("alice", "Chat").id;
    const job = store.enqueue("alice", session, input, "image", undefined, "worker:image", id);
    store.save({ ...job, status: "completed" });
    state.items.push({
      id,
      jobId: job.id,
      ownerId: "alice",
      type: "image",
      status: "done",
      prompt,
      chat: { conversationId: "chat-1" },
      ...extra,
    });
  };
  chatImage("seed", "a fox on a beach at dawn", { favorite: true });

  // The chat asked for something within the hour: it keeps its project.
  const held = await dreamOnce();
  assert.equal(held?.dream?.projectId, undefined);
  assert.equal(held?.dream?.arm, "exploit");

  state.clock += 61 * 60_000;
  const scene = await dreamOnce();
  assert.equal(scene?.dream?.projectId, beach.id);
  assert.equal(scene?.dream?.arm, "continue:scene");
  assert.match(String(scene?.dream?.why), /^Continuing Beach: new scene · /);
  // On the seed's profile, with its settings, the LoRAs that still fit and its references.
  assert.deepEqual(
    [scene?.input.profileId, scene?.input.steps, scene?.input.width, scene?.input.height],
    ["flux", 20, 832, 1216],
  );
  assert.deepEqual(scene?.input.loras, [{ name: "fox.safetensors", strength: 0.8, enabled: true }]);
  assert.deepEqual(scene?.input.referenceAssets, [{ assetId: "character", slot: "reference" }]);
  const call = state.calls.at(-1)!;
  assert.match(call.system, /change only the scene/);
  assert.match(call.system, /safe for work/);
  assert.match(call.user, /Seed prompt: a fox on a beach at dawn/);
  assert.match(call.user, /- Avoid: crowds/);
  assert.doesNotMatch(call.user, /Recent Dream ideas/);

  // The axes take turns.
  const outfit = await dreamOnce();
  assert.equal(outfit?.dream?.arm, "continue:outfit");
  assert.match(state.calls.at(-1)!.system, /change only the outfit/);

  // A new request takes the project back for the next hour.
  projects.activity("alice", "chat-1");
  assert.equal((await dreamOnce())?.dream?.projectId, undefined);
});

test("The explore share starts at a fifth and leans toward whichever side the person keeps", async (t) => {
  const { dream, state, dreamOnce } = fixture(t);
  await dream.save("alice", { enabled: true });
  // At a fifth, a roll of 70 of 100 exploits.
  state.rolls = [70];
  assert.equal((await dreamOnce())?.dream?.arm, "exploit");
  let made = 0;
  const keep = (arm: string, pair = false) => {
    const id = `kept-${made++}`;
    state.items.push({
      id,
      ownerId: "alice",
      type: "image",
      status: "done",
      dream: {
        state: "unseen",
        prompt: "p",
        why: "",
        at: "",
        arm,
        ...(pair
          ? {
              pair: {
                id: "pair",
                side: 0 as const,
                question: "",
                axis: "steps",
                label: "",
                value: 1,
              },
            }
          : {}),
      },
    });
    dream.keep("alice", id);
    return dream.read("alice").explore;
  };
  assert.equal(keep("explore:prompt"), 0.22);
  assert.equal(keep("continue:pose"), 0.2);
  assert.equal(keep("exploit"), 0.18);
  // A comparison's side asks something else, and leaves the share as it was.
  assert.equal(keep("explore:steps", true), 0.18);
  for (let index = 0; index < 30; index++) keep("explore:lora");
  assert.equal(dream.read("alice").explore, 0.5);
  state.rolls = [70];
  assert.match(String((await dreamOnce())?.dream?.arm), /^explore:/);
  for (let index = 0; index < 40; index++) keep("exploit");
  assert.equal(dream.read("alice").explore, 0.05);
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

test("Dream deletes discards after 30 days, and Delete All deletes an account's others", async (t) => {
  const fx = fixture(t);
  const { dream, state } = fx;
  const daysAgo = (days: number) => new Date(state.clock - days * 86_400_000).toISOString();
  const item = (id: string, ownerId: string, days: number, mark: "discarded" | "kept") => ({
    id,
    ownerId,
    type: "image",
    status: "done",
    dream: { prompt: "p", why: "", at: daysAgo(days), state: mark, decidedAt: daysAgo(days) },
  });
  state.items.push(
    item("old", "alice", 31, "discarded"),
    item("recent", "alice", 2, "discarded"),
    item("older", "alice", 1, "discarded"),
    item("kept", "alice", 90, "kept"),
    item("bob-old", "bob", 40, "discarded"),
    item("bob-recent", "bob", 1, "discarded"),
  );
  await dream.tick();
  const ids = () => state.items.map((entry) => entry.id);
  assert.deepEqual(ids(), ["recent", "older", "kept", "bob-recent"]);
  assert.deepEqual(
    dream.discarded("alice").map((entry) => entry.id),
    ["older", "recent"],
  );
  const request = await serve(t, fx);
  assert.deepEqual((await request("/discarded", {}, "DELETE")).body, { deleted: 2 });
  assert.deepEqual(ids(), ["kept", "bob-recent"]);
});

test("Calibration offers the account's older Studio generations, unjudged first, and only teaches the taste profile", async (t) => {
  const fx = fixture(t);
  const { state, taste, generated } = fx;
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
  const request = await serve(t, fx);
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

test("Dream loads a LoRA drawn by taste and thumbs up, at its learnt strength, and explores untried ones", async (t) => {
  const { dream, state, store, taste, dreamOnce } = fixture(t, [profiles[0]]);
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
    strengths: { "family:flux": { "film.safetensors": 0.6 } },
  };
  const loras = (job: { id: string }) =>
    (store.job("alice", job.id)!.input.loras as { name: string; strength: number }[]).map(
      (lora) => [lora.name, lora.strength],
    );
  // Thumbs up alone: the first of those alike, at its saved strength.
  assert.deepEqual(loras((await dreamOnce())!), [["fox.safetensors", 1]]);
  // A liked result with film at 0.8 outweighs it, at the strength it was liked at.
  taste.record("alice", [
    tasteSignal("keep", "liked", {
      profileId: "flux",
      loras: [{ name: "film.safetensors", strength: 0.8 }],
    }),
  ]);
  assert.deepEqual(loras((await dreamOnce())!), [["film.safetensors", 0.8]]);
  assert.match(state.calls.at(-1)!.user, /loads these LoRAs: film\.safetensors/);
  // An explored idea tries an unrated LoRA no result has taught yet, and the why line says so.
  delete state.loras.alice.ratings["ink.safetensors"];
  state.rolls = [99];
  const tried = (await dreamOnce())!;
  assert.deepEqual(loras(tried), [["ink.safetensors", 1]]);
  assert.equal(tried.dream?.arm, "explore:lora");
  assert.match(String(tried.dream?.why), /^Testing ink · /);
  // Without LoRA access nothing is added.
  state.loras = {};
  const next = (await dreamOnce())!;
  assert.deepEqual(store.job("alice", next.id)!.input.loras, []);
});

test("an exploited idea draws its steps, guidance and aspect ratio by taste", async (t) => {
  const { dream, taste, dreamOnce } = fixture(t, [
    { ...profiles[0], capabilities: { steps: true } },
  ]);
  taste.record("alice", [
    tasteSignal("star", "a", { profileId: "flux", steps: 28, cfg: 3.4, width: 832, height: 1216 }),
    tasteSignal("discard", "b", { profileId: "flux", steps: 12, cfg: 7, width: 1216, height: 832 }),
  ]);
  await dream.save("alice", { enabled: true });
  const job = (await dreamOnce())!;
  assert.deepEqual(
    [job.input.steps, job.input.cfg, job.input.width, job.input.height],
    [28, 3.5, 832, 1216],
  );
});

test("Dream compares steps only on a profile with a steps control, and what taste is least sure of", async (t) => {
  const asked = async (capabilities: DreamProfile["capabilities"], judged = 0) => {
    const { dream, state, store, taste, live, dreamOnce } = fixture(t, [
      { id: "flux", kind: "image", label: "FLUX", capabilities },
    ]);
    const session = store.createSession("alice", "Gallery").id;
    const base = store.enqueue(
      "alice",
      session,
      { kind: "image", profileId: "flux", prompt: "a fox in snow", steps: 20 },
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
    for (let index = 0; index < judged; index++)
      taste.record("alice", [
        tasteSignal("star", `judged-${index}`, { profileId: "flux", steps: index % 2 ? 10 : 20 }),
      ]);
    await dream.save("alice", { enabled: true, dailyImages: 10 });
    for (let made = 0; made < 3; made++) assert.ok(await dreamOnce());
    await dream.tick();
    return live("alice")[0].dream?.pair?.question;
  };
  // With one profile and no LoRAs, Steps comes first when offered and Wording otherwise.
  assert.equal(await asked({ steps: true }), "Which Steps?");
  assert.equal(await asked({ steps: false }), "Which Wording?");
  assert.equal(await asked(undefined), "Which Wording?");
  // Once results taught 20 and 10 steps, wording is what taste knows least.
  assert.equal(await asked({ steps: true }, 2), "Which Wording?");
});

test("Every fourth image compares one thing on a kept image's prompt; answers keep, discard and teach", async (t) => {
  const fx = fixture(t);
  const { dream, state, store, taste, finish, live, dreamOnce } = fx;
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
        {
          id: a.dream!.pair!.id,
          side: 0,
          question: "Which Model?",
          axis: "profile",
          label: "FLUX",
          value: "flux",
        },
      ],
      [
        "qwen",
        "a fox in snow",
        "0",
        {
          id: a.dream!.pair!.id,
          side: 1,
          question: "Which Model?",
          axis: "profile",
          label: "Qwen",
          value: "qwen",
        },
      ],
    ],
  );
  // One side waits for the other before the pair shows.
  finish("alice", a.id);
  assert.ok(!dream.unseen("alice").some((item) => item.dream?.pair));
  finish("alice", b.id);
  assert.equal(dream.unseen("alice").filter((item) => item.dream?.pair).length, 2);

  const request = await serve(t, fx);
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
  assert.deepEqual(
    [signal.axis, signal.value, signal.over?.value, signal.arm],
    ["profile", "qwen", "flux", "explore:profile"],
  );
  // The same image never starts a second comparison.
  assert.deepEqual(dream.read("alice").compared, ["base"]);

  // More Like This keeps the result and steers the next ideas toward it.
  const [next] = dream.unseen("alice");
  assert.equal((await request(`/${next.id}/more`, {})).status, 200);
  const steered = (await dreamOnce())!;
  assert.equal((steered.input.writing as { like?: string }).like, next.prompt);
  assert.match(state.calls.at(-1)!.user, new RegExp(`More like this one: ${next.prompt}`));
  assert.equal(dream.read("alice").steer?.remaining, 1);
});

test("A Dream job's writing request keeps its own fields through admission", () => {
  const request = dreamRequest({
    kind: "dream",
    project: "beach",
    seed: "a red kite",
    vary: "scene",
    note: "Continuing Beach",
    explore: true,
    extend: true,
    source: "a clip",
    series: {
      id: "set-1",
      character: "Mara: red hair",
      place: "a diner",
      night: "midnight",
      index: 1,
      length: 4,
    },
    loras: ["fox.safetensors", 3],
    prompt: "already written",
  });
  assert.deepEqual(request, {
    kind: "dream",
    explore: true,
    extend: true,
    source: "a clip",
    note: "Continuing Beach",
    project: "beach",
    seed: "a red kite",
    vary: "scene",
    series: {
      id: "set-1",
      character: "Mara: red hair",
      place: "a diner",
      night: "midnight",
      index: 1,
      length: 4,
    },
    loras: ["fox.safetensors"],
  });
});

test("Suggestions recur in two liked results, keep within a card's limits and the 18+ floor, and never repeat a card", () => {
  const liked = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const found = suggestionsFrom(
    {
      suggestions: [
        { kind: "Character", name: "Mara", description: "red hair, freckles", results: [1, 3, 3] },
        { kind: "outfit", name: "Green Cloak", description: "a long green cloak", results: [2] },
        { kind: "scene", name: "Diner", description: "an all-night diner", results: [1, 9] },
        { kind: "character", name: "Kid", description: "a 16 year old", results: [1, 2] },
        { kind: "scene", name: "Harbour", description: "a harbour at dusk", results: [2, 3] },
        { kind: "scene", name: "harbour", description: "the same harbour", results: [1, 2] },
        { kind: "outfit", name: "Mara", description: "", results: [1, 2] },
        { kind: "prop", name: "Lamp", description: "a brass lamp", results: [1, 2] },
      ],
    },
    {
      liked,
      taken: new Set(["characters:ava"]),
      minorAge: (text) => /\b16\b/.exec(text)?.[0] || "",
      at: "now",
    },
  );
  assert.deepEqual(
    found.map(({ kind, name, itemIds }) => [kind, name, itemIds]),
    [
      ["characters", "Mara", ["a", "c"]],
      ["scenes", "Harbour", ["b", "c"]],
    ],
  );
  assert.deepEqual(
    suggestionsFrom(
      {
        suggestions: [
          { kind: "character", name: "Ava", description: "dark hair", results: [1, 2] },
        ],
      },
      { liked, taken: new Set(["characters:ava"]), minorAge: () => "", at: "now" },
    ),
    [],
  );
  assert.deepEqual(
    suggestionsFrom("nonsense", { liked, taken: new Set(), minorAge: () => "", at: "" }),
    [],
  );
});

test("Dream suggests recurring cards from liked results once a day; Accept makes the card and Dismiss turns it down", async (t) => {
  const fx = fixture(t);
  const { dream, state, generated } = fx;
  const liked = (id: string, prompt: string) => ({
    id,
    ownerId: "alice",
    type: "image",
    status: "done",
    prompt,
    favorite: true,
    jobId: `job-${id}`,
  });
  generated(...["1", "2", "3", "4", "5"].map((id) => liked(id, `Mara on a rooftop ${id}`)));
  await dream.save("alice", { enabled: true, dailyImages: 0 });
  state.suggestions = {
    suggestions: [
      { kind: "character", name: "Mara", description: "red hair, freckles", results: [1, 2, 3] },
      { kind: "scene", name: "Rooftop", description: "a city rooftop at night", results: [2, 4] },
    ],
  };
  // Five liked results are too few to look for what recurs.
  await dream.tick();
  assert.equal(dream.suggestions("alice").length, 0);
  generated(liked("6", "Mara on a rooftop 6"));
  await dream.tick();
  const asked = state.calls.filter((call) => call.system.startsWith("You find what recurs"));
  assert.equal(asked.length, 1);
  assert.match(asked[0].system, /18 or older/);
  assert.match(
    asked[0].user,
    /Liked images:\n\[1\] Mara on a rooftop 1\n\[2\] Mara on a rooftop 2/,
  );
  const [mara, rooftop] = dream.suggestions("alice");
  assert.deepEqual(
    [mara.kind, mara.name, mara.items.map((item) => item.id)],
    ["characters", "Mara", ["1", "2", "3"]],
  );
  // Once a day.
  await dream.tick();
  assert.equal(state.calls.filter((call) => call.system.startsWith("You find")).length, 1);

  const request = await serve(t, fx);
  const accepted = await request(`/suggestions/${mara.id}/accept`, {});
  assert.equal(accepted.status, 200);
  assert.deepEqual(state.cards!.characters, [
    {
      id: "characters-1",
      name: "Mara",
      description: "red hair, freckles",
      referenceIds: ["asset-1", "asset-2", "asset-3"],
    },
  ]);
  assert.equal((await request(`/suggestions/${rooftop.id}/dismiss`, {})).status, 200);
  assert.equal((await request(`/suggestions/${rooftop.id}/dismiss`, {})).status, 404);
  assert.deepEqual((await request("/suggestions")).body.suggestions, []);
  // A day later neither is proposed again, and the writer hears they were taken or turned down.
  state.clock += 86_400_000;
  await dream.tick();
  const again = state.calls.filter((call) => call.system.startsWith("You find")).at(-1)!;
  assert.match(again.user, /- character: Mara/);
  assert.match(again.user, /- scenes:rooftop/);
  assert.equal(dream.suggestions("alice").length, 0);
  // Without Characters there is nothing to suggest or accept.
  state.cards = null;
  assert.deepEqual(dream.suggestions("alice"), []);
});

test("A series keeps one character in one place and night across a result set, then ends", async (t) => {
  const editing: DreamProfile = {
    id: "qwen-edit",
    kind: "image",
    label: "Qwen Edit",
    editReferences: true,
    mediaInputs: [{ id: "image1" }],
  };
  const { dream, state, store, dreamOnce } = fixture(t, [...profiles, editing]);
  state.cards!.characters.push({
    id: "chr-mara",
    name: "Mara",
    description: "red hair, freckles",
    referenceIds: ["mara-front"],
    createdAt: "",
    updatedAt: "",
  });
  await dream.save("alice", { enabled: true });
  const jobs = [];
  for (let index = 0; index < 4; index++) jobs.push((await dreamOnce())!);
  const sets = jobs.map(
    (job) => job.input.resultSet as { id: string; title: string; index: number },
  );
  assert.equal(new Set(sets.map((set) => set.id)).size, 1);
  assert.deepEqual(
    sets.map((set) => [set.title, set.index]),
    [0, 1, 2, 3].map((index) => ["Mara · Rooftop Bar, Dusk", index]),
  );
  for (const job of jobs) {
    assert.equal(job.input.profileId, "qwen-edit");
    assert.deepEqual(job.input.referenceAssets, [{ assetId: "mara-front", slot: "image1" }]);
    assert.equal(job.dream?.arm, "series");
  }
  const written = state.calls.slice(-4);
  assert.match(written[0].system, /result 1 of 4 in a series/);
  assert.match(
    written[0].user,
    /Character: Mara: red hair, freckles\nPlace: a rooftop bar above the city\nTime of night: dusk/,
  );
  // Each result hears the ones before it, so it is a new moment.
  assert.match(written[3].user, /Results so far:\n- dream 1\n- dream 2\n- dream 3/);
  assert.match(store.job("alice", jobs[0].id)!.dream!.why, /^Mara · Rooftop Bar, Dusk \(1 of 4\)/);
  // The series is done; with a share's roll against it the next idea is an ordinary one.
  state.rolls = [99];
  const after = await dreamOnce();
  assert.equal(after?.input.resultSet, undefined);
  // A series whose character is deleted ends.
  state.rolls = [];
  await dreamOnce();
  state.cards!.characters = [];
  const next = await dreamOnce();
  assert.equal(next?.input.resultSet, undefined);
  assert.equal(dream.read("alice").series, undefined);
});

test("Dream videos animate the best-reviewed still and extend kept videos, each once, where the account prefers videos to run", async (t) => {
  const grok: DreamProfile = {
    id: "grok",
    kind: "video",
    label: "Grok",
    mediaInputs: [{ id: "frame", role: "start" }],
  };
  const { dream, state, generated, dreamOnce } = fixture(t, [...profiles, grok]);
  const frameOf = (job: Awaited<ReturnType<typeof dreamOnce>>) =>
    (job!.input.referenceAssets as { assetId: string; slot: string }[])[0];
  await dream.save("alice", { enabled: true, dailyImages: 0, videos: true, dailyVideos: 10 });
  generated({
    id: "starred",
    ownerId: "alice",
    type: "image",
    status: "done",
    prompt: "a starred still",
    favorite: true,
  });
  const dreamed = (id: string, score: number, miss = "") =>
    state.items.push({
      id,
      ownerId: "alice",
      type: "image",
      status: "done",
      prompt: `still ${id}`,
      jobId: `job-${id}`,
      dream: { prompt: "", why: "", at: "", state: "unseen", projectId: "beach" },
      review: { score, miss, model: "m", at: "" },
    });
  dreamed("good", 7);
  dreamed("best", 9);
  dreamed("miss", 3, "indoors");
  const first = await dreamOnce();
  assert.deepEqual(first?.input.referenceAssets, [
    { assetId: "asset-best", source: "gallery", slot: "start" },
  ]);
  assert.equal(first?.dream?.arm, "animate");
  assert.equal(first?.dream?.projectId, "beach");
  assert.match(state.calls.at(-1)!.user, /first frame was made from: still best/);
  assert.equal(frameOf(await dreamOnce()).assetId, "asset-good");
  assert.equal(frameOf(await dreamOnce()).assetId, "asset-starred");
  // Each still is animated once; a miss never is.
  assert.equal(await dreamOnce(), undefined);
  assert.match(
    dream.status("alice").reason!,
    /^Dream videos animate a kept, starred or well-reviewed image/,
  );

  // A kept video is extended from its last frame on its own model, never an extension again.
  generated({
    id: "clip",
    ownerId: "alice",
    type: "video",
    status: "done",
    prompt: "a clip",
    favorite: true,
    settings: { profileId: "wan" },
  });
  const extension = await dreamOnce();
  assert.deepEqual(extension?.input.referenceAssets, [
    { assetId: "last-frame-clip", source: "gallery", slot: "start" },
  ]);
  assert.equal(extension?.dream?.arm, "extend");
  assert.match(state.calls.at(-1)!.system, /continues one of their clips from its last frame/);
  assert.match(state.calls.at(-1)!.user, /clip so far was made from: a clip/);
  assert.equal(await dreamOnce(), undefined);

  // Cloud runs without the local video worker, and a fallback says where it ran.
  dreamed("later", 8);
  state.online.video = false;
  state.video = {
    id: "grok",
    cloud: true,
    note: "Local video isn't running, so this runs on Grok.",
  };
  const cloud = await dreamOnce();
  assert.equal(cloud?.input.profileId, "grok");
  assert.equal(frameOf(cloud).slot, "frame");
  assert.match(cloud!.dream!.why, /^Local video isn't running, so this runs on Grok\./);
  dreamed("last", 8);
  state.video = { id: "wan", cloud: false, note: "" };
  assert.equal(await dreamOnce(), undefined);
  assert.equal(dream.status("alice").reason, "The video worker is offline.");
  state.online.video = true;
  state.videoRefusal = "No video profile that takes a starting image is available to this account.";
  assert.equal(await dreamOnce(), undefined);
  assert.equal(dream.status("alice").reason, state.videoRefusal);
});
