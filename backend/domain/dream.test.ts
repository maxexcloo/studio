import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import express from "express";

import type { CardKind, Character, ResultContext } from "../../shared/characters.ts";
import { type DreamSettings, dreamDefaults, dreamTimingSettings } from "../../shared/dream.ts";
import { dreamVideoProfile } from "../animate-profile.js";
import {
  closeRuntimeDatabase,
  openDatabase,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "../persistence/runtime.ts";
import { createGenerationAdmission } from "./admission.ts";
import { registerDreamRoutes } from "./dream-routes.ts";
import {
  type DreamAccess,
  type DreamInspiration,
  type DreamItem,
  type DreamLoraLibrary,
  type DreamProfile,
  createDream,
  dreamRequest,
  turnShares,
} from "./dream.ts";
import { createInbox, ideasFrom } from "./inbox.ts";
import type { Issue } from "./issues.ts";
import { createProjects } from "./projects.ts";
import { type GenerationQueue, writtenJob } from "./queue.ts";
import { registerQueueRoutes } from "./routes.ts";
import { Store, queuePriority } from "./store.ts";
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
  const projects = createProjects({
    cards: (ownerId) => (ownerId === "alice" ? state.cards : null),
    dataDir,
    now: () => state.clock,
  });
  const state = {
    owners: ["alice", "bob"],
    overrides: {} as Partial<DreamSettings>,
    idleMinutes: {
      image: dreamTimingSettings.imageIdleMinutes.defaultValue,
      video: dreamTimingSettings.videoIdleMinutes.defaultValue,
    },
    clock: Date.now(),
    items: [] as DreamItem[],
    reads: [] as Record<string, unknown>[],
    access: Object.fromEntries(
      ["alice", "bob"].map((userId) => [
        userId,
        { ...everything, account: { userId, role: "user" } },
      ]),
    ) as Record<string, DreamAccess | null>,
    onlineCalls: [] as { kind: string; backend: string }[],
    online: { cloud: true, text: true, image: true, video: true } as Record<
      string,
      boolean | "parked"
    >,
    slots: 1,
    prompts: 0,
    writingRefusal: "",
    replies: [] as {
      prompt: string;
      title?: string;
      motifs?: string[];
      cardContext?: ResultContext;
    }[],
    calls: [] as { model: string; system: string; user: string }[],
    logs: [] as string[],
    loras: {} as Record<string, DreamLoraLibrary>,
    inspiration: [] as DreamInspiration[],
    /** Rolls for the next chance draws (out of 100); every other draw is 0. */
    rolls: [] as number[],
    /** The next draws out of other sizes; every other draw is 0. */
    draws: {} as Record<number, number[]>,
    /** The account's cards, or null without Characters. */
    cards: { characters: [], outfits: [], scenes: [] } as Record<CardKind, Character[]> | null,
    /** The local video profile Dream would choose, or why none can. */
    video: "wan",
    videoRefusal: "",
    ratingRefused: false,
    /** The negative prompt each profile's guide recommends. */
    negatives: {} as Record<string, string>,
    /** Gallery items deleted or hidden since Dream listed them, which can't be referenced. */
    gone: new Set<string>(),
    /** How alike two images are, as Image Search's vectors would say. */
    likeness: (_a: DreamItem, _b: DreamItem): number | undefined => undefined,
    /** The text model's reply when asked for new projects and cards, and for brief edits. */
    ideas: { projects: [], cards: [] } as unknown,
    edits: { edits: [] } as unknown,
    /** Recurring issues and their rules (domain/issues.ts). */
    issues: [] as Issue[],
  };
  const writer = {
    model: async () => {
      if (state.writingRefusal) throw new Error(state.writingRefusal);
      return "writer";
    },
    chat: async ({
      model,
      messages,
    }: {
      model: string;
      messages: { role: "system" | "user"; content: string }[];
    }) => {
      state.calls.push({ model, system: messages[0].content, user: messages[1].content });
      if (messages[0].content.startsWith("You find what recurs"))
        return { text: JSON.stringify(state.ideas) };
      if (messages[0].content.startsWith("You improve the briefs"))
        return { text: JSON.stringify(state.edits) };
      state.prompts++;
      return {
        text: JSON.stringify({
          prompt: `dream ${state.prompts}`,
          why: "You like foxes.",
          title: `Fox Dream ${state.prompts}`,
          ...state.replies.shift(),
        }),
      };
    },
  };
  const admission = createGenerationAdmission({
    store,
    queue: { tick: async () => undefined } as unknown as GenerationQueue,
    validate: async () => ({ status: 200, payload: { ok: true } }),
    resourceFor: async (input) =>
      catalogue.find((profile) => profile.id === input.profileId)?.provider === "cliproxyapi"
        ? "provider:cliproxyapi"
        : `worker:${input.kind === "video" ? "video" : "image"}`,
    pendingItems: (id, input) => [
      { id: `${id}-0`, jobId: id, status: "pending", prompt: input.prompt },
    ],
    revision: () => 0,
  });
  const eligibleJob = (ownerId: string, item: DreamItem, query: Record<string, any>) => {
    if (!query.ownGeneration) return true;
    const input = item.jobId && store.jobInput(ownerId, item.jobId);
    return Boolean(
      input &&
      (!query.promptedProfiles ||
        (typeof input.prompt === "string" &&
          input.prompt.trim() &&
          query.promptedProfiles.includes(input.profileId))),
    );
  };
  // Narrows as gallery/store.js's queries do, so each read takes only what it asks for.
  const matching = (ownerId: string, query: Record<string, any>) =>
    state.items
      .filter(
        (item) =>
          item.ownerId === ownerId &&
          (query.dreamState === undefined ||
            [query.dreamState].flat().includes(item.dream?.state)) &&
          (query.dreamArm === undefined ||
            [query.dreamArm].flat().some((arm) => item.dream?.arm?.startsWith(arm))) &&
          (query.notDreamArm === undefined || item.dream?.arm !== query.notDreamArm) &&
          (query.dreamPair !== false || !item.dream?.pair) &&
          (!query.dreamPassReason || item.dream?.passReason === query.dreamPassReason) &&
          (!query.dreamDecidedSince || (item.dream?.decidedAt || "") >= query.dreamDecidedSince) &&
          (query.dreamProject === undefined || item.dream?.projectId === query.dreamProject) &&
          (!query.liked || item.rating === "liked" || item.dream?.state === "kept") &&
          (!query.rating || item.rating === query.rating) &&
          (query.unlisted === undefined ||
            (item.rating === "disliked" || (!!item.dream && item.dream.state !== "kept")) ===
              query.unlisted) &&
          (!query.type || item.type === query.type) &&
          (!query.status || item.status === query.status) &&
          (!query.conversationIds || query.conversationIds.includes(item.chat?.conversationId)) &&
          (!query.ids || query.ids.includes(String(item.id))) &&
          !query.notIds?.includes(String(item.id)) &&
          (query.dreamDraft === undefined || item.dream?.draft === query.dreamDraft) &&
          eligibleJob(ownerId, item, query) &&
          (query.uploaded === undefined || Boolean(item.uploaded) === query.uploaded) &&
          (query.before === undefined || Date.parse(item.createdAt || "") <= query.before),
      )
      .slice(0, query.sample ?? query.limit);
  const visible = (items: DreamItem[]) =>
    items.filter(
      (item) => item.rating !== "disliked" && (!item.dream || item.dream.state === "kept"),
    );
  const dream = createDream({
    dataDir,
    idleMinutes: (kind) => state.idleMinutes[kind],
    overrides: () => state.overrides,
    store,
    taste,
    projects: (ownerId) => projects.list(ownerId),
    chats: (ownerId) => projects.chats(ownerId),
    owners: () => state.owners,
    access: (ownerId) => state.access[ownerId] ?? null,
    catalogue: async () => ({
      profiles: catalogue,
      defaults: { imageModel: "flux", videoModel: "wan" },
    }),
    online: async (kind, backend) => {
      state.onlineCalls.push({ kind, backend });
      const reach = (value: boolean | "parked") =>
        value === "parked" ? value : value ? "online" : "offline";
      return {
        text: reach(state.online.text),
        media: reach(state.online[backend === "cloud" ? "cloud" : kind]),
      };
    },
    slots: () => state.slots,
    text: () => ({ side: "cloud", uncensored: false }),
    writer,
    guide: () => ({ summary: "natural language" }),
    negative: (profile) => state.negatives[profile.id] ?? "",
    count: (ownerId, query) => matching(ownerId, query).length,
    gallery: (ownerId, query) => {
      state.reads.push(query);
      return matching(ownerId, query);
    },
    unseenReadiness: (ownerId) => matching(ownerId, { dreamState: "unseen" }),
    items: (ownerId, ids) =>
      state.items.filter((item) => item.ownerId === ownerId && ids.includes(String(item.id))),
    visible,
    visibleGenerations: async (ownerId, query) => {
      state.reads.push(query);
      return visible(matching(ownerId, query));
    },
    likeness: (a, b) => state.likeness(a, b),
    mark: (ownerId, itemId, mark, rating) => {
      const item = state.items.find((entry) => entry.ownerId === ownerId && entry.id === itemId)!;
      item.dream = mark;
      item.rating = rating;
    },
    rate: (ownerId, itemId, rating) => {
      if (state.ratingRefused) throw new Error("Rating could not be saved.");
      const item = state.items.find((entry) => entry.ownerId === ownerId && entry.id === itemId)!;
      item.rating = rating ?? undefined;
    },
    remove: (ownerId, itemIds) => {
      state.items = state.items.filter(
        (item) => item.ownerId !== ownerId || !itemIds.includes(String(item.id)),
      );
    },
    loraLibrary: (ownerId) => state.loras[ownerId] ?? null,
    uncensoredLoras: () => new Set(["explicit.safetensors"]),
    // As the LoRA policy would: klein.safetensors is for another model family, and film
    // recommends 0.6.
    fitLoras: (_profile, loras) =>
      loras
        .filter((lora) => lora.name !== "klein.safetensors")
        .map((lora) => ({
          ...lora,
          strength: lora.strength ?? (lora.name === "film.safetensors" ? 0.6 : 1),
        })),
    loraName: (name) => name.replace(/\.safetensors$/, ""),
    inspiration: () => state.inspiration,
    reference: (_account, itemId, frame) => {
      if (state.gone.has(itemId)) throw new Error("That image is no longer in the gallery.");
      return { id: frame ? `${frame}-frame-${itemId}` : `asset-${itemId}`, source: "gallery" };
    },
    // As Animate chooses: an Extend keeps its video's model.
    videoProfile: async (_ownerId, _account, choice) => {
      if (state.videoRefusal) throw new Error(state.videoRefusal);
      return dreamVideoProfile(catalogue, {
        ...choice,
        localRunning: true,
        preferred: { local: state.video, cloud: state.video },
      });
    },
    cards: () => state.cards,
    inbox: {
      propose: (ownerId, account) => inbox.propose(ownerId, account),
      drafts: (ownerId) => inbox.drafts(ownerId),
    },
    minorAge: (text) => /\b16\b/.exec(text)?.[0] || "",
    // Like the queue's writing stage, then the generation route: a Dream job's pending tile
    // carries its written prompt and mark from the queue record.
    admit: async (input, account, scope, origin) => {
      const result = await admission(input, account, scope, origin);
      let job = store.job(account?.userId || "", String(result.payload.jobId))!;
      if (job.status === "writing" && (job.input.writing as { kind?: string }).kind === "dream")
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
        resultSet: input.resultSet as DreamItem["resultSet"],
        ...(job.dream ? { dream: { state: "unseen" as const, ...job.dream } } : {}),
      });
      return result;
    },
    cancel: async (ownerId, jobId) =>
      store.save({ ...store.job(ownerId, jobId)!, status: "cancelled" }),
    now: () => state.clock,
    random: (size) => (size === 100 ? state.rolls : (state.draws[size] ??= [])).shift() ?? 0,
    log: { info: (message) => state.logs.push(message) },
  });
  const inbox = createInbox({
    dataDir,
    projects,
    taste,
    issues: () => state.issues,
    writer,
    text: () => ({ side: "cloud", uncensored: false }),
    online: async () => state.online.text === true,
    cards: () => state.cards,
    createCard: (_account, kind, fields) => {
      const card = { id: `${kind}-${state.cards![kind].length + 1}`, ...fields } as Character;
      state.cards![kind].push(card);
      return card;
    },
    deleteCard: (_ownerId, kind, id) => {
      state.cards![kind] = state.cards![kind].filter((card) => card.id !== id);
    },
    reference: (_account, itemId) => ({ id: `asset-${itemId}` }),
    minorAge: (text) => /\b16\b/.exec(text)?.[0] || "",
    likeness: (a, b) => state.likeness(a, b),
    dream,
    items: (ownerId, ids) =>
      state.items.filter((item) => item.ownerId === ownerId && ids.includes(String(item.id))),
    now: () => state.clock,
  });
  /** Finishes a job and its tile, as saving its outputs would. */
  const finish = (ownerId: string, jobId: string) => {
    store.save({ ...store.job(ownerId, jobId)!, status: "completed" });
    for (const item of state.items) if (item.jobId === jobId) item.status = "done";
  };
  /** Gallery reads not narrowed to Dream results, liked or rated items, chats or ids: walks of the gallery. */
  const walks = () =>
    state.reads.filter(
      (query) =>
        !query.dreamState && !query.liked && !query.rating && !query.conversationIds && !query.ids,
    );
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
    walks,
    dataDir,
    generated,
    projects,
    inbox,
  };
}

test("Dream is off until turned on, queues one hidden job per account only while Studio is idle and waits below other work", async (t) => {
  const { dream, store, admission, dreamJobs, live } = fixture(t);
  assert.deepEqual(dream.read("alice").settings, {
    enabled: false,
    paused: false,
    dailyImages: 40,
    dailyVideos: 4,
    images: true,
    videos: false,
    uncensored: false,
    imageBackend: "local",
    videoBackend: "local",
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
    why: "You like foxes.",
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
  // Turning Dream back on resumes a pause left from before.
  await dream.save("bob", { paused: true });
  assert.equal((await dream.save("bob", { enabled: true })).paused, false);
  await dream.save("bob", { enabled: false });

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
  registerQueueRoutes(app, {
    store,
    admit: async () => ({ status: 500, payload: { error: "Not in this test." } }),
    media: () => [],
    ownsItem: () => false,
    queue: {
      tick: async () => undefined,
      queuePosition: () => undefined,
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
  // Cancel All acts on the person's own work and leaves Dream alone.
  assert.equal((await fetch(`${base}/api/queue/cancel-all`, { method: "POST" })).status, 200);
  assert.equal(store.job("alice", job.id)?.status, "running");
  assert.ok(
    store
      .jobs("alice")
      .filter((job) => job.priority !== queuePriority.dream)
      .every((job) => job.status === "cancelled"),
  );
});

test("Dream gives each account a turn before filling a second slot for any account", async (t) => {
  const { dream, state, live } = fixture(t);
  state.owners.push("cara");
  state.access.cara = { ...state.access.alice!, account: { userId: "cara", role: "user" } };
  state.slots = 2;
  for (const owner of state.owners) await dream.save(owner, { enabled: true });
  await dream.tick();
  assert.deepEqual(
    live().map((job) => job.ownerId),
    ["alice", "bob", "cara", "alice", "bob", "cara"],
  );
});

test("Dream fills every free worker in one tick: images beside running work, videos one at a time and only while idle", async (t) => {
  const { dream, store, state, dreamJobs, live, finish } = fixture(t);
  state.slots = 2;
  await dream.save("alice", { enabled: true });
  await dream.tick();
  assert.equal(live("alice").length, 2);
  // A third waits for a worker.
  await dream.tick();
  assert.equal(dreamJobs("alice").length, 2);
  assert.equal(dream.status("alice").status, "generating");
  for (const job of live("alice")) finish("alice", job.id);

  // Someone's running work leaves the other GPU to Dream's images, never a video.
  dream.keep("alice", String(dream.unseen("alice")[0].id));
  await dream.save("alice", { videos: true, dailyVideos: 10 });
  const session = store.createSession("bob");
  const bob = store.enqueue("bob", session.id, { prompt: "mine" }, "image");
  store.save({ ...bob, status: "running" });
  await dream.tick();
  // The third image of the day is a comparison, two jobs at once.
  assert.deepEqual(
    live("alice").map((job) => job.input.kind),
    ["image", "image", "image"],
  );
  for (const job of live("alice")) finish("alice", job.id);
  store.save({ ...store.job("bob", bob.id)!, status: "completed" });

  // Idle, Dream makes the last image of its allowance before filling the other slot with a video.
  await dream.save("alice", { dailyImages: dream.today("alice").images + 1 });
  await dream.tick();
  assert.deepEqual(
    live("alice").map((job) => job.input.kind),
    ["image", "video"],
  );
});

test("Dream applies shared delays to the owner's manual and MCP generation requests", async (t) => {
  const { dream, store, state, generated, live, finish } = fixture(t, profiles);
  t.mock.timers.enable({ apis: ["Date"], now: state.clock });
  const advance = (ms: number) => {
    state.clock += ms;
    t.mock.timers.setTime(state.clock);
  };
  state.idleMinutes.image = 1;
  await dream.save("alice", { enabled: true, videos: true, dailyImages: 1 });
  generated({
    id: "liked-still",
    ownerId: "alice",
    type: "image",
    status: "done",
    prompt: "A fox",
    rating: "liked",
  });
  await dream.tick();
  assert.equal(live("alice").length, 0);
  assert.equal(dream.status("alice").status, "waiting");

  advance(60_000);
  await dream.tick();
  assert.equal(live("alice")[0]?.input.kind, "image");
  finish("alice", live("alice")[0].id);

  const done = (owner: string, priority: number, operation: "image" | "upscale" = "image") => {
    const job = store.enqueue(
      owner,
      store.createSession(owner).id,
      { kind: "image" },
      operation,
      undefined,
      undefined,
      undefined,
      { priority },
    );
    store.save({ ...job, status: "completed" });
  };
  done("alice", queuePriority.mcp);
  advance(5 * 60_000 - 1);
  done("bob", queuePriority.manual);
  done("alice", queuePriority.manual, "upscale");
  done("alice", queuePriority.dream);
  await dream.tick();
  assert.equal(live("alice").length, 0);
  assert.match(dream.status("alice").reason || "", /Dream videos wait 5 minutes/);
  advance(1);
  await dream.tick();
  assert.equal(live("alice")[0]?.input.kind, "video");
});

test("A finished Dream job starts the next at once, without waiting for the next tick", async (t) => {
  const { dream, live, finish } = fixture(t);
  await dream.save("alice", { enabled: true });
  await dream.tick();
  dream.start();
  t.after(() => dream.stop());
  finish("alice", live("alice")[0].id);
  dream.finished();
  for (let turn = 0; turn < 100 && !live("alice").length; turn++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(live("alice").length, 1);
});

test("Dream stops at today's cap per kind, however much waits unseen, and animates kept or liked images", async (t) => {
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

  // With Images off, videos still animate a kept or liked image with the default video profile.
  await dream.save("alice", { images: false, videos: true, dailyVideos: 1 });
  const video = await dreamOnce();
  assert.equal(video?.input.kind, "video");
  assert.equal(video?.input.profileId, "wan");
  assert.deepEqual(video?.input.referenceAssets, [
    { assetId: `asset-${second.id}`, source: "gallery", slot: "start" },
  ]);
  // Animate's writer sees the frame: Dream asks for one coherent shot of it with natural faces.
  const writing = video?.input.writing as Record<string, string>;
  assert.deepEqual([writing.kind, writing.theme, writing.source], ["animate", "custom", "dream 2"]);
  assert.match(writing.instruction, /One continuous shot of one simple, coherent action/);
  assert.match(writing.instruction, /no cuts, scene changes/);
  assert.match(writing.instruction, /believable expressions that suit the moment/);
  assert.equal(await dreamOnce(), undefined);
  assert.equal(dream.status("alice").status, "capped");
  assert.equal(live().length, 0);
});

test("Dream draws a ready profile by its taste, explores concepts alongside profiles and LoRAs and keeps Uncensored to accounts with Uncensored Models", async (t) => {
  const { dream, state, taste, dreamOnce, generated } = fixture(t);
  const liked = (id: string, profileId: string) => {
    generated({
      id,
      ownerId: "alice",
      type: "image",
      status: "done",
      rating: "liked",
      prompt: `liked ${id}`,
      settings: { profileId },
    });
    taste.record("alice", [tasteSignal("like", id, { profileId, tags: ["fox"] })]);
  };
  liked("a", "qwen");
  liked("b", "qwen");
  liked("d", "qwen");
  taste.record("alice", [tasteSignal("discard", "c", { profileId: "flux" })]);
  await dream.save("alice", { enabled: true, uncensored: true });
  const job = await dreamOnce();
  assert.equal(job?.input.profileId, "qwen");
  assert.equal(job?.dream?.arm, "exploit");
  assert.match(state.calls[0].user, /- liked [ab]/);
  // An exploited idea features something they like.
  assert.match(state.calls[0].system, /Keep this taste they like: fox\./);
  // No uncensored grant: Uncensored never applies, whatever the setting says.
  assert.equal(state.calls[0].model, "writer");
  assert.match(state.calls[0].system, /safe for work/);
  state.access.alice!.uncensored = true;
  const uncensored = await dreamOnce();
  assert.equal(state.calls[1].model, "writer");
  assert.match(state.calls[1].system, /Uncensored: sensual/);
  assert.equal(uncensored?.dream?.uncensored, true);
  // Losing the grant after queueing: the job is written safe for work.
  state.access.alice!.uncensored = false;
  await dream.write(uncensored!, {
    signal: new AbortController().signal,
    onThinking() {},
    onDelta() {},
  });
  assert.match(state.calls[2].system, /safe for work/);
  // New concepts also try the profile used least, here one never used.
  state.rolls = [99];
  const explored = await dreamOnce();
  assert.equal(explored?.input.profileId, "flux");
  assert.equal(explored?.dream?.arm, "explore:profile");
  assert.match(state.calls.at(-1)!.system, /change at least three/);
  assert.equal((explored?.input.writing as { explore?: boolean })?.explore, true);
  assert.equal(explored?.dream?.why, "Trying FLUX for the first time · You like foxes.");
  // The next explores a concept from a Library import, on its profile with its LoRAs, for
  // Uncensored Models only, since imports carry no content rating.
  state.access.alice!.uncensored = true;
  state.loras.alice = {
    ratings: {
      "fox.safetensors": "liked",
      "film.safetensors": "liked",
      "ink.safetensors": "disliked",
    },
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
  assert.equal(inspired?.dream?.why, "Inspired by an import · You like foxes.");
  // Without an import, an explored prompt still uses their taste on the profile it drew.
  state.access.alice!.uncensored = false;
  state.loras = {};
  state.rolls = [99];
  await dreamOnce();
  state.rolls = [99];
  const beyond = await dreamOnce();
  assert.deepEqual([beyond?.input.profileId, beyond?.dream?.arm], ["qwen", "explore:prompt"]);
  assert.doesNotMatch(state.calls.at(-1)!.user, /Inspiration/);
  assert.match(state.calls.at(-1)!.system, /Explore a fresh idea within their taste/);
});

test("Dream favours the set model they keep over one they pass", async (t) => {
  const { dream, taste, dreamOnce, generated } = fixture(t);
  taste.edit("alice", { models: ["flux", "qwen"] });
  for (const [index, profileId, state] of [
    [0, "flux", "discarded"],
    [1, "flux", "discarded"],
    [2, "flux", "discarded"],
    [3, "qwen", "kept"],
  ] as const)
    generated({
      id: `judged-${index}`,
      ownerId: "alice",
      type: "image",
      status: "done",
      prompt: `judged ${index}`,
      settings: { profileId },
      dream: { prompt: `judged ${index}`, why: "", at: "", state, passReason: "skip" },
    });
  await dream.save("alice", { enabled: true });
  assert.equal((await dreamOnce())?.input.profileId, "qwen");
});

test("Dream draws from the models and tags a person set over those it learnt", async (t) => {
  const { dream, state, taste, dreamOnce } = fixture(t);
  taste.record("alice", [tasteSignal("like", "a", { profileId: "qwen", tags: ["fox"] })]);
  taste.edit("alice", {
    models: ["flux"],
    tags: ["harbour"],
    likes: ["quiet candid portraits"],
    styles: ["documentary photography"],
    avoid: ["surreal props"],
  });
  await dream.save("alice", { enabled: true });
  const job = await dreamOnce();
  assert.deepEqual([job?.input.profileId, job?.dream?.arm], ["flux", "exploit"]);
  assert.match(state.calls[0].system, /Keep this taste they like: harbour\./);
  state.rolls = [99];
  const explored = await dreamOnce();
  assert.equal(explored?.dream?.arm, "explore:profile");
  const { system, user } = state.calls.at(-1)!;
  assert.match(
    user,
    /Avoids: surreal props\nLikes: quiet candid portraits\nPreferred Styles: documentary photography/,
  );
  assert.match(system, /Treat recurring props and settings as incidental/);
  assert.match(system, /Build the idea around one of these starting points/);
  assert.doesNotMatch(system, /Possible starting points:.*(?:\bsubject:|medium or style:)/);
});

test("Fresh concepts rotate anchors and inspirations without overriding a model experiment", async (t) => {
  const { dream, state, dreamOnce } = fixture(t);
  state.access.alice!.uncensored = true;
  state.inspiration = [
    { prompt: "a lighthouse in a storm", profileId: "flux", loras: [] },
    { prompt: "a clockmaker repairing a mechanical bird", profileId: "flux", loras: [] },
    { prompt: "a lighthouse in a storm", profileId: "flux", loras: [] },
  ];
  await dream.save("alice", { enabled: true });
  const seen: string[] = [];
  const anchors: string[][] = [];
  for (let index = 0; index < 13; index++) {
    state.rolls = [99, 0];
    const job = await dreamOnce();
    assert.ok(job);
    assert.equal((job.input.writing as { explore?: boolean }).explore, true);
    seen.push((job.input.writing as { inspiration: string }).inspiration);
    anchors.push(dream.read("alice").anchors!.slice(0, 10));
    assert.match(state.calls.at(-1)!.system, /change at least three/);
    assert.match(
      state.calls.at(-1)!.system,
      /Do not copy its complete concept or merely paraphrase it/,
    );
    if (index === 0) {
      assert.equal(job.dream?.arm, "explore:profile");
      assert.equal(job.input.profileId, "qwen");
    }
  }
  assert.notEqual(seen[0], seen[1], "Duplicate catalogue entries do not repeat an inspiration");
  assert.equal(seen[0], seen[2], "Exhausted inspirations return oldest first");
  for (const axis of ["subject", "action", "setting", "camera or composition"]) {
    const choices = anchors
      .slice(0, axis === "camera or composition" ? 10 : 12)
      .map((draw) => draw.find((value) => value.startsWith(`${axis}:`)));
    assert.equal(
      new Set(choices).size,
      choices.length,
      `${axis} rotates independently of prompt wording`,
    );
  }
  assert.equal(anchors[0][0], anchors[12][0], "An exhausted axis returns to its oldest choice");
  assert.equal(dream.read("bob").anchors, undefined);
  assert.equal(dream.read("bob").inspirations, undefined);
  state.inspiration = [{ prompt: "a newly saved concept", loras: [] }];
  state.rolls = [99, 0];
  const next = await dreamOnce();
  assert.ok(next);
  assert.equal(
    (next.input.writing as { inspiration: string }).inspiration,
    "a newly saved concept",
  );
});

test("Fresh concept retries reject liked prompt copies and show the rejected concept", async (t) => {
  const { dream, state, generated, dreamOnce } = fixture(t);
  const prompt = "A red fox repairing a clockwork boat in a sunlit workshop, viewed from above";
  generated({
    id: "liked",
    ownerId: "alice",
    type: "image",
    status: "done",
    rating: "liked",
    prompt,
  });
  state.replies = [
    {
      prompt: "Viewed from above, a red fox repairing a clockwork boat in a sunlit workshop",
      title: "Clockwork Boat",
    },
    {
      prompt: "An octopus conducting a coral orchestra in a wide underwater amphitheatre",
      title: "Coral Orchestra",
    },
  ];
  await dream.save("alice", { enabled: true });
  state.rolls = [99];
  const job = await dreamOnce();
  assert.equal(
    job?.input.prompt,
    "An octopus conducting a coral orchestra in a wide underwater amphitheatre",
  );
  assert.equal(state.calls.length, 2);
  assert.match(state.calls[1].user, /Rejected prompt: Viewed from above/);
  assert.match(state.calls[1].user, /too close to a recent or liked prompt/);
  assert.match(state.calls[1].user, /do not paraphrase the rejected idea/);
  assert.deepEqual(dream.read("alice").subjects, ["Coral Orchestra"]);
});

test("Fresh concepts cool down repeated optional motifs across otherwise different prompts", async (t) => {
  const { dream, state, dreamOnce } = fixture(t);
  await dream.save("alice", { enabled: true });
  state.replies = [
    { prompt: "An elephant lifts a paper lantern beside a fountain", motifs: ["Paper Lantern"] },
    { prompt: "A photographer frames a paper lantern from a ferry", motifs: ["paper lantern"] },
    {
      prompt: "She sketches an owl on a paper lantern among pine trees",
    },
    { prompt: "A diver watches a seal circle a kelp forest", motifs: ["kelp forest"] },
  ];
  for (let index = 0; index < 2; index++) {
    state.rolls = [99];
    assert.ok(await dreamOnce());
  }
  state.rolls = [99];
  const accepted = await dreamOnce();
  assert.equal(accepted?.input.prompt, "A diver watches a seal circle a kelp forest");
  assert.match(
    state.calls[2].user,
    /Recently repeated optional motifs to leave out this time: paper lantern/,
  );
  assert.match(state.calls[3].user, /The optional motif "paper lantern" has appeared/);
});

test("Motif cooldowns recognise unlabelled laundry and smoking across different scenes", async (t) => {
  const { dataDir, dream, state, dreamOnce } = fixture(t);
  await dream.save("alice", { enabled: true });
  writeRuntimeDocument(dataDir, "dream:alice", {
    ...dream.read("alice"),
    recent: [
      "Two masked detectives meet after hours in a closed laundromat. A cigarette burns.",
      "A sailor holding a cigar watches the wind tangle shirts on a mountain clothesline.",
    ],
  });
  const first = "A diver watches a seal circle a kelp forest";
  const second = "An astronomer watches a snowstorm from a stone observatory";
  state.replies = [
    {
      prompt: "A childproof washing machine hums in the corner of a spaceship",
      motifs: ["spaceship"],
    },
    { prompt: first },
    { prompt: "A glass ashtray sits on the bank counter beneath a security monitor" },
    { prompt: second },
  ];
  for (const prompt of [first, second]) {
    state.rolls = [99];
    assert.equal((await dreamOnce())?.input.prompt, prompt);
  }
  assert.match(
    state.calls[0].user,
    /Recently repeated optional motifs to leave out this time: laundry, smoking/,
  );
  assert.match(state.calls[1].user, /The optional motif "laundry" has appeared/);
  assert.match(state.calls[3].user, /The optional motif "smoking" has appeared/);
});

test("Dream retries explicit avoids, even negated ones, without cooling required motifs", async (t) => {
  const { dataDir, dream, projects, state, taste, dreamOnce } = fixture(t);
  await dream.save("alice", { enabled: true });
  taste.edit("alice", { avoid: ["smoking"] });
  projects.create("alice", {
    name: "Evening Light",
    brief: {
      rules: "No laundry. Include a paper lantern. Avoid lightning while indoors.",
      avoid: "neon signs",
    },
  });
  writeRuntimeDocument(dataDir, "dream:alice", {
    ...dream.read("alice"),
    motifs: [["paper lantern"], ["paper lantern"]],
    recent: ["An old laundromat stands empty in a storm.", "A clothesline spans a mountain path."],
  });

  const kept = [
    { prompt: "A poet reads by a paper lantern in a quiet study.", motifs: ["paper lantern"] },
    { prompt: "A paper lantern lights an astronomer under a sandstone arch as lightning strikes." },
    { prompt: "A paper lantern leads a night parade across a castle's drawbridge." },
  ];
  state.replies = [
    { prompt: "A washing machine hums in the corner of a spaceship." },
    kept[0],
    { prompt: "A quiet balcony at night, with no smoking allowed." },
    kept[1],
    { prompt: "Neon signs light a flooded road in the distance." },
    kept[2],
  ];
  for (const value of kept) {
    state.rolls = [99];
    assert.equal((await dreamOnce())?.input.prompt, value.prompt);
  }

  assert.match(
    state.calls[0].user,
    /Recently repeated optional motifs to leave out this time: laundry/,
  );
  assert.match(state.calls[1].user, /"laundry", which their rules or brief say to avoid/);
  assert.match(state.calls[3].user, /"smoking", which their rules or brief say to avoid/);
  assert.match(state.calls[5].user, /"neon signs", which their rules or brief say to avoid/);
  assert.deepEqual(dream.read("alice").motifs?.[2], ["paper lantern"]);
});

test("Dream rotates a liked Gallery image through size, model and LoRA recreations once each", async (t) => {
  const mediaInputs = [{ id: "image", role: "reference" }];
  const native = {
    ...profiles[0],
    mediaInputs,
    native: { "2k": "yes", "4k": "yes" },
    constraints: { width: { max: 4096, step: 16 }, height: { max: 4096, step: 16 } },
  };
  const alternate = {
    ...profiles[1],
    id: "alternate",
    mediaInputs,
    defaults: { steps: 12 },
    options: { loras: ["fox.safetensors"] },
  };
  const { dream, state, store, dreamOnce } = fixture(t, [
    native,
    ...profiles.slice(1),
    { ...profiles[1], id: "without-source-lora", mediaInputs },
    alternate,
  ]);
  state.loras.alice = { ratings: { "ink.safetensors": "liked", "film.safetensors": "disliked" } };
  const session = store.createSession("alice", "Gallery");
  const input = {
    kind: "image",
    profileId: native.id,
    prompt: "A fox on a beach",
    negative: "fog",
    steps: 30,
    seed: "15",
    count: 3,
    loras: [{ name: "fox.safetensors", strength: 0.8 }],
    referenceAssets: [{ assetId: "reference", slot: "image" }],
  };
  const source = store.enqueue(
    "alice",
    session.id,
    { ...input, resultSet: { id: "chat-set", title: "A Gallery Set" } },
    "image",
  );
  store.save({ ...source, status: "completed" });
  const fullSize = store.enqueue("alice", session.id, { ...input, resolutionTier: "4K" }, "image");
  store.save({ ...fullSize, status: "completed" });
  const liked: DreamItem = {
    id: "liked-result-2",
    ownerId: "alice",
    jobId: source.id,
    status: "done",
    type: "image",
    rating: "liked",
    width: 768,
    height: 1024,
    settings: { seed: "17" },
  };
  state.items.push({ ...liked, id: "at-native-limit", jobId: fullSize.id }, liked);
  const nineImages = () => {
    for (let index = 0; index < 9; index++) {
      const image = store.enqueue(
        "alice",
        session.id,
        { kind: "image" },
        "image",
        undefined,
        undefined,
        undefined,
        {
          priority: queuePriority.dream,
        },
      );
      store.save({ ...image, status: "completed" });
    }
  };
  await dream.save("alice", { enabled: true, dailyImages: 40 });
  nineImages();
  const rendered = await dreamOnce();
  assert.equal(rendered?.dream?.arm, "recreate");
  assert.equal(rendered?.parentItemId, "liked-result-2");
  assert.deepEqual(rendered?.input, {
    ...input,
    clientJobId: rendered?.id,
    count: 1,
    seed: "17",
    width: 1536,
    height: 2048,
    resolutionTier: "2K",
    autoUpscale: null,
  });
  assert.equal(state.calls.length, 0);
  assert.deepEqual(
    store.job("alice", rendered!.id),
    store.job("alice", String(rendered?.input.clientJobId)),
  );
  state.items.find((item) => item.id === "at-native-limit")!.rating = undefined;
  nineImages();
  const model = await dreamOnce();
  assert.equal(model?.parentItemId, liked.id);
  assert.equal(model?.input.profileId, alternate.id);
  assert.equal(model?.input.steps, 12);
  assert.deepEqual(model?.input.referenceAssets, input.referenceAssets);
  assert.deepEqual(model?.input.loras, input.loras);
  assert.deepEqual([model?.input.prompt, model?.input.seed], [input.prompt, "17"]);
  assert.deepEqual([model?.input.width, model?.input.height], [768, 1024]);
  nineImages();
  const lora = await dreamOnce();
  assert.equal(lora?.parentItemId, liked.id);
  assert.equal(lora?.input.profileId, native.id);
  assert.deepEqual(lora?.input.loras, [
    ...input.loras,
    { name: "ink.safetensors", strength: 1, enabled: true },
  ]);
  assert.deepEqual(lora?.input.referenceAssets, input.referenceAssets);
  assert.deepEqual([lora?.input.prompt, lora?.input.seed], [input.prompt, "17"]);
  assert.equal(state.calls.length, 0);
  nineImages();
  const next = await dreamOnce();
  assert.ok(next?.dream && next.dream.arm !== "recreate");
  assert.equal(state.calls.length, 1);
  assert.equal(await dreamOnce(), undefined);
});

test("A small Dream quota can recreate a liked seedless cloud image on its own aspect", async (t) => {
  const cloud = {
    id: "grok-image",
    kind: "image",
    provider: "cliproxyapi",
    options: { resolutions: ["1k", "2k"] },
    aspectPresets: [
      { sizes: { "1k": { w: 1280, h: 720 }, "2k": { w: 2816, h: 1584 } } },
      { sizes: { "1k": { w: 1024, h: 1024 }, "2k": { w: 2048, h: 2048 } } },
    ],
  };
  const { dream, state, store, dreamOnce } = fixture(t, [...profiles, cloud]);
  const prompt = "A sunlit coastline";
  const session = store.createSession("alice");
  const source = store.enqueue(
    "alice",
    session.id,
    { kind: "image", profileId: cloud.id, prompt, resolution: "1k" },
    "image",
  );
  store.save({ ...source, status: "completed" });
  state.items.push({
    id: "cloud-source",
    ownerId: "alice",
    jobId: source.id,
    status: "done",
    type: "image",
    rating: "liked",
    width: 1280,
    height: 720,
    settings: { seed: "Random", resolution: "1k" },
  });
  await dream.save("alice", { enabled: true, dailyImages: 1, imageBackend: "cloud" });
  state.rolls = [99];
  assert.ok((await dreamOnce())?.dream?.arm !== "recreate");
  state.clock += 86_400_000;
  state.rolls = [0];
  const recreated = await dreamOnce();
  assert.match(recreated?.resource || "", /^provider:cliproxyapi:/);
  assert.equal(recreated?.dream?.arm, "recreate");
  assert.equal(recreated?.parentItemId, "cloud-source");
  assert.deepEqual(recreated?.input, {
    clientJobId: recreated?.id,
    count: 1,
    kind: "image",
    profileId: cloud.id,
    prompt,
    resolution: "2k",
    width: 2816,
    height: 1584,
    autoUpscale: null,
  });
  assert.equal(state.calls.length, 1);
});

test("More Like This permits close iterations while keeping species and source identity", async (t) => {
  const { dream, state, dreamOnce } = fixture(t);
  await dream.save("alice", { enabled: true });
  const original = "An adult golden retriever carrying a red ball across a grassy field";
  state.replies = [{ prompt: original, title: "Golden Retriever" }];
  const first = await dreamOnce();
  assert.ok(first);
  const item = state.items.find((item) => item.jobId === first.id)!;
  dream.more("alice", String(item.id));
  const iteration = "An adult golden retriever carrying a blue ball across a grassy field";
  state.replies = [{ prompt: iteration, title: "Golden Retriever" }];
  const next = await dreamOnce();
  assert.equal(next?.input.prompt, iteration);
  assert.match(state.calls.at(-1)!.system, /including species and breed/);
  assert.doesNotMatch(state.calls.at(-1)!.system, /change at least three/);
  assert.doesNotMatch(state.calls.at(-1)!.user, /Recent Dream ideas to avoid/);
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
  assert.equal(state.logs.at(-1), "Dream skips account alice: Paused.");
});

/** Serves the Dream routes; `request` answers as the user named in its last argument. */
async function serve(
  t: TestContext,
  { dream, projects, inbox }: Pick<ReturnType<typeof fixture>, "dream" | "projects" | "inbox">,
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { studioAccount: { userId: String(req.headers["x-user"]), role: "user" } });
    next();
  });
  registerDreamRoutes(app as never, { dream, projects, inbox, listed: (items) => items });
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

test("Reset Limit grants a fresh quota only to the capped Dream kind and owner", async (t) => {
  const fx = fixture(t);
  const { dream, dreamOnce, store, state } = fx;
  t.mock.timers.enable({ apis: ["Date"], now: state.clock });
  const request = await serve(t, fx);
  await dream.save("alice", { enabled: true, dailyImages: 1, videos: true, dailyVideos: 1 });
  assert.equal((await request("/reset-limit", { kind: "image" })).status, 409);
  const oldImage = (await dreamOnce())!;
  assert.equal(oldImage.input.kind, "image");
  dream.keep("alice", String(dream.unseen("alice")[0].id));
  assert.equal((await dreamOnce())?.input.kind, "video");
  assert.equal((await request("")).body.status, "capped");
  assert.equal((await request("/reset-limit", { kind: "image" }, "POST", "bob")).status, 409);
  const saved = store.jobs("alice");
  const reset = await request("/reset-limit", { kind: "image" });
  assert.equal(reset.status, 200);
  assert.deepEqual(reset.body.today, { images: 1, videos: 1 });
  assert.deepEqual(reset.body.usage, { images: 0, videos: 1 });
  assert.deepEqual(store.jobs("alice"), saved);
  assert.equal(reset.body.unseen.length, 1);
  assert.equal(reset.body.settings.dailyImages, 1);
  assert.equal((await request("/reset-limit", { kind: "image" })).status, 409);

  const newImage = (await dreamOnce())!;
  assert.equal(newImage.input.kind, "image");
  assert.equal(newImage.createdAt, oldImage.createdAt);
  assert.equal(await dreamOnce(), undefined);
  const capped = await request("");
  assert.equal(capped.body.status, "capped");
  assert.deepEqual(capped.body.today, { images: 2, videos: 1 });
  assert.deepEqual(capped.body.usage, { images: 1, videos: 1 });
  store.save({ ...store.job("alice", oldImage.id)!, status: "cancelled" });
  assert.equal(await dreamOnce(), undefined);
  assert.equal((await request("/reset-limit", { kind: "image" })).status, 200);
  state.clock += 86_400_000;
  const tomorrow = await request("");
  assert.deepEqual(tomorrow.body.today, { images: 0, videos: 0 });
  assert.equal((await request("/reset-limit", { kind: "image" })).status, 409);
});

test("Dream history exposes only the owner's retained Dream activity and available result links", async (t) => {
  const fx = fixture(t);
  fx.taste.record("alice", [
    tasteSignal("keep", "old", { itemId: "missing", title: "Old Result" }),
  ]);
  fx.taste.record("alice", [tasteSignal("like", "unrelated", { title: "Private Gallery Rating" })]);
  fx.taste.record("alice", [
    tasteSignal("preferred", "comparison", { title: "Unrelated Comparison" }),
  ]);
  fx.taste.record("alice", [tasteSignal("calibrate-pass", "gallery", { title: "Gallery Result" })]);
  fx.taste.record("bob", [tasteSignal("discard", "private", { title: "Bob's Result" })]);
  const request = await serve(t, fx);
  const alice = await request("/history");
  assert.equal(alice.status, 200);
  assert.deepEqual(
    alice.body.items.map((item: { action: string }) => item.action),
    ["Passed Gallery Image", "Kept"],
  );
  assert.equal(alice.body.items[1].item.title, "Old Result");
  assert.equal(alice.body.items[1].item.id, undefined);
  assert.ok(alice.body.items.every((item: { at: string }) => item.at));
  const bob = await request("/history", undefined, "GET", "bob");
  assert.equal(bob.body.items.length, 1);
  assert.equal(bob.body.items[0].item.title, "Bob's Result");
  fx.state.access.alice = null;
  assert.equal((await request("/history")).status, 403);
});

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
  assert.equal(shown.uncensoredAvailable, false);
  assert.equal((await request("", undefined, "GET", "bob")).body.unseen.length, 0);
  const [one, two, three] = shown.unseen.map((item: DreamItem) =>
    encodeURIComponent(String(item.id)),
  );

  assert.equal((await request("/settings", { dailyImages: -1 }, "PUT")).status, 400);
  assert.equal(
    (await request("/settings", { videoIdleMinutes: 1 }, "PUT")).body.settings.videoIdleMinutes,
    undefined,
  );
  assert.equal((await request("/settings", { videos: "yes" }, "PUT")).status, 400);
  assert.equal((await request("/settings", { uncensored: true }, "PUT")).status, 403);
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
  const history = (await request("/history")).body.items;
  assert.equal(
    history.find((entry: { action: string }) => entry.action === "Kept").item.id,
    decodeURIComponent(one),
  );
  assert.equal(
    history.find((entry: { action: string }) => entry.action === "Discarded").item.id,
    undefined,
  );
  assert.deepEqual(
    taste.read("alice").signals.map((signal) => [signal.kind, signal.jobId, signal.arm]),
    [
      ["discard", state.items.find((item) => item.prompt === "dream 2")?.jobId, "exploit"],
      ["keep", job.id, "exploit"],
    ],
  );
  assert.deepEqual((await request("/discarded?media=video&limit=1")).body, {
    items: [],
    nextCursor: "",
  });
  const discarded = await request("/discarded?media=image&limit=1");
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

test("Projects share turns by how their results fare, with a floor for new ones; paused ones take none", () => {
  const stats = new Map([
    ["strong", { kept: 18, liked: 6, discarded: 2, review: 8.5 }],
    ["weak", { kept: 1, liked: 0, discarded: 19, review: 3 }],
  ]);
  const shares = turnShares(
    [{ id: "strong" }, { id: "weak" }, { id: "new" }, { id: "rested", paused: true }],
    stats,
  );
  assert.equal(shares.get("rested"), 0);
  assert.ok(Math.abs([...shares.values()].reduce((sum, share) => sum + share, 0) - 1) < 1e-9);
  assert.ok(shares.get("strong")! > shares.get("new")!);
  assert.ok(shares.get("new")! > shares.get("weak")!);
  // However poorly a project fares, it keeps half an equal share.
  assert.ok(shares.get("weak")! >= 0.5 / 3);
  // Favouring a project doubles its weight.
  const favoured = turnShares([{ id: "strong" }, { id: "new", favoured: true }], new Map());
  assert.ok(favoured.get("new")! > favoured.get("strong")!);
});

test("Dream's ideas take the account's active projects, and visits record when the last one ended", async (t) => {
  const fx = fixture(t);
  const { dream, state, projects, dreamOnce } = fx;
  await dream.save("alice", { enabled: true });
  const beach = projects.create("alice", {
    name: "Beach",
    brief: { subjects: "the sea", avoid: "people" },
  });
  const city = projects.create("alice", { name: "City" });
  projects.update("alice", city.id, { paused: true }, "you");
  for (let index = 0; index < 2; index++) await dreamOnce();
  projects.update("alice", city.id, { paused: false }, "you");
  projects.update("alice", beach.id, { paused: true }, "you");
  await dreamOnce();
  assert.deepEqual(
    state.items.map((item) => item.dream?.projectId),
    [city.id, beach.id, beach.id],
  );
  // The brief steers the writer; a project without one adds nothing.
  assert.match(
    state.calls[0].user,
    /Project brief \(Beach\):\n- Subjects: the sea\n- Avoid: people/,
  );
  assert.match(state.calls[0].system, /keep to its brief/);
  assert.doesNotMatch(state.calls[2].user, /Project brief/);

  const request = await serve(t, fx);
  const shown = (await request("")).body;

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

test("Dream varies a project after its chat hands it over, with the source settings", async (t) => {
  const { dream, state, store, projects, dreamOnce, walks } = fixture(t);
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
  chatImage("seed", "a fox on a beach at dawn", { rating: "liked" });

  // The chat keeps its project until the handoff. Ordinary likes make no automatic variants.
  const held = await dreamOnce();
  assert.equal(held?.dream?.projectId, undefined);
  assert.doesNotMatch(String(held?.dream?.arm), /^continue:/);

  state.clock += 61 * 60_000;
  const handedOff = await dreamOnce();
  assert.equal(handedOff?.dream?.projectId, beach.id);
  assert.equal(handedOff?.dream?.arm, "continue:scene");
  assert.match(String(handedOff?.dream?.why), /^Continuing Beach: new scene · /);
  assert.equal(handedOff?.parentItemId, "seed");
  assert.deepEqual(
    [
      handedOff?.input.profileId,
      handedOff?.input.steps,
      handedOff?.input.width,
      handedOff?.input.height,
    ],
    ["flux", 20, 832, 1216],
  );
  assert.deepEqual(handedOff?.input.loras, [
    { name: "fox.safetensors", strength: 0.8, enabled: true },
  ]);
  assert.deepEqual(handedOff?.input.referenceAssets, [{ assetId: "character", slot: "reference" }]);
  const call = state.calls.at(-1)!;
  assert.match(call.system, /change only the scene/);
  assert.match(call.system, /brief steer/);
  assert.match(call.user, /- Avoid: crowds/);
  assert.match(call.user, /Seed prompt: a fox on a beach at dawn/);
  // A new request takes the project back for the next hour.
  projects.activity("alice", "chat-1");
  assert.equal((await dreamOnce())?.dream?.projectId, undefined);
  assert.deepEqual(walks(), [], "Dream never walks the whole gallery");
});

test("Three independent likes, in the gallery or Super Likes, seed a concept and Too Similar puts it aside temporarily", async (t) => {
  const fx = fixture(t);
  const { dream, state, store, dreamOnce, taste } = fx;
  state.owners = ["alice"];
  state.draws[5] = Array(20).fill(1);
  await dream.save("alice", { enabled: true });
  const prompt = "A fox repairing a clockwork boat in a sunlit workshop";
  const session = store.createSession("alice", "Gallery").id;
  function picture(id: string, setId?: string) {
    const input = { kind: "image", prompt, profileId: "flux" };
    const job = store.enqueue("alice", session, input, "image", undefined, "worker:image", id);
    store.save({ ...job, status: "completed" });
    const item: DreamItem = {
      id,
      jobId: job.id,
      ownerId: "alice",
      type: "image",
      status: "done",
      prompt,
      dream: { state: "unseen", prompt, why: "", at: "" },
      ...(setId && { resultSet: { id: setId, title: "Clockwork Boat", index: 0, source: "MCP" } }),
    };
    state.items.push(item);
    return item;
  }
  const request = await serve(t, fx);
  for (const id of ["first", "sibling", "second"]) {
    const item = picture(id, id === "second" ? undefined : "siblings");
    assert.equal((await request(`/${id}/super-like`, {})).status, 200);
    assert.equal(item.dream!.superLiked, true);
  }
  assert.doesNotMatch(String((await dreamOnce())?.dream?.arm), /^continue:/);

  const likedNormally = picture("third");
  likedNormally.rating = "liked";
  dream.rated("alice", [likedNormally]);
  assert.equal(likedNormally.dream!.superLiked, undefined);
  const passed = picture("repeat");
  dream.pass("alice", ["repeat"], "similar");
  assert.equal(passed.rating, undefined);
  assert.ok(!taste.read("alice").signals.some((signal) => signal.kind === "discard"));
  assert.doesNotMatch(String((await dreamOnce())?.dream?.arm), /^continue:/);
  assert.match(state.calls.at(-1)!.user, /passed as too similar recently/);

  state.clock += 15 * 86_400_000;
  state.rolls = [99, 0];
  const variation = await dreamOnce();
  assert.match(String(variation?.dream?.arm), /^continue:/);
  assert.equal(variation?.parentItemId, "first");
  assert.doesNotMatch(String((await dreamOnce())?.dream?.arm), /^continue:/);
});

test("Calibration comparisons rate gallery images without seeding automatic variants", async (t) => {
  const { dream, state, store, dreamOnce } = fixture(t);
  await dream.save("alice", { enabled: true });
  const old = new Date(state.clock - 2 * 86_400_000).toISOString();
  for (const id of ["win", "lose", "same"]) {
    const input = { kind: "image", prompt: `prompt ${id}`, profileId: "flux" };
    const session = store.createSession("alice", "Gallery").id;
    const job = store.enqueue("alice", session, input, "image", undefined, "worker:image", id);
    store.save({ ...job, status: "completed" });
    state.items.push({
      id,
      jobId: job.id,
      ownerId: "alice",
      type: "image",
      status: "done",
      createdAt: old,
      // The winner is also a liked Dream result; its note names the comparison.
      ...(id === "win" ? { dream: { state: "kept" as const, prompt: "", why: "", at: "" } } : {}),
    });
  }
  dream.calibrate("alice", { liked: ["win"], passed: ["lose"] });
  assert.deepEqual(dream.read("alice").ratings, { win: 1516, lose: 1484 });
  // Both (or Neither) draws the two together; a single verdict rates nothing.
  dream.calibrate("alice", { liked: ["lose", "same"], passed: [] });
  dream.calibrate("alice", { passed: ["same"], liked: [] });
  assert.deepEqual(dream.read("alice").ratings, { win: 1516, lose: 1485, same: 1499 });
  const job = await dreamOnce();
  assert.doesNotMatch(String(job?.dream?.arm), /^continue:/);
});

test("While Dream is off, gallery comparisons still rate images and queue nothing", async (t) => {
  const { dream, state, dreamJobs, generated } = fixture(t);
  const createdAt = new Date(state.clock - 2 * 86_400_000).toISOString();
  generated(
    ...["a", "b"].map((id) => ({
      id,
      jobId: `job-${id}`,
      ownerId: "alice",
      type: "image",
      status: "done",
      createdAt,
    })),
  );
  assert.equal(dream.read("alice").settings.enabled, false);
  assert.deepEqual(
    dream
      .calibration("alice", 12)
      .map((item) => item.id)
      .sort(),
    ["a", "b"],
  );
  dream.calibrate("alice", { liked: ["a"], passed: ["b"] });
  assert.deepEqual(dream.read("alice").ratings, { a: 1516, b: 1484 });
  await dream.tick();
  assert.deepEqual(dreamJobs("alice"), []);
});

test("Dream-off video comparisons rate videos without queueing work", async (t) => {
  const { dream, state, dreamJobs, generated } = fixture(t);
  const createdAt = new Date(state.clock - 2 * 86_400_000).toISOString();
  generated(
    ...["a", "b"].map((id) => ({
      id,
      jobId: `job-${id}`,
      ownerId: "alice",
      type: "video",
      status: "done",
      createdAt,
    })),
  );
  assert.deepEqual(
    dream
      .calibration("alice", 12, "video")
      .map((item) => item.id)
      .sort(),
    ["a", "b"],
  );
  dream.calibrate("alice", { liked: ["a"], passed: ["b"] });
  assert.deepEqual(dream.read("alice").ratings, { a: 1516, b: 1484 });
  await dream.tick();
  assert.deepEqual(dreamJobs("alice"), []);
});

test("Fresh concepts dominate even when verdicts adapt the share", async (t) => {
  const { dream, state, dreamOnce } = fixture(t);
  await dream.save("alice", { enabled: true });
  // A small share remains available for familiar work.
  state.rolls = [4];
  assert.equal((await dreamOnce())?.dream?.arm, "exploit");
  state.rolls = [5];
  assert.match(String((await dreamOnce())?.dream?.arm), /^explore:/);
  let made = 0;
  const decided = (count: number, arm: string, verdict: "kept" | "discarded", pair = false) => {
    for (let index = 0; index < count; index++)
      state.items.unshift({
        id: `decided-${made++}`,
        ownerId: "alice",
        type: "image",
        status: "done",
        dream: {
          state: verdict,
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
  };
  // Positive verdicts raise the fresh share.
  decided(10, "explore:prompt", "kept");
  decided(10, "exploit", "discarded");
  state.rolls = [2];
  assert.match(String((await dreamOnce())?.dream?.arm), /^explore:/);
  state.rolls = [1];
  assert.equal((await dreamOnce())?.dream?.arm, "exploit");
  // Poor verdicts still leave a majority of fresh concepts; comparisons do not count.
  decided(20, "explore:lora", "discarded");
  decided(60, "continue:pose", "kept");
  decided(30, "explore:steps", "kept", true);
  state.rolls = [9];
  assert.equal((await dreamOnce())?.dream?.arm, "exploit");
  state.rolls = [10];
  assert.match(String((await dreamOnce())?.dream?.arm), /^explore:/);
});

test("liking an unseen Dream result keeps it, disliking discards it and Restore keeps a discard", (t) => {
  const { dream, state } = fixture(t);
  const mark = { prompt: "p", why: "", at: new Date(state.clock).toISOString() };
  const item = (id: string, dreamState: "unseen" | "discarded", rating?: string) => ({
    id,
    jobId: `job-${id}`,
    ownerId: "alice",
    type: "image",
    status: "done",
    rating,
    dream: { ...mark, state: dreamState },
  });
  state.items.push(
    item("liked", "unseen", "liked"),
    item("disliked", "unseen", "disliked"),
    item("restored", "discarded"),
  );
  dream.rated("alice", state.items);
  assert.deepEqual(
    state.items.map((entry) => [entry.id, entry.dream?.state, entry.rating]),
    [
      ["liked", "kept", "liked"],
      ["disliked", "discarded", "disliked"],
      ["restored", "kept", undefined],
    ],
  );
});

test("Dream keeps discards disliked and hidden, never deleting them unasked, and Delete All deletes them", async (t) => {
  const fx = fixture(t);
  const { dream, state, taste } = fx;
  const daysAgo = (days: number) => new Date(state.clock - days * 86_400_000).toISOString();
  const item = (
    id: string,
    ownerId: string,
    days: number,
    mark: "unseen" | "discarded" | "kept",
  ) => ({
    id,
    jobId: `job-${id}`,
    ownerId,
    type: "image",
    status: "done",
    dream: { prompt: "p", why: "", at: daysAgo(days), state: mark, decidedAt: daysAgo(days) },
  });
  state.items.push(
    item("old", "alice", 31, "discarded"),
    item("new", "alice", 0, "unseen"),
    item("kept", "alice", 90, "kept"),
    item("bob-old", "bob", 40, "discarded"),
  );
  await dream.tick();
  const ids = () => state.items.map((entry) => entry.id);
  assert.deepEqual(ids(), ["old", "new", "kept", "bob-old"]);
  dream.discard("alice", "new");
  assert.equal(state.items.find((entry) => entry.id === "new")?.rating, "disliked");
  assert.equal(taste.read("alice").signals[0].kind, "discard");
  // Keeping a discard takes its dislike back.
  dream.keep("alice", "new");
  assert.equal(state.items.find((entry) => entry.id === "new")?.rating, undefined);
  dream.discard("alice", "old");
  const request = await serve(t, fx);
  assert.deepEqual((await request("/discarded", {}, "DELETE")).body, { deleted: 1 });
  assert.deepEqual(ids(), ["new", "kept", "bob-old"]);
});

test("Discard pagination counts only the chosen media and retains owner scope", async (t) => {
  const fx = fixture(t);
  const { state } = fx;
  state.items.push(
    ...["image", "video", "image", "video"].map((type, index) => ({
      id: String(index),
      ownerId: "alice",
      type,
      status: "done",
      dream: { prompt: "p", why: "", at: "", state: "discarded" as const },
    })),
    {
      id: "bob-video",
      ownerId: "bob",
      type: "video",
      status: "done",
      dream: { prompt: "p", why: "", at: "", state: "discarded" },
    },
  );
  const request = await serve(t, fx);
  const first = (await request("/discarded?media=video&limit=1")).body;
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].type, "video");
  assert.equal(first.nextCursor, "1");
  const second = (await request(`/discarded?media=video&limit=1&cursor=${first.nextCursor}`)).body;
  assert.equal(second.items[0].type, "video");
  assert.notEqual(second.items[0].id, first.items[0].id);
  assert.equal(second.nextCursor, "");
  assert.ok([...first.items, ...second.items].every((item) => item.ownerId === "alice"));
});

test("Dream pins account-owned cards and uses the project's model, size and LoRA constraints", async (t) => {
  const { dream, dreamOnce, projects, state } = fixture(t, [
    ...profiles,
    {
      id: "identity",
      kind: "image",
      mediaInputs: [{ id: "face", role: "identity" }],
      defaults: { width: 1024, height: 1024 },
      constraints: { width: { max: 2048 }, height: { max: 2048 } },
    },
  ]);
  const card = (id: string, name: string, description: string): Character => ({
    id,
    name,
    description,
    referenceIds: [],
    createdAt: "",
    updatedAt: "",
  });
  state.cards!.characters.push({
    ...card("ivy", "Ivy March", "a photographer with auburn curls and grey eyes"),
    referenceIds: ["ivy-reference"],
  });
  state.cards!.outfits.push(card("coat", "Olive Coat", "an olive wool coat over black trousers"));
  state.cards!.scenes.push(card("station", "Snowy Station", "inside a snowy railway station"));
  const pins = { characters: "ivy", outfits: "coat", scenes: "station" };
  assert.throws(() => projects.create("bob", { name: "Station", cards: pins }), /no longer exists/);
  const project = projects.create("alice", {
    name: "Station",
    cards: pins,
    constraints: { profiles: ["identity"], loras: false, aspect: "portrait", resolution: "1K" },
  });
  await dream.save("alice", { enabled: true });
  state.replies = [{ prompt: "She looks for the timetable from a low camera angle." }];
  const job = (await dreamOnce())!;
  assert.equal(job.dream?.projectId, project.id);
  assert.equal(job.input.profileId, "identity");
  assert.equal(job.input.resolutionTier, "1K");
  assert.ok(Number(job.input.width) < Number(job.input.height));
  assert.deepEqual(job.input.loras, []);
  assert.deepEqual(job.input.referenceAssets, [
    { assetId: "ivy-reference", slot: "face", source: "character" },
  ]);
  assert.match(String(job.input.prompt), /auburn curls.*olive wool coat.*snowy railway station/);
  assert.match(
    state.calls.find((call) => call.system.includes("pinned card"))!.user,
    /Pinned Character: Ivy March/,
  );
  assert.equal(job.dream?.cardContext?.outfit?.name, "Olive Coat");
  projects.update("alice", project.id, { cards: {} }, "you");
  assert.equal(projects.list("alice")[0].cards, undefined);
  assert.deepEqual(projects.undo("alice", project.id).cards, pins);
});

test("The Inbox offers liked chat work from separate generations and attaches it on acceptance", async (t) => {
  const { inbox, projects, generated } = fixture(t);
  generated(
    ...["run-a", "run-a", "run-b"].map((id, index) => ({
      id: `result-${index}`,
      ownerId: "alice",
      type: "image",
      status: "done",
      rating: "liked",
      prompt: "A railway station in snow",
      resultSet: { id, title: "Winter Journeys", index },
      chat: { conversationId: "recent-chat" },
    })),
  );
  await inbox.propose("alice");
  const [proposal] = inbox.read("alice").proposals;
  assert.equal(proposal.title, "Continue Winter Journeys");
  assert.equal(proposal.evidence.length, 2);
  assert.equal(inbox.drafts("alice").length, 0);
  assert.deepEqual(projects.chats("alice"), {});
  await inbox.accept("alice", { userId: "alice", role: "user" }, proposal.id);
  assert.equal(projects.chats("alice")["recent-chat"].projectId, projects.list("alice")[0].id);
  inbox.undo("alice", proposal.id);
  assert.deepEqual(projects.chats("alice"), {});
  assert.deepEqual(projects.list("alice"), []);
});

test("Project results and stats use the project's own finished results window", async (t) => {
  const fx = fixture(t);
  const { projects, state } = fx;
  const busy = projects.create("alice", { name: "City" });
  const quiet = projects.create("alice", { name: "Coast", paused: true });
  const image = (id: string, projectId: string): DreamItem => ({
    id,
    ownerId: "alice",
    type: "image",
    status: "done",
    dream: { state: "kept", prompt: "A scene", why: "", at: "", projectId },
  });
  state.items.push(
    ...Array.from({ length: 1_000 }, (_, index) => image(`city-${index}`, busy.id)),
    { ...image("waiting", quiet.id), status: "pending" },
    { ...image("foreign", quiet.id), ownerId: "bob" },
    image("coast", quiet.id),
  );
  const request = await serve(t, fx);
  const { items } = (await request(`/projects/${quiet.id}/results`)).body;
  assert.deepEqual(
    items.map((item: DreamItem) => item.id),
    ["coast"],
  );
  const { stats } = (await request("/projects")).body;
  assert.equal(stats[quiet.id].kept, 1);
  assert.deepEqual(
    stats[quiet.id].results.map((item: DreamItem) => item.id),
    ["coast"],
  );
});

test("Undo returns judged results and gallery images and takes back what they taught", async (t) => {
  const fx = fixture(t);
  const { dream, state, taste, dreamOnce, generated } = fx;
  await dream.save("alice", { enabled: true });
  await dreamOnce();
  await dreamOnce();
  const old = new Date(state.clock - 2 * 86_400_000).toISOString();
  generated({
    id: "gallery",
    jobId: "job-gallery",
    ownerId: "alice",
    type: "image",
    status: "done",
    createdAt: old,
  });
  const request = await serve(t, fx);
  const [one, two] = (await request("")).body.unseen.map((item: DreamItem) => String(item.id));
  await request(`/${encodeURIComponent(one)}/keep`, {});
  await request(`/${encodeURIComponent(two)}/discard`, {});
  await request("/calibration", { liked: ["gallery"] });
  assert.equal(taste.read("alice").signals.length, 3);

  assert.equal((await request("/undo", { ids: [one] }, "POST", "bob")).status, 404);
  assert.equal((await request("/undo", { ids: [] })).status, 400);
  for (const ids of [["gallery"], [two], [one]])
    assert.equal((await request("/undo", { ids })).status, 200);
  assert.deepEqual(
    (await request("")).body.unseen.map((item: DreamItem) => item.id).sort(),
    [one, two].sort(),
  );
  assert.equal(state.items.find((item) => item.id === two)?.rating, undefined);
  assert.deepEqual(taste.read("alice").signals, []);
  assert.deepEqual(dream.read("alice").judged, []);
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
    image("disliked", { rating: "disliked" }),
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
  for (const id of ["bobs", "upload", "borrowed", "disliked"])
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
  assert.deepEqual(
    (await request("/calibration?media=video&limit=10")).body.items.map(
      (item: DreamItem) => item.id,
    ),
    ["clip"],
  );
  assert.equal((await request("/calibration", { liked: ["clip"], passed: ["a"] })).status, 400);
  assert.equal((await request("/calibration", { liked: ["clip"] })).status, 200);
  assert.equal(taste.read("alice").signals[0].media, "video");
  assert.deepEqual(
    (await request("/history?media=video")).body.items.map(
      (item: { item: { media: string } }) => item.item.media,
    ),
    ["video"],
  );
  assert.ok(
    (await request("/history?media=image")).body.items.every(
      (item: { item: { media: string } }) => item.item.media === "image",
    ),
  );
  // Judged images come after unjudged ones; nothing in the gallery changed.
  generated(image("d"));
  assert.equal((await request("/calibration?limit=1")).body.items[0].id, "d");
  assert.deepEqual(
    state.items.filter((item) => item.dream).map((item) => [item.id, item.dream?.state]),
    [["unseen", "unseen"]],
  );
});

test("Dream counts match the deck while off, paired, and after a verdict or Undo", async (t) => {
  const fx = fixture(t);
  const { generated, state } = fx;
  const at = new Date(state.clock).toISOString();
  for (const side of [0, 1] as const)
    generated({
      id: `video-${side}`,
      jobId: `job-video-${side}`,
      ownerId: "alice",
      type: "video",
      status: "done",
      dream: {
        prompt: "A river",
        at,
        why: "",
        state: "unseen",
        pair: {
          id: "river",
          side,
          question: "Which Video?",
          label: side ? "Slow" : "Fast",
          axis: "profile",
          value: side ? "slow" : "fast",
        },
      },
    });
  const request = await serve(t, fx);
  const count = async () => (await request("/count")).body;
  const deck = async () => (await request("")).body;
  const off = await deck();
  assert.equal(off.settings.enabled, false);
  assert.equal(off.unseen.length, 2);
  assert.deepEqual(await count(), { unseen: 0, images: 0, videos: 0, active: false });

  assert.equal((await request("/settings", { enabled: true }, "PUT")).status, 200);
  assert.equal((await deck()).unseen.length, 2);
  assert.deepEqual(await count(), { unseen: 1, images: 0, videos: 1, active: true });

  assert.equal((await request("/settings", { paused: true }, "PUT")).status, 200);
  assert.deepEqual(await count(), { unseen: 1, images: 0, videos: 1, active: false });
  assert.equal((await request("/pairs/river/answer", { answer: "a" })).status, 200);
  assert.equal((await deck()).unseen.length, 0);
  assert.deepEqual(await count(), { unseen: 0, images: 0, videos: 0, active: false });
  assert.equal((await request("/undo", { ids: ["video-0", "video-1"] })).status, 200);
  assert.deepEqual(await count(), { unseen: 1, images: 0, videos: 1, active: false });
});

test("Deck calibration and its rating are saved or undone together", async (t) => {
  const fx = fixture(t);
  const { dream, generated, state, taste } = fx;
  const at = new Date(state.clock - 2 * 86_400_000).toISOString();
  generated({
    id: "gallery",
    jobId: "job-gallery",
    ownerId: "alice",
    type: "image",
    status: "done",
    createdAt: at,
    dream: { prompt: "A gull", why: "", at, state: "kept" },
  });
  const request = await serve(t, fx);
  const item = state.items.find((entry) => entry.id === "gallery")!;
  state.ratingRefused = true;
  assert.notEqual(
    (await request("/calibration", { passed: ["gallery"], rating: "disliked" })).status,
    200,
  );
  assert.equal(dream.read("alice").judged?.length ?? 0, 0);
  assert.equal(taste.read("alice").signals.length, 0);
  assert.equal(item.rating, undefined);

  state.ratingRefused = false;
  assert.equal(
    (await request("/calibration", { passed: ["gallery"], rating: "disliked" })).status,
    200,
  );
  assert.deepEqual(dream.read("alice").judged, ["gallery"]);
  assert.equal(item.rating, "disliked");
  state.ratingRefused = true;
  const undo = { ids: ["gallery"], calibration: true, rating: null };
  assert.notEqual((await request("/undo", undo)).status, 200);
  assert.deepEqual(dream.read("alice").judged, ["gallery"]);
  assert.equal(taste.read("alice").signals.length, 1);
  assert.equal(item.rating, "disliked");

  state.ratingRefused = false;
  assert.equal((await request("/undo", undo)).status, 200);
  assert.deepEqual(dream.read("alice").judged, []);
  assert.equal(taste.read("alice").signals.length, 0);
  assert.equal(item.rating, undefined);
  assert.equal(item.dream?.state, "kept");
});

test("Dream loads a LoRA drawn by taste and like, at its learnt strength, and explores untried ones", async (t) => {
  const { dream, state, store, taste, dreamOnce } = fixture(t, [profiles[0]]);
  // A LoRA for another family is left out; the run goes ahead without it.
  state.loras.alice = { ratings: { "klein.safetensors": "liked" } };
  await dream.save("alice", { enabled: true });
  assert.deepEqual((await dreamOnce())!.input.loras, []);
  state.loras.alice = {
    ratings: {
      "klein.safetensors": "liked",
      "not-installed.safetensors": "liked",
      "fox.safetensors": "liked",
      "film.safetensors": "liked",
      "ink.safetensors": "disliked",
    },
  };
  const loras = (job: { id: string }) =>
    (store.job("alice", job.id)!.input.loras as { name: string; strength: number }[]).map(
      (lora) => [lora.name, lora.strength],
    );
  // Liked alone: the first of those alike, at its recommended strength.
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
  assert.match(state.calls.at(-1)!.system, /change at least three/);
  assert.equal((tried.input.writing as { explore?: boolean }).explore, true);
  assert.match(String(tried.dream?.why), /^Testing ink · /);
  // Without LoRA access nothing is added.
  state.loras = {};
  const next = (await dreamOnce())!;
  assert.deepEqual(store.job("alice", next.id)!.input.loras, []);
});

test("Dream loads uncensored LoRAs only with Uncensored on", async (t) => {
  const explicit = { ...profiles[0], options: { loras: ["explicit.safetensors"] } };
  const { dream, state, store, dreamOnce } = fixture(t, [explicit]);
  state.loras.alice = { ratings: { "explicit.safetensors": "liked" } };
  state.access.alice!.uncensored = true;
  const lorasOf = (job: { id: string }) =>
    (store.job("alice", job.id)!.input.loras as { name: string }[]).map((lora) => lora.name);
  await dream.save("alice", { enabled: true });
  assert.deepEqual(lorasOf((await dreamOnce())!), []);
  await dream.save("alice", { enabled: true, uncensored: true });
  assert.deepEqual(lorasOf((await dreamOnce())!), ["explicit.safetensors"]);
});

test("Dream asks for natural expressions and adds face terms only to a recommended negative", async (t) => {
  const { dream, state, dreamOnce } = fixture(t, [profiles[0]]);
  state.negatives.flux = "blurry";
  await dream.save("alice", { enabled: true });
  const job = (await dreamOnce())!;
  assert.match(state.calls[0].system, /believable expressions that suit the moment/);
  assert.equal(
    job.input.negative,
    "blurry, exaggerated expression, grimace, distorted face, tongue out, gaping mouth",
  );
  state.negatives.flux = "";
  assert.equal((await dreamOnce())!.input.negative, undefined);
});

test("Dream adds no LoRAs on a profile that does best without them", async (t) => {
  const { dream, state, store, dreamOnce } = fixture(t, [
    { ...profiles[0], capabilities: { defaultLoras: false } },
  ]);
  state.loras.alice = { ratings: { "fox.safetensors": "liked" } };
  await dream.save("alice", { enabled: true });
  const job = (await dreamOnce())!;
  assert.deepEqual(store.job("alice", job.id)!.input.loras, []);
});

test("an exploited idea draws its steps, guidance and aspect ratio by taste", async (t) => {
  const { dream, taste, dreamOnce } = fixture(t, [
    { ...profiles[0], capabilities: { steps: true } },
  ]);
  taste.record("alice", [
    tasteSignal("like", "a", { profileId: "flux", steps: 28, cfg: 3.4, width: 832, height: 1216 }),
    tasteSignal("discard", "b", { profileId: "flux", steps: 12, cfg: 7, width: 1216, height: 832 }),
  ]);
  await dream.save("alice", { enabled: true });
  const job = (await dreamOnce())!;
  assert.deepEqual(
    [job.input.steps, job.input.cfg, job.input.width, job.input.height],
    [28, 3.5, 832, 1216],
  );
});

test("Dream mostly compares models and LoRAs, rarely steps or guidance, and steps only with a steps control", async (t) => {
  const asked = async (
    roll: number,
    {
      catalogue = [{ ...profiles[0], capabilities: { steps: true } }, profiles[1]],
      loras = [{ name: "fox.safetensors", strength: 1, enabled: true }],
    }: { catalogue?: DreamProfile[]; loras?: unknown[] } = {},
  ) => {
    const { dream, state, store, live, dreamOnce } = fixture(t, catalogue);
    const session = store.createSession("alice", "Gallery").id;
    const base = store.enqueue(
      "alice",
      session,
      { kind: "image", profileId: "flux", prompt: "a fox in snow", steps: 20, cfg: 3.5, loras },
      "image",
    );
    store.save({ ...base, status: "completed" });
    state.items.push({
      id: "base",
      jobId: base.id,
      ownerId: "alice",
      type: "image",
      status: "done",
      rating: "liked",
      prompt: "a fox in snow",
      settings: { profileId: "flux" },
    });
    // Fox is the one LoRA left unrated (klein is for another family).
    state.loras.alice = {
      ratings: { "film.safetensors": "disliked", "ink.safetensors": "disliked" },
    };
    await dream.save("alice", { enabled: true, dailyImages: 10 });
    for (let made = 0; made < 3; made++) assert.ok(await dreamOnce());
    // The comparison's draw, in millionths of the offered kinds' total weight.
    state.draws[1_000_000] = [roll];
    await dream.tick();
    const sides = live("alice").sort((a, b) => a.dream!.pair!.side - b.dream!.pair!.side);
    return [sides[0].dream?.pair?.question, ...sides.map((job) => job.dream?.pair?.label)];
  };
  // Model 35, LoRA 30, Strength 25, Wording 5, Steps 3, Guidance 2, of every hundred.
  assert.deepEqual(await asked(0), ["Which Model?", "FLUX", "Qwen"]);
  assert.deepEqual(await asked(340_000), ["Which Model?", "FLUX", "Qwen"]);
  assert.deepEqual(await asked(360_000), ["Which LoRA?", "With fox", "Without fox"]);
  assert.deepEqual(await asked(700_000), ["Which LoRA Strength?", "fox 1", "fox 0.65"]);
  assert.deepEqual(await asked(920_000), ["Which Wording?", "Original Wording", "New Wording"]);
  assert.deepEqual(await asked(960_000), ["Which Steps?", "20 Steps", "10 Steps"]);
  assert.deepEqual(await asked(990_000), ["Which Guidance?", "Guidance 3.5", "Guidance 5.5"]);
  // Without a LoRA, it tries one the account has not rated.
  assert.deepEqual(await asked(600_000, { loras: [] }), ["Which LoRA?", "Without fox", "With fox"]);
  // A fixed-step profile is never asked about steps: the same draw lands on Wording.
  assert.deepEqual(await asked(960_000, { catalogue: profiles }), [
    "Which Wording?",
    "Original Wording",
    "New Wording",
  ]);
});

test("Three-way Dream comparisons settle together, teach one choice and fall back to singles on failure", async (t) => {
  const fx = fixture(t, [...profiles, { id: "sdxl", kind: "image", label: "SDXL" }]);
  const { dream, state, store, taste, finish, live, dreamOnce } = fx;
  state.owners = ["alice"];
  const session = store.createSession("alice", "Gallery").id;
  const base = store.enqueue(
    "alice",
    session,
    { kind: "image", profileId: "flux", prompt: "a fox in snow" },
    "image",
  );
  store.save({ ...base, status: "completed" });
  state.items.push({
    id: "base",
    jobId: base.id,
    ownerId: "alice",
    type: "image",
    status: "done",
    rating: "liked",
    prompt: "a fox in snow",
    settings: { profileId: "flux" },
  });
  await dream.save("alice", { enabled: true, dailyImages: 6 });
  for (let made = 0; made < 3; made++) assert.ok(await dreamOnce());
  state.draws[4] = [0, 3];
  await dream.tick();
  const jobs = live("alice").sort((a, b) => a.dream!.pair!.side - b.dream!.pair!.side);
  assert.equal(jobs.length, 3);
  assert.deepEqual(
    new Set(jobs.map((job) => job.input.profileId)),
    new Set(["flux", "qwen", "sdxl"]),
  );
  assert.equal(new Set(jobs.map((job) => job.input.seed)).size, 1);
  assert.deepEqual(
    jobs.map((job) => job.dream?.pair?.size),
    [3, 3, 3],
  );

  const request = await serve(t, fx);
  const pair = jobs[0].dream!.pair!.id;
  const answer = `/pairs/${pair}/answer`;
  const items = jobs.map((job) => state.items.find((item) => item.jobId === job.id)!);
  finish("alice", jobs[0].id);
  finish("alice", jobs[1].id);
  assert.ok(items.every(({ id }) => !dream.unseen("alice").some((item) => item.id === id)));
  assert.equal((await request(answer, { answer: "c" })).status, 404);
  const before = (await request("/count")).body.images;
  finish("alice", jobs[2].id);
  assert.equal(dream.unseen("alice").filter((item) => item.dream?.pair?.id === pair).length, 3);
  assert.equal((await request("/count")).body.images, before + 1);
  assert.equal((await request(answer, { answer: "c", like: true })).status, 200);
  assert.deepEqual(
    items.map((item) => item.dream?.state),
    ["discarded", "discarded", "kept"],
  );
  assert.equal(items[2].rating, "liked");
  assert.deepEqual(
    items.map((item) => item.dream?.superLiked),
    [undefined, undefined, true],
  );
  assert.deepEqual(
    items.map((item) => item.dream?.comparison?.delta),
    [-8, -8, 16],
  );
  const { scores, signals: recorded } = taste.read("alice");
  const signals = recorded.filter((signal) => signal.kind === "preferred");
  assert.equal(signals.length, 1);
  assert.deepEqual(
    [signals[0].jobId, signals[0].over?.jobId, signals[0].third?.jobId],
    [jobs[2].id, jobs[0].id, jobs[1].id],
  );
  const [first, second, winner] = jobs.map(
    (job) => scores.get(`profile:${job.input.profileId}`)!.score,
  );
  assert.ok(first < 0 && second === first && winner === -2 * first);
  assert.equal((await request("/undo", { ids: [items[2].id] })).status, 409);
  assert.equal((await request("/undo", { ids: items.map((item) => item.id) })).status, 200);
  assert.ok(items.every((item) => item.dream?.state === "unseen" && !item.rating));
  assert.ok(items.every((item) => !item.dream?.superLiked));
  assert.deepEqual(dream.read("alice").ratings, {});
  assert.equal(taste.read("alice").signals.length, 0);

  const ids = items.map((item) => item.id);
  assert.equal((await request("/pass", { ids: ids.slice(0, 2), reason: "glitch" })).status, 409);
  assert.equal((await request("/pass", { ids, reason: "glitch" })).status, 200);
  assert.ok(items.every((item) => item.dream?.passReason === "glitch" && !item.rating));
  assert.equal(taste.read("alice").signals.length, 0);
  assert.equal((await request("/undo", { ids })).status, 200);
  assert.ok(items.every((item) => item.dream?.state === "unseen" && !item.dream.passReason));
  assert.equal((await request("/pass", { ids, reason: "taste" })).status, 200);
  assert.ok(items.every((item) => item.rating === "disliked"));
  assert.equal(taste.read("alice").signals[0].kind, "pair-neither");
  assert.equal((await request("/undo", { ids })).status, 200);
  assert.equal(taste.read("alice").signals.length, 0);

  // The third job can finish with no usable result, even with a stale pending tile.
  store.save({ ...store.job("alice", jobs[2].id)!, status: "failed" });
  items[2].status = "pending";
  const surviving = dream.unseen("alice").filter((item) => items.some(({ id }) => item.id === id));
  assert.deepEqual(
    new Set(surviving.map((item) => item.id)),
    new Set(items.slice(0, 2).map(({ id }) => id)),
  );
  assert.ok(surviving.every((item) => !item.dream?.pair));
  assert.equal((await request(answer, { answer: "a" })).status, 404);
  assert.equal(taste.read("alice").signals.length, 0);
  // A surviving side takes a single verdict and keeps its comparison record.
  dream.superLike("alice", String(surviving[0].id));
  assert.equal(items.find(({ id }) => id === surviving[0].id)!.dream?.pair?.size, 3);
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
    rating: "liked",
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
  // The header's count takes a comparison as one.
  const cards = dream.unseen("alice").filter((item) => !item.dream?.pair).length + 1;
  assert.deepEqual((await request("/count")).body, {
    unseen: cards,
    images: cards,
    videos: 0,
    active: true,
  });
  const pair = a.dream!.pair!.id;
  assert.equal((await request(`/pairs/${pair}/answer`, { answer: "maybe" })).status, 400);
  assert.equal(
    (await request(`/pairs/${pair}/answer`, { answer: "both", like: true })).status,
    400,
  );
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
  // B won: it rates above A.
  const sideB = state.items.find((item) => item.dream?.pair?.side === 1)!;
  assert.equal(dream.read("alice").ratings![String(sideB.id)], 1516);
  assert.equal(sideB.rating, undefined);

  const sides = state.items.filter((item) => item.dream?.pair?.id === pair);
  const undo = { ids: sides.map((item) => item.id) };
  assert.equal((await request("/undo", undo)).status, 200);
  assert.ok(sides.every((item) => item.dream?.state === "unseen"));
  assert.deepEqual(dream.read("alice").ratings, {});
  assert.equal((await request(`/pairs/${pair}/answer`, { answer: "b", like: true })).status, 200);
  assert.equal(sideB.dream?.state, "kept");
  assert.equal(sideB.rating, "liked");
  assert.equal(dream.read("alice").ratings![String(sideB.id)], 1516);
  assert.equal(
    taste.read("alice").signals.filter((signal) => signal.kind === "preferred").length,
    1,
  );
  assert.equal((await request("/undo", undo)).status, 200);
  assert.ok(sides.every((item) => item.dream?.state === "unseen" && !item.rating));
  assert.deepEqual(dream.read("alice").ratings, {});
  assert.equal(
    taste.read("alice").signals.filter((signal) => signal.kind === "preferred").length,
    0,
  );
  assert.equal((await request(`/pairs/${pair}/answer`, { answer: "b" })).status, 200);
  // The same image never starts a second comparison.
  assert.deepEqual(dream.read("alice").compared, ["base"]);

  // More Like This keeps the result and steers the next ideas toward its specific prompt.
  taste.edit("alice", { likes: ["lighthouses"], rules: ["no visible text"] });
  await dreamOnce();
  const [next] = dream.unseen("alice");
  assert.equal((await request(`/${next.id}/more`, {})).status, 200);
  const steered = (await dreamOnce())!;
  assert.equal((steered.input.writing as { like?: string }).like, next.prompt);
  assert.match(state.calls.at(-1)!.user, new RegExp(`More like this one: ${next.prompt}`));
  assert.match(
    state.calls.at(-1)!.user,
    /Taste profile: Likes lighthouses[\s\S]*Their rules:\n- no visible text/,
  );
  assert.equal(dream.read("alice").steer?.remaining, 1);
  // After the steer expires, new concepts still use taste and rules without the specific prompt.
  const before = state.calls.length;
  for (let run = 0; run < 4; run++) await dreamOnce();
  const later = state.calls
    .slice(before)
    .filter((call) => !call.user.includes("More like this one"));
  assert.ok(later.some((call) => /Taste profile:\nLikes: lighthouses/.test(call.user)));
  for (const call of later) assert.match(call.user, /Their rules:\n- no visible text/);
});

test("A Dream job's writing request keeps its own fields through admission", () => {
  const request = dreamRequest({
    kind: "dream",
    project: "beach",
    draft: "draft-beach",
    pins: { scenes: "scene-beach", unknown: "ignored" },
    seed: "a red kite",
    vary: "scene",
    note: "Continuing Beach",
    explore: true,
    extend: true,
    source: "a clip",
    series: {
      id: "set-1",
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
    note: "Continuing Beach",
    project: "beach",
    draft: "draft-beach",
    seed: "a red kite",
    vary: "scene",
    pins: { scenes: "scene-beach" },
    series: {
      id: "set-1",
      place: "a diner",
      night: "midnight",
      index: 1,
      length: 4,
    },
    loras: ["fox.safetensors"],
  });
});

test("Ideas recur in liked results, cards in two and projects in three, within limits and the 18+ floor, never repeating what the account has", () => {
  const liked = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const found = ideasFrom(
    {
      projects: [
        { name: "Neon Rooftops", subjects: "Mara on rooftops", styles: "neon", results: [1, 2, 3] },
        { name: "Diners", subjects: "all-night diners", styles: "", results: [1, 2] },
        { name: "Teens", subjects: "a 16 year old", styles: "", results: [1, 2, 3] },
        { name: "Beach", subjects: "the sea", styles: "", results: [1, 2, 3] },
      ],
      cards: [
        { kind: "Character", name: "Mara", description: "red hair, freckles", results: [1, 3, 3] },
        { kind: "outfit", name: "Green Cloak", description: "a long green cloak", results: [2] },
        { kind: "character", name: "Kid", description: "a 16 year old", results: [1, 2] },
        { kind: "scene", name: "Harbour", description: "a harbour at dusk", results: [2, 3] },
        { kind: "scene", name: "harbour", description: "the same harbour", results: [1, 2] },
        { kind: "character", name: "Ava", description: "dark hair", results: [1, 2] },
        { kind: "prop", name: "Lamp", description: "a brass lamp", results: [1, 2] },
      ],
    },
    {
      liked,
      taken: new Set(["card:characters:ava", "project:beach"]),
      minorAge: (text) => /\b16\b/.exec(text)?.[0] || "",
      at: "now",
    },
  );
  assert.deepEqual(
    found.map(({ kind, title, evidence }) => [kind, title, evidence]),
    [
      ["project", "Neon Rooftops", ["a", "b", "c"]],
      ["card", "Mara", ["a", "c"]],
      ["card", "Harbour", ["b", "c"]],
    ],
  );
  assert.deepEqual(ideasFrom(null, { liked, taken: new Set(), minorAge: () => "", at: "" }), []);
});

test("The Inbox proposes from likes while idle; a proposed project runs draft samples that Accept keeps and Dismiss deletes", async (t) => {
  const fx = fixture(t);
  const { dream, state, generated, inbox, projects, dreamOnce } = fx;
  const liked = (id: string) => ({
    id,
    ownerId: "alice",
    type: "image",
    status: "done",
    prompt: `Mara on a rooftop ${id}`,
    rating: "liked",
    jobId: `job-${id}`,
  });
  generated(...["1", "2", "3", "4", "5", "6"].map(liked));
  Object.assign(state.items[0], {
    caption: { text: "A wool coat outside a ferry terminal." },
    resultSet: {
      id: "set-1",
      title: "Mara",
      index: 0,
      context: { outfit: { name: "Green Wool Coat", description: "Green boiled wool" } },
    },
  });
  state.cards!.outfits.push({
    id: "outfit",
    name: "Green Wool Coat",
    description: "Green boiled wool",
    referenceIds: [],
    createdAt: "",
    updatedAt: "",
  });
  await dream.save("alice", { enabled: true, dailyImages: 10 });
  state.ideas = {
    projects: [
      { name: "Rooftops", subjects: "Mara on rooftops", styles: "neon", results: [1, 2, 3] },
      { name: "Harbours", subjects: "harbours at dusk", styles: "film", results: [4, 5, 6] },
    ],
    cards: [{ kind: "character", name: "Mara", description: "red hair", results: [1, 2] }],
  };
  await dreamOnce();
  const asked = state.calls.filter((call) => call.system.startsWith("You find what recurs"));
  assert.equal(asked.length, 1);
  assert.match(asked[0].system, /18 or older/);
  assert.match(asked[0].user, /Liked images:\n\[1\] Mara on a rooftop 1/);
  assert.match(asked[0].user, /Caption: A wool coat outside a ferry terminal\./);
  assert.match(asked[0].user, /outfit: Green Wool Coat\. Green boiled wool/);
  const proposals = () => inbox.read("alice").proposals;
  assert.deepEqual(
    proposals().map(({ kind, title }) => [kind, title]),
    [
      ["project", "Rooftops"],
      ["project", "Harbours"],
      ["card", "Mara"],
    ],
  );
  const [rooftops, harbours, mara] = proposals();
  assert.deepEqual(
    mara.evidence.map((item) => item.id),
    ["1", "2"],
  );
  // Each proposed project gets its samples, written to its brief, before Dream returns to its own work.
  for (let index = 0; index < 6; index++) await dreamOnce();
  const drafts = state.items.filter((item) => item.dream?.state === "draft");
  assert.deepEqual(
    drafts.map((item) => item.dream?.draft),
    [harbours.id, harbours.id, harbours.id, rooftops.id, rooftops.id, rooftops.id],
  );
  assert.match(state.calls.at(-1)!.user, /Project brief \(Harbours\):\n- Subjects: harbours/);
  await dreamOnce();
  assert.equal(state.items[0].dream?.state, "unseen");
  // Samples stay out of the deck until their project is accepted.
  assert.equal(dream.unseen("alice").length, 2);
  assert.equal(proposals()[0].drafts!.length, 3);

  const request = await serve(t, fx);
  const accepted = await request(`/inbox/${rooftops.id}/accept`, {});
  assert.deepEqual(accepted.body.accepted, { id: rooftops.id, title: "Rooftops" });
  const [made] = projects.list("alice");
  assert.deepEqual(
    [made.name, made.brief.subjects, made.changes?.[0].by],
    ["Rooftops", "Mara on rooftops", "dream"],
  );
  assert.equal(dream.unseen("alice").filter((item) => item.dream?.projectId === made.id).length, 3);
  // Dismissing deletes a project's samples, and its reason teaches the next batch.
  const dismissed = await request(`/inbox/${harbours.id}/dismiss`, { reason: "too quiet" });
  assert.deepEqual(
    dismissed.body.proposals.map((proposal: { title: string }) => proposal.title),
    ["Mara"],
  );
  assert.equal(state.items.filter((item) => item.dream?.state === "draft").length, 0);
  // Undo preserves attached chats and keeps the promoted media once its project is removed.
  projects.attach("alice", "chat", made.id);
  assert.equal((await request(`/inbox/${rooftops.id}/undo`, {})).status, 409);
  assert.equal(projects.chats("alice").chat.projectId, made.id);
  projects.attach("alice", "chat", null);
  const promoted = dream.unseen("alice").filter((item) => item.dream?.projectId === made.id);
  assert.equal((await request(`/inbox/${rooftops.id}/undo`, {})).status, 200);
  assert.deepEqual(projects.list("alice"), []);
  for (const item of promoted) {
    assert.equal(item.dream?.projectId, undefined);
    assert.equal(item.dream?.state, "unseen");
  }
  assert.equal((await request(`/inbox/${rooftops.id}/undo`, {})).status, 409);
  // A card proposal makes the card from the results it recurs in.
  state.cards!.characters.push({
    id: "existing",
    name: "ｍＡＲＡ",
    description: "Someone already saved earlier",
    referenceIds: [],
    createdAt: "",
    updatedAt: "",
  });
  assert.equal((await request(`/inbox/${mara.id}/accept`, {})).status, 409);
  assert.equal(state.cards!.characters.length, 1);
  state.cards!.characters.pop();
  await request(`/inbox/${mara.id}/accept`, {
    change: { card: { name: "Mara", description: "red hair, freckles" } },
  });
  assert.deepEqual(state.cards!.characters, [
    {
      id: "characters-1",
      name: "Mara",
      description: "red hair, freckles",
      referenceIds: ["asset-1", "asset-2"],
    },
  ]);
  state.cards!.characters[0].description = "red hair, freckles, glasses";
  assert.equal((await request(`/inbox/${mara.id}/undo`, {})).status, 409);
  assert.equal(state.cards!.characters[0].description, "red hair, freckles, glasses");
  // A batch waits six hours; then a dismissed idea stays snoozed and the writer hears why.
  await dream.tick();
  assert.equal(state.calls.filter((call) => call.system.startsWith("You find")).length, 1);
  state.clock += 6 * 3_600_000;
  await dream.tick();
  const again = state.calls.filter((call) => call.system.startsWith("You find")).at(-1)!;
  assert.match(again.user, /- Harbours: too quiet/);
  assert.deepEqual(
    proposals().map((proposal) => proposal.title),
    ["Rooftops"],
  );
  const [againRooftops] = proposals();
  await request(`/inbox/${againRooftops.id}/accept`, {});
  const [edited] = projects.list("alice");
  projects.update("alice", edited.id, { name: "Terraces" }, "you");
  assert.equal((await request(`/inbox/${againRooftops.id}/undo`, {})).status, 409);
  assert.equal(projects.list("alice")[0].name, "Terraces");
  // Clear Inbox dismisses everything.
  assert.deepEqual((await request("/inbox/clear", {})).body.proposals, []);
});

test("Independent matching named results save a card with Undo, while weaker evidence waits", async (t) => {
  const { state, generated, inbox } = fixture(t);
  const source = (id: string, set: string, ownerId = "alice", place?: string) => ({
    id,
    ownerId,
    type: "image",
    status: "done",
    prompt: "Walking outside a ferry terminal",
    rating: "liked",
    resultSet: {
      id: set,
      title: "Ferryside",
      index: 0,
      context: {
        outfit: { name: "Green Wool Coat", description: "Green boiled wool" },
        ...(place && { scene: { name: "Night Ferry", description: place } }),
      },
    },
  });
  const account = state.access.alice!.account!;
  generated(
    source("first", "same-set", "alice", "A dark ferry terminal"),
    source("second", "same-set"),
    source("different-owner", "other", "bob"),
  );
  await inbox.propose("alice", account);
  const initial = inbox.read("alice");
  assert.equal(initial.savedCards, undefined);
  assert.deepEqual(
    initial.proposals.map((entry) => entry.title),
    ["Green Wool Coat", "Night Ferry"],
  );
  assert.deepEqual(state.cards!.outfits, []);

  state.clock += 6 * 3_600_000;
  generated(
    source("third", "another-set", "alice", "A dark ferry terminal"),
    source("fourth", "fourth-set", "alice", "An open-air terminal in daylight"),
  );
  await inbox.propose("alice", account);
  const settled = inbox.read("alice");
  assert.deepEqual(
    settled.proposals.map((entry) => entry.title),
    ["Night Ferry"],
  );
  assert.deepEqual(
    state.cards!.outfits.map(({ name, referenceIds }) => [name, referenceIds]),
    [["Green Wool Coat", ["asset-first"]]],
  );
  assert.equal(settled.savedCards?.[0].title, "Green Wool Coat");
  assert.deepEqual(state.cards!.scenes, []);
  inbox.undo("alice", settled.savedCards![0].id);
  state.clock += 6 * 3_600_000;
  await inbox.propose("alice", account);
  assert.deepEqual(state.cards!.outfits, []);
  assert.equal(inbox.read("alice").savedCards, undefined);
});

test("A saved card stays gone once deleted, its images under another name wait, and a bare dismissal teaches", async (t) => {
  const { state, generated, inbox } = fixture(t);
  const account = state.access.alice!.account!;
  const liked = (id: string, outfit?: string) => ({
    id,
    ownerId: "alice",
    type: "image",
    status: "done",
    prompt: `By the ferry ${id}`,
    rating: "liked",
    jobId: `job-${id}`,
    ...(outfit && {
      resultSet: {
        id: `set-${id}`,
        title: "Ferryside",
        index: 0,
        context: { outfit: { name: outfit, description: "Green boiled wool" } },
      },
    }),
  });
  generated(
    liked("1", "Green Wool Coat"),
    liked("2", "Green Wool Coat"),
    ...["3", "4", "5", "6"].map((id) => liked(id)),
  );
  state.online.text = true;
  const mara = [
    { kind: "character", name: "Mara", description: "red hair", results: [3, 4] },
    { kind: "character", name: "Her Mara", description: "red-haired woman", results: [4, 5] },
  ];
  state.ideas = {
    projects: [],
    cards: [{ kind: "outfit", name: "Wool Coat", description: "green", results: [1, 2] }, ...mara],
  };
  await inbox.propose("alice", account);
  assert.deepEqual(
    state.cards!.outfits.map(({ name }) => name),
    ["Green Wool Coat"],
  );
  const [proposal] = inbox.read("alice").proposals;
  assert.deepEqual(
    inbox.read("alice").proposals.map(({ title }) => title),
    ["Mara"],
  );
  await inbox.dismiss("alice", proposal.id);
  state.cards!.outfits = [];
  state.ideas = { projects: [], cards: mara };
  state.clock += 6 * 3_600_000;
  await inbox.propose("alice", account);
  assert.deepEqual(state.cards!.outfits, []);
  assert.deepEqual(inbox.read("alice").proposals, []);
  const asked = state.calls.filter((call) => call.system.startsWith("You find")).at(-1)!;
  assert.match(asked.user, /turned these down.*\n- Mara$/m);
});

test("Dream keeps card evidence quoted from its prompts and learns from two kept runs", async (t) => {
  const { dream, state, dreamOnce, inbox } = fixture(t);
  const outfit = { name: "Green Wool Coat", description: "heavy wool with three brass toggles" };
  state.owners = ["alice"];
  state.replies.push(
    {
      prompt:
        "The Green Wool Coat, heavy wool with three brass toggles, hangs beside a clock in a bright photo studio.",
      cardContext: {
        outfit,
        scene: { name: "Night Ferry Terminal", description: "bright photo studio" },
      },
    },
    {
      prompt:
        "A sailor folds the Green Wool Coat, heavy wool with three brass toggles, as fog swallows the harbour.",
      cardContext: { outfit },
    },
  );
  await dream.save("alice", { enabled: true, dailyImages: 2 });
  const first = await dreamOnce();
  const second = await dreamOnce();
  assert.deepEqual(first?.dream?.cardContext, { outfit });
  assert.deepEqual(second?.dream?.cardContext, { outfit });
  assert.equal(
    first?.input.prompt,
    "The Green Wool Coat, heavy wool with three brass toggles, hangs beside a clock in a bright photo studio.",
  );
  for (const item of dream.unseen("alice")) dream.keep("alice", String(item.id));
  state.clock += 6 * 3_600_000;
  await inbox.propose("alice", state.access.alice!.account);
  assert.deepEqual(
    state.cards!.outfits.map(({ name }) => name),
    [outfit.name],
  );
  assert.deepEqual(state.cards!.scenes, []);
});

test("Brief edits, pacing and rules wait in the Inbox; Accept changes a project as Dream, with one Undo", async (t) => {
  const fx = fixture(t);
  const { dream, state, inbox, projects, taste } = fx;
  const beach = projects.create("alice", {
    name: "Beach",
    brief: { subjects: "the sea", avoid: "people" },
  });
  // Twelve discards and a keep, three of them missing the brief for crowds.
  for (let index = 0; index < 13; index++)
    state.items.push({
      id: `b${index}`,
      ownerId: "alice",
      type: "image",
      status: "done",
      prompt: `a beach ${index}`,
      dream: {
        state: index ? "discarded" : "kept",
        prompt: "",
        why: "",
        at: "",
        projectId: beach.id,
      },
      ...(index < 4 ? { review: { score: 3, miss: "crowds", model: "m", at: "" } } : {}),
    });
  state.issues = [
    {
      issue: "Waist too wide",
      rule: "always a narrow waist",
      count: 3,
      sources: { report: 1, review: 1, chat: 1 },
      examples: [{ id: "b1" }],
    },
  ];
  state.edits = {
    edits: [
      {
        project: 1,
        field: "avoid",
        text: "people, crowds",
        why: "Crowds keep showing",
        results: [1],
      },
    ],
  };
  await dream.save("alice", { enabled: true, dailyImages: 0 });
  await dream.tick();
  const edits = state.calls.filter((call) => call.system.startsWith("You improve the briefs"));
  assert.match(edits[0].user, /Project 1: Beach\n {2}subjects: the sea/);
  assert.match(edits[0].user, /Misses the brief:\n {2}\[1\] crowds/);
  const byKind = (kind: string) =>
    inbox.read("alice").proposals.find((proposal) => proposal.kind === kind)!;
  assert.deepEqual(
    inbox.read("alice").proposals.map(({ kind, title }) => [kind, title]),
    [
      ["pacing", "Pause Beach"],
      ["rule", "always a narrow waist"],
      ["brief", "Edit Beach's Avoid"],
    ],
  );
  const request = await serve(t, fx);
  // Edit then Accept may change only the fields the proposal changes.
  const edit = byKind("brief");
  assert.equal(
    (await request(`/inbox/${edit.id}/accept`, { change: { brief: { styles: "x" } } })).status,
    400,
  );
  assert.equal(
    (await request(`/inbox/${edit.id}/accept`, { change: { brief: { avoid: "people" } } })).status,
    409,
  );
  assert.equal((await request(`/inbox/${edit.id}/undo`, {})).status, 409);
  await request(`/inbox/${edit.id}/accept`, {
    change: { brief: { avoid: "people, crowds, boats" } },
  });
  let [project] = projects.list("alice");
  assert.equal(project.brief.avoid, "people, crowds, boats");
  assert.deepEqual(
    project.changes?.map(({ by, why, fields }) => [by, why, fields]),
    [["dream", "Crowds keep showing", ["avoid"]]],
  );
  await request(`/inbox/${byKind("pacing").id}/accept`, {});
  // Only the latest change can be undone.
  assert.equal((await request(`/inbox/${edit.id}/undo`, {})).status, 409);
  assert.equal((await request(`/projects/${beach.id}/undo`, {})).status, 200);
  [project] = projects.list("alice");
  assert.equal(project.paused, undefined);
  assert.equal(project.brief.avoid, "people, crowds, boats");
  const rule = byKind("rule");
  await request(`/inbox/${rule.id}/accept`, {});
  assert.deepEqual(taste.read("alice").rules, ["always a narrow waist"]);
  await request(`/inbox/${rule.id}/undo`, {});
  assert.deepEqual(taste.read("alice").rules, []);
  // A comparison's pick proposes the project's styles, a later pick on that axis replacing it.
  inbox.picked("alice", beach.id, "Lighting", "warm dusk", "you");
  inbox.picked("alice", beach.id, "Lighting", "cold dawn", "chat");
  const picks = inbox.read("alice").proposals.filter((proposal) => proposal.kind === "brief");
  assert.deepEqual(
    picks.map(({ change, why }) => [change.brief?.styles, why]),
    [["lighting: cold dawn", "A chat picked cold dawn for Lighting in a comparison"]],
  );
  state.clock += 6 * 3_600_000;
  const proposing = inbox.propose("alice");
  inbox.picked("alice", beach.id, "Lighting", "bright noon", "you");
  await proposing;
  assert.ok(
    inbox
      .read("alice")
      .proposals.some(({ change }) => change.brief?.styles === "lighting: bright noon"),
  );
});

test("A series follows a Super Liked concept, visiting liked scene cards first", async (t) => {
  const fx = fixture(t);
  const { dream, state, store, dreamOnce, taste } = fx;
  const scene = {
    createdAt: new Date(state.clock).toISOString(),
    updatedAt: new Date(state.clock).toISOString(),
    referenceIds: [],
  };
  state.cards!.scenes.push(
    {
      ...scene,
      id: "shed",
      name: "Shed",
      description: "a corrugated iron shed",
      rating: "disliked",
    },
    { ...scene, id: "pier", name: "Pier", description: "a pier over dark water", rating: "liked" },
  );
  const input = {
    kind: "image",
    profileId: "flux",
    prompt: "Mara, red hair and freckles, in a leather jacket",
    steps: 20,
    width: 832,
    height: 1216,
    loras: [{ name: "fox.safetensors", strength: 0.8, enabled: true }],
    referenceAssets: [{ assetId: "mara", slot: "reference" }],
  };
  const session = store.createSession("alice", "Gallery").id;
  for (const id of ["mara", "mara-2", "mara-3"]) {
    const job = store.enqueue("alice", session, input, "image", undefined, "worker:image", id);
    store.save({ ...job, status: "completed" });
    state.items.push({
      id,
      jobId: job.id,
      ownerId: "alice",
      type: "image",
      status: "done",
      title: "Mara",
      prompt: input.prompt,
      rating: "liked",
      dream: { state: "kept", prompt: input.prompt, why: "", at: "", superLiked: true },
    });
  }
  await dream.save("alice", { enabled: true });
  const jobs = [];
  for (let index = 0; index < 4; index++) {
    jobs.push((await dreamOnce())!);
    assert.equal(dream.unseen("alice").length, index === 3 ? 4 : 0);
  }
  const sets = jobs.map(
    (job) => job.input.resultSet as { id: string; title: string; index: number },
  );
  assert.equal(new Set(sets.map((set) => set.id)).size, 1);
  assert.deepEqual(
    sets.map((set) => [set.title, set.index]),
    [0, 1, 2, 3].map((index) => ["Mara · Night Out", index]),
  );
  for (const job of jobs) {
    assert.deepEqual(
      [job.input.profileId, job.input.steps, job.input.width, job.input.height],
      ["flux", 20, 832, 1216],
    );
    assert.deepEqual(job.input.loras, input.loras);
    assert.deepEqual(job.input.referenceAssets, input.referenceAssets);
    assert.equal(job.dream?.arm, "series");
  }
  // Each result moves on to a later time and a new place, hearing the ones before it.
  const written = state.calls.slice(-4);
  assert.match(written[0].system, /result 1 of 4 in a series/);
  assert.match(
    written[0].user,
    /Seed prompt: Mara, red hair and freckles, in a leather jacket\nIt loads these LoRAs: fox.safetensors\nPlace: Pier: a pier over dark water\nTime: dusk/,
  );
  assert.match(written[1].user, /Place: a rooftop bar above the city\nTime: early evening/);
  assert.ok(written.every(({ user }) => !user.includes("a corrugated iron shed")));
  assert.match(written[3].user, /Results so far:\n- dream 1\n- dream 2\n- dream 3/);
  assert.match(
    store.job("alice", jobs[0].id)!.dream!.why,
    /^Mara · Night Out \(1 of 4\): Pier, Dusk/,
  );
  const request = await serve(t, fx);
  const setId = sets[0].id;
  const ids = jobs.map((job) => `${job.id}-0`);
  assert.equal((await request("/count")).body.images, 1);
  const verdict = { ids, verdict: "like" };
  assert.equal((await request(`/sets/${setId}/answer`, verdict, "POST", "bob")).status, 409);
  assert.equal(
    (await request(`/sets/${setId}/answer`, { ...verdict, ids: ids.slice(0, 2) })).status,
    409,
  );
  assert.equal(
    (await request(`/sets/${setId}/answer`, { ...verdict, likedId: "mara" })).status,
    409,
  );
  assert.equal((await request(`/sets/${setId}/answer`, verdict)).status, 200);
  const members = () => ids.map((id) => state.items.find((item) => item.id === id)!);
  assert.equal(members()[0].rating, "liked");
  assert.equal((await request("/undo", { ids, setId })).status, 200);
  assert.equal(
    (await request(`/sets/${setId}/answer`, { ...verdict, likedId: ids[2] })).status,
    200,
  );
  assert.equal(dream.unseen("alice").length, 0);
  assert.deepEqual(
    members().map((item) => item.dream?.state),
    Array(4).fill("kept"),
  );
  assert.deepEqual(
    members().map((item) => item.rating),
    [undefined, undefined, "liked", undefined],
  );
  assert.deepEqual(
    members().map((item) => item.dream?.superLiked),
    [undefined, undefined, true, undefined],
  );
  assert.deepEqual(
    taste.read("alice").signals.map(({ kind, jobId }) => [kind, jobId]),
    [["like", jobs[2].id]],
  );
  assert.equal((await request("/undo", { ids, setId })).status, 200);
  assert.equal((await request("/count")).body.images, 1);
  assert.ok(
    members().every(
      (item) => item.dream?.state === "unseen" && !item.rating && !item.dream.superLiked,
    ),
  );
  assert.deepEqual(taste.read("alice").signals, []);
  assert.equal(
    (await request(`/sets/${setId}/answer`, { ...verdict, overrides: { mara: "like" } })).status,
    409,
  );
  assert.equal(
    (
      await request(`/sets/${setId}/answer`, {
        ...verdict,
        verdict: "discard",
        overrides: { [ids[0]]: "like" },
      })
    ).status,
    200,
  );
  assert.deepEqual(
    members().map((item) => item.rating),
    ["liked", "disliked", "disliked", "disliked"],
  );
  assert.deepEqual(
    members().map((item) => item.dream?.state),
    ["kept", "discarded", "discarded", "discarded"],
  );
  assert.equal((await request("/undo", { ids, setId })).status, 200);
  assert.equal(
    (
      await request(`/sets/${setId}/answer`, {
        ...verdict,
        likedId: ids[0],
        overrides: { [ids[0]]: "discard", [ids[1]]: "like" },
      })
    ).status,
    200,
  );
  assert.deepEqual(
    members().map((item) => item.rating),
    ["disliked", "liked", undefined, undefined],
  );
  assert.equal((await request("/undo", { ids, setId })).status, 200);
  assert.ok(members().every((item) => item.dream?.state === "unseen" && !item.rating));
  assert.deepEqual(taste.read("alice").signals, []);
  // The series is done; with a share's roll against it the next idea is an ordinary one.
  state.rolls = [99];
  const after = await dreamOnce();
  assert.equal(after?.input.resultSet, undefined);
  // A series whose image is no longer liked ends.
  await dreamOnce();
  state.items.find((item) => item.id === "mara")!.rating = undefined;
  const next = await dreamOnce();
  assert.equal(next?.input.resultSet, undefined);
  assert.equal(dream.read("alice").series, undefined);
});

test("Dream videos animate liked stills for most videos and Dream's keeps for the rest, extend kept videos, each once", async (t) => {
  const { dream, state, generated, dreamOnce, walks } = fixture(t, profiles);
  const frameOf = (job: Awaited<ReturnType<typeof dreamOnce>>) =>
    (job!.input.referenceAssets as { assetId: string; slot: string }[])[0];
  state.idleMinutes.video = 0;
  await dream.save("alice", {
    enabled: true,
    dailyImages: 0,
    videos: true,
    dailyVideos: 10,
  });
  generated({
    id: "liked",
    ownerId: "alice",
    type: "image",
    status: "done",
    prompt: "a liked still",
    rating: "liked",
  });
  const dreamed = (id: string, score: number, miss = "", kept = true) =>
    generated({
      id,
      ownerId: "alice",
      type: "image",
      status: "done",
      prompt: `still ${id}`,
      dream: { prompt: "", why: "", at: "", state: kept ? "kept" : "unseen", projectId: "beach" },
      review: { score, miss, model: "m", at: "" },
    });
  dreamed("good", 7);
  dreamed("best", 9);
  dreamed("miss", 3, "indoors");
  dreamed("unseen", 10, "", false);
  // A roll under 70 starts from the likes.
  const first = await dreamOnce();
  assert.equal(frameOf(first).assetId, "asset-liked");
  assert.equal(first?.dream?.arm, "animate");
  // Above it, from Dream's keeps, the best reviewed first.
  state.rolls = [70];
  const kept = await dreamOnce();
  assert.equal(frameOf(kept).assetId, "asset-best");
  assert.equal(kept?.dream?.projectId, "beach");
  assert.deepEqual(
    [(kept!.input.writing as { source?: string }).source, kept!.input.prompt],
    ["still best", ""],
  );
  // With no likes left, the keeps follow.
  assert.equal(frameOf(await dreamOnce()).assetId, "asset-good");
  // Each still is animated once; a miss or an unjudged result never is.
  assert.equal(await dreamOnce(), undefined);
  assert.match(dream.status("alice").reason!, /^Dream videos animate a kept or liked image/);

  // A kept video is extended from its last frame on its own model, never an extension again.
  generated({
    id: "clip",
    ownerId: "alice",
    type: "video",
    status: "done",
    prompt: "a clip",
    rating: "liked",
    settings: { profileId: "wan" },
  });
  const extension = await dreamOnce();
  assert.deepEqual(extension?.input.referenceAssets, [
    { assetId: "last-frame-clip", source: "gallery", slot: "start" },
  ]);
  assert.equal(extension?.dream?.arm, "extend");
  const { extend, source } = extension!.input.writing as { extend?: boolean; source?: string };
  assert.deepEqual([extend, source], [true, "a clip"]);
  assert.equal(await dreamOnce(), undefined);

  // Dream's videos wait for the local video worker.
  dreamed("last", 8);
  state.online.video = false;
  assert.equal(await dreamOnce(), undefined);
  assert.equal(dream.status("alice").reason, "The video worker is offline.");
  state.online.video = true;
  state.videoRefusal = "No video model can animate images.";
  assert.equal(await dreamOnce(), undefined);
  assert.equal(dream.status("alice").reason, state.videoRefusal);
  // A missing model isn't asked for again until the video profiles change or an hour passes.
  state.videoRefusal = "";
  assert.equal(await dreamOnce(), undefined);
  assert.equal(dream.status("alice").reason, "No video model can animate images.");
  state.clock += 3_600_000;
  assert.ok(await dreamOnce());
  assert.deepEqual(walks(), [], "Dream never walks the whole gallery");
});

test("Dream reports today's finished images alongside the video refusal", async (t) => {
  const { dream, state, dreamOnce } = fixture(t, profiles);
  await dream.save("alice", { enabled: true, dailyImages: 1, videos: true, dailyVideos: 1 });
  const image = await dreamOnce();
  assert.ok(image);
  dream.keep("alice", String(dream.unseen("alice")[0].id));
  state.videoRefusal = "No video model can animate images.";

  assert.equal(await dreamOnce(), undefined);
  assert.deepEqual(dream.status("alice"), {
    status: "unavailable",
    reason: "Dream has made today's images. No video model can animate images.",
  });
  state.clock += 86_400_000;
  assert.equal(dream.status("alice").reason, state.videoRefusal);
});

test("A Dream video skips a source that left the gallery and animates the next", async (t) => {
  const { dream, state, dreamOnce, finish, live, generated } = fixture(t, profiles);
  state.idleMinutes.video = 0;
  await dream.save("alice", {
    enabled: true,
    dailyImages: 0,
    videos: true,
    dailyVideos: 10,
  });
  for (const [id, score] of [
    ["gone", 9],
    ["next", 7],
  ] as const)
    generated({
      id,
      ownerId: "alice",
      type: "image",
      status: "done",
      prompt: `still ${id}`,
      dream: { prompt: "", why: "", at: "", state: "kept" },
      review: { score, miss: "", model: "m", at: "" },
    });
  state.gone.add("gone");
  const job = await dreamOnce();
  assert.deepEqual(job?.input.referenceAssets, [
    { assetId: "asset-next", source: "gallery", slot: "start" },
  ]);
  assert.deepEqual(dream.read("alice").animated, ["next", "gone"]);
  // With images capped, a second image worker's slot waits while Dream's one video runs.
  state.slots = 2;
  generated({ ...state.items.find((item) => item.id === "next")!, id: "more", jobId: undefined });
  await dream.tick();
  await dream.tick();
  assert.deepEqual(dream.status("alice"), {
    status: "waiting",
    reason: "Dream makes one video at a time.",
  });
  finish("alice", live("alice")[0].id);
  assert.equal(await dreamOnce(), undefined);
  assert.match(dream.status("alice").reason!, /^Dream videos animate a kept or liked/);
});

test("A failed Dream video sets its profile aside rather than sending the next one", async (t) => {
  const { dream, state, store, live, generated } = fixture(t, profiles);
  state.idleMinutes.video = 0;
  await dream.save("alice", {
    enabled: true,
    dailyImages: 0,
    videos: true,
    dailyVideos: 10,
  });
  for (const id of ["first", "second"])
    generated({
      id,
      ownerId: "alice",
      type: "image",
      status: "done",
      prompt: `still ${id}`,
      dream: { prompt: "", why: "", at: "", state: "kept" },
    });
  await dream.tick();
  // Its prompt was written: the worker failed it.
  const [job] = live("alice");
  const writing = { ...(job.input.writing as object), prompt: "a fox turns" };
  store.save({ ...job, status: "failed", input: { ...job.input, writing } });
  await dream.tick();
  assert.equal(live("alice").length, 0);
  assert.match(dream.status("alice").reason!, /last video on .* failed/);
});

test("administrator overrides win over account choices, which they leave saved, and lock them", async (t) => {
  const { dream, projects, inbox, state, dataDir, dreamOnce } = fixture(t);
  await dream.save("alice", { uncensored: true, dailyImages: 12 });
  state.overrides = { enabled: true, uncensored: false };
  assert.deepEqual(dream.locked(), ["enabled", "uncensored"]);
  assert.deepEqual(dream.read("alice").settings, {
    ...dreamDefaults,
    enabled: true,
    dailyImages: 12,
  });
  const forced = await dreamOnce();
  assert.equal(forced?.dream?.uncensored, undefined);
  assert.match(state.calls[0].system, /safe for work/);
  await assert.rejects(dream.save("alice", { uncensored: true }), { status: 409 });
  // Saving the forced value, or anything else, still works.
  await dream.save("alice", { enabled: true, dailyImages: 18 });
  assert.deepEqual(
    (readRuntimeDocument(dataDir, "dream:alice") as { settings: Partial<DreamSettings> }).settings,
    { uncensored: true, dailyImages: 18, enabled: true, paused: false },
  );
  state.overrides = {};
  assert.equal(dream.read("alice").settings.uncensored, true);
  assert.equal(dream.read("bob").settings.enabled, false);

  state.overrides = { imageBackend: "cloud" };
  const request = await serve(t, { dream, projects, inbox });
  assert.equal((await request("/settings", { imageBackend: "auto" }, "PUT")).status, 400);
  assert.equal((await request("/settings", { imageBackend: "local" }, "PUT")).status, 409);
  assert.deepEqual((await request("")).body.locked, ["imageBackend"]);
});

test("Dream's content setting limits image and video model choices and waiting work", async (t) => {
  const unrestrictedVideo = { ...profiles[2], id: "wan-unrestricted", uncensored: true };
  const { dream, state, dreamOnce, generated } = fixture(t, [
    {
      ...profiles[0],
      backendOptions: [
        { id: "radiance", profile: profiles[0] },
        { id: "comfyui", profile: { ...profiles[0], uncensored: true } },
      ],
    },
    ...profiles.slice(1),
    unrestrictedVideo,
  ]);
  state.access.alice!.uncensored = true;
  state.video = unrestrictedVideo.id;
  state.idleMinutes.video = 0;
  await dream.save("alice", { enabled: true });

  state.writingRefusal = "No text model is available for Dream's content setting.";
  assert.equal(await dreamOnce(), undefined);
  assert.match(dream.status("alice").reason!, /No text model is available/);
  state.writingRefusal = "";
  assert.equal((await dreamOnce())?.input.profileId, "qwen");
  assert.equal(dream.text("alice").censoredOnly, true);
  await dream.save("alice", { uncensored: true });
  assert.equal(dream.text("alice").censoredOnly, undefined);
  const unrestrictedImage = (await dreamOnce())!;
  assert.equal(unrestrictedImage.input.profileId, "flux");

  await dream.save("alice", { images: false, videos: true });
  for (const id of ["first-still", "second-still"])
    generated({
      id,
      ownerId: "alice",
      type: "image",
      status: "done",
      rating: "liked",
      prompt: `still ${id}`,
    });
  const video = (await dreamOnce())!;
  assert.equal(video.input.profileId, unrestrictedVideo.id);
  assert.equal(await dream.queuedProfileIssue(video), undefined);

  await dream.save("alice", { uncensored: false });
  for (const job of [unrestrictedImage, video])
    assert.match((await dream.queuedProfileIssue(job))!, /does not allow the selected model/);
  assert.equal(
    await dream.queuedProfileIssue({
      ...unrestrictedImage,
      input: { ...unrestrictedImage.input, profileBackend: "radiance" },
    }),
    undefined,
  );
  assert.equal((await dreamOnce())?.input.profileId, "wan");
});

test("Dream routes images to the selected allowed backend and never substitutes a local model for Cloud", async (t) => {
  const cloud = {
    id: "custom:cloud-image",
    provider: "cliproxyapi",
    kind: "image",
    label: "Cloud Image",
  };
  const fx = fixture(t, [...profiles, cloud]);
  // Favourite models that run only locally give way on Cloud, and its note says so.
  fx.taste.edit("alice", { models: ["flux"] });
  await fx.dream.save("alice", { enabled: true, imageBackend: "cloud" });
  fx.state.online.image = "parked";
  const job = await fx.dreamOnce();
  assert.equal(job?.input.profileId, cloud.id);
  assert.match(String(job?.dream?.why), /Your favourite models don't run on Cloud/);
  assert.equal(fx.state.onlineCalls.find((call) => call.backend === "cloud")?.kind, "image");
  await fx.dream.save("alice", { imageBackend: "local" });
  assert.equal(await fx.dreamOnce(), undefined);
  assert.match(fx.dream.status("alice").reason!, /stopped/);

  const denied = fixture(t);
  await denied.dream.save("alice", { enabled: true, imageBackend: "cloud" });
  assert.equal(await denied.dreamOnce(), undefined);
  assert.match(
    denied.dream.status("alice").reason!,
    /No ready cloud image model available to this account/,
  );
  denied.state.online.cloud = false;
  await denied.dream.tick();
  assert.match(denied.dream.status("alice").reason!, /cloud image service is offline/);
  denied.state.access.alice = null;
  const request = await serve(t, denied);
  assert.equal((await request("/settings", { imageBackend: "local" }, "PUT")).status, 403);
});

test("Dream sets aside a profile whose last three jobs failed until the failures age out", async (t) => {
  const fx = fixture(t, [profiles[0]]);
  await fx.dream.save("alice", { enabled: true });
  const fail = async () => {
    await fx.dream.tick();
    const [job] = fx.live("alice");
    assert.equal(job?.input.profileId, "flux");
    fx.store.save({ ...fx.store.job("alice", job.id)!, status: "failed" });
  };
  for (let run = 0; run < 3; run++) await fail();
  await fx.dream.tick();
  assert.equal(fx.live("alice").length, 0);
  fx.state.clock += 6 * 3_600_000 + 60_000;
  await fx.dream.tick();
  assert.equal(fx.live("alice")[0]?.input.profileId, "flux");
});

test("More Like This waits for its exact source profile when the Dream backend changes", async (t) => {
  const fx = fixture(t, [
    ...profiles,
    { id: "custom:cloud-image", provider: "cliproxyapi", kind: "image" },
  ]);
  await fx.dream.save("alice", { enabled: true });
  const source = (await fx.dreamOnce())!;
  fx.dream.more("alice", `${source.id}-0`);
  await fx.dream.save("alice", { imageBackend: "cloud" });
  assert.equal(await fx.dreamOnce(), undefined);
  assert.match(fx.dream.status("alice").reason!, /source image's model/);
  await fx.dream.save("alice", { imageBackend: "local" });
  const continued = await fx.dreamOnce();
  assert.equal(continued?.input.profileId, source.input.profileId);
  assert.equal(continued?.parentItemId, `${source.id}-0`);
  fx.dream.undo("alice", [`${source.id}-0`]);
  assert.equal(fx.dream.read("alice").steer, undefined);
  assert.ok(fx.dream.unseen("alice").some(({ id }) => id === `${source.id}-0`));
});

test("Dream videos honour a separate Cloud preference and retain source lineage", async (t) => {
  const cloud = {
    id: "custom:cloud-video",
    provider: "cliproxyapi",
    kind: "video",
    mediaInputs: [{ id: "start", required: true }],
  };
  const alternate = {
    ...cloud,
    id: "custom:another-cloud-video",
    mediaInputs: [
      { id: "end-frame", role: "end" },
      { id: "source-frame", role: "start", required: true },
    ],
  };
  const needsTwo = {
    ...alternate,
    id: "custom:two-frame-video",
    mediaInputs: alternate.mediaInputs.map((input) => ({ ...input, required: true })),
  };
  const fx = fixture(t, [...profiles, cloud, needsTwo, alternate]);
  fx.state.idleMinutes.video = 0;
  await fx.dream.save("alice", {
    enabled: true,
    images: false,
    videos: true,
    videoBackend: "cloud",
  });
  fx.state.video = cloud.id;
  fx.state.online.video = "parked";
  fx.generated({
    id: "kept",
    ownerId: "alice",
    type: "image",
    status: "done",
    rating: "liked",
    prompt: "A fox",
  });
  const job = await fx.dreamOnce();
  assert.equal(job?.input.profileId, cloud.id);
  assert.equal(job.parentItemId, "kept");
  assert.equal(
    (job?.input.referenceAssets as { assetId: string }[] | undefined)?.[0]?.assetId,
    "asset-kept",
  );
  assert.ok(fx.state.onlineCalls.some((call) => call.kind === "video" && call.backend === "cloud"));
  fx.generated({
    id: "clip",
    ownerId: "alice",
    type: "video",
    status: "done",
    rating: "liked",
    settings: { profileId: "wan" },
  });
  fx.generated({
    id: "other-still",
    ownerId: "alice",
    type: "image",
    status: "done",
    rating: "liked",
  });
  fx.state.draws[2] = [1];
  const varied = await fx.dreamOnce();
  assert.equal(varied?.input.profileId, alternate.id);
  assert.equal(varied.parentItemId, "other-still");
  assert.deepEqual(varied.input.referenceAssets, [
    { assetId: "asset-other-still", source: "gallery", slot: "source-frame" },
  ]);
  assert.equal(await fx.dreamOnce(), undefined);
  assert.match(fx.dream.status("alice").reason!, /source video's model isn't ready/);
  await fx.dream.save("alice", { videoBackend: "local" });
  fx.state.online.video = true;
  const extension = await fx.dreamOnce();
  assert.equal(extension?.input.profileId, "wan");
  assert.equal(extension?.dream?.arm, "extend");
  assert.equal(extension.parentItemId, "clip");
  assert.deepEqual(extension.input.referenceAssets, [
    { assetId: "last-frame-clip", source: "gallery", slot: "start" },
  ]);
});
