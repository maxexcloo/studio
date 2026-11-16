import assert from "node:assert/strict";
import test from "node:test";

import { findDirectRoute } from "./domain/direct-route.ts";
import { createPromptStage, writingRequest } from "./prompt-stage.js";
import { registerResultSetRoutes, setPrompts } from "./result-sets.js";

const set = { id: "set-a", title: "Generate images of a tiny", source: "LibreChat" };
const job = (id, index, prompt, extra = {}) => ({
  id,
  ownerId: "alice",
  sessionId: "chat-a",
  operation: "image",
  input: {
    kind: "image",
    profileId: "image:test",
    prompt,
    count: 2,
    seed: "7",
    clientJobId: id,
    assistant: { preset: "rewrite" },
    resultSet: { ...set, index, variation: `Variation ${index}` },
  },
  ...extra,
});
const jobs = [
  job("puppy", 0, "A tiny sleeping Maltese Shih Tzu puppy on a velvet cushion"),
  job("frog", 1, "A frog on a lily pad", { parentJobId: "puppy" }),
  { ...job("other", 0, "Elsewhere"), input: { kind: "image", prompt: "Elsewhere" } },
];
const store = {
  job: (ownerId, id) => jobs.find((item) => item.ownerId === ownerId && item.id === id),
  jobs: (ownerId, sessionId) =>
    jobs.filter((item) => item.ownerId === ownerId && item.sessionId === sessionId),
};

test("More Like This Set queues two written variations after the set's last, with its run's settings", async () => {
  const admitted = [];
  const app = { post() {} };
  registerResultSetRoutes(app, {
    store,
    admit: async (input, account, scope) => {
      admitted.push({ input, scope });
      return { status: 200, payload: { jobId: `new-${admitted.length}` } };
    },
    item: (ownerId, id) =>
      ownerId === "alice" && id === "puppy:0" ? { id, jobId: "puppy", resultSet: set } : undefined,
  });
  const route = findDirectRoute(app, "POST", "/api/result-sets/more");
  const reply = await route.run({ userId: "alice" }, { body: { itemId: "puppy:0" } });
  assert.deepEqual(reply.payload, { jobIds: ["new-1", "new-2"] });
  assert.deepEqual(
    admitted.map(({ input, scope }) => [input.resultSet, input.writing, input.prompt, scope]),
    [2, 3].map((index) => [
      { ...set, index },
      { kind: "set" },
      "",
      { sessionId: "chat-a", operation: "image", parentJobId: "puppy", parentItemId: "puppy:0" },
    ]),
  );
  // A fresh seed and id, the run's count and profile, and no record of the original's writing.
  const [{ input }] = admitted;
  assert.equal(input.seed, "");
  assert.equal(input.count, 2);
  assert.equal(input.profileId, "image:test");
  assert.equal(input.clientJobId, undefined);
  assert.equal(input.assistant, undefined);
  // Only the owner's own set item continues.
  assert.equal((await route.run({ userId: "bob" }, { body: { itemId: "puppy:0" } })).status, 404);
});

test("set writing keeps the selected source authoritative over a truncated title and off-topic additions", async () => {
  assert.deepEqual(writingRequest({ kind: "set", prompt: "smuggled" }), { kind: "set" });
  assert.deepEqual(setPrompts(store, jobs[0]), {
    source: jobs[0].input.prompt,
    prompts: [jobs[1].input.prompt],
  });
  const calls = [];
  const stage = createPromptStage({
    engine: {
      model: async () => "writer",
      chat: async (request) => {
        calls.push(request);
        return {
          text: '{"title": "Sleeping Puppy", "prompt": "A tiny sleeping Maltese Shih Tzu puppy curled beside a window"}',
        };
      },
    },
    account: () => undefined,
    profiles: async () => [{ id: "image:test", label: "Image Quality" }],
    guide: () => null,
    dream: () => null,
    frame: async () => null,
    setPrompts: (current) => setPrompts(store, current),
  });
  const written = await stage(
    {
      ...job("new", 2, ""),
      parentJobId: "puppy",
      input: { ...job("new", 2, "").input, writing: { kind: "set" } },
    },
    { signal: undefined, onThinking() {}, onDelta() {} },
  );
  assert.equal(written.prompt, "A tiny sleeping Maltese Shih Tzu puppy curled beside a window");
  assert.equal(written.title, "Sleeping Puppy");
  const [system, context] = calls[0].messages;
  assert.match(system.content, /Preserve its species, breed, identity and defining appearance/);
  assert.match(system.content, /never switch animal species or replace the subject/);
  assert.match(system.content, /ignore any that drift away from the source/);
  assert.match(
    context.content,
    /Source prompt \(authoritative subject and theme\):\nA tiny sleeping Maltese Shih Tzu puppy/,
  );
  assert.match(context.content, /Previous variations.*\n- A frog on a lily pad/);
  assert.equal(
    context.content.split(jobs[0].input.prompt).length,
    2,
    "the full source appears only once",
  );
});

test("continuing an off-topic addition follows durable lineage back to the selected original", () => {
  const drifted = {
    ...jobs[1],
    input: { ...jobs[1].input, writing: { kind: "set", title: "Frog" } },
  };
  const lineageStore = {
    ...store,
    job: (ownerId, id) => (id === "frog" && ownerId === "alice" ? drifted : store.job(ownerId, id)),
  };
  const next = job("next", 3, "", { parentJobId: "frog" });
  next.input.writing = { kind: "set" };
  assert.equal(setPrompts(lineageStore, next).source, jobs[0].input.prompt);
  next.ownerId = "bob";
  assert.throws(() => setPrompts(lineageStore, next), /source is unavailable/);
  next.ownerId = "alice";
  next.sessionId = "another-chat";
  assert.throws(() => setPrompts(lineageStore, next), /source is unavailable/);
});

test("missing or cyclic continuation lineage fails instead of making recent off-topic prompts authoritative", () => {
  const next = job("next", 3, "", { parentJobId: "missing" });
  next.input.writing = { kind: "set" };
  assert.throws(() => setPrompts(store, next), /source is unavailable/);
  delete next.parentJobId;
  assert.throws(() => setPrompts(store, next), /source is unavailable/);
  next.parentJobId = next.id;
  assert.throws(() => setPrompts({ ...store, job: () => next }, next), /source is unavailable/);
});

test("image scope anchors the exact selected output rather than its set ancestor, keeping references and intent", async () => {
  const references = [
    { assetId: "alice-face", slot: "subject", strength: 0.75 },
    { assetId: "alice-scene", slot: "scene" },
  ];
  const selected = {
    id: "frog:1",
    jobId: "frog",
    type: "image",
    resultSet: set,
    prompt: "trigger, A green frog with golden eyes",
    settings: { typedPrompt: "A green frog with golden eyes" },
  };
  const current = {
    ...jobs[1],
    input: {
      ...jobs[1].input,
      writing: { kind: "set" },
      typedPrompt: "old typed prompt",
      referenceAssets: references,
      referenceDetails: [{ id: "alice-face", slot: "subject" }],
      character: { id: "alice-character" },
    },
  };
  const currentStore = {
    ...store,
    job: (owner, id) => (owner === "alice" && id === "frog" ? current : store.job(owner, id)),
  };
  const item = (owner, id) => (owner === "alice" && id === selected.id ? selected : undefined);
  const admitted = [];
  const app = { post() {} };
  registerResultSetRoutes(app, {
    store: currentStore,
    item,
    admit: async (input, account, scope) => {
      admitted.push({ input, account, scope });
      return { status: 200, payload: { jobId: `new-${admitted.length}` } };
    },
  });
  const route = findDirectRoute(app, "POST", "/api/result-sets/more");
  const account = { userId: "alice" };
  assert.equal(
    (await route.run(account, { body: { itemId: selected.id, scope: "image" } })).status,
    200,
  );
  assert.equal(admitted.length, 2);
  const first = admitted[0];
  assert.equal(first.account, account);
  assert.deepEqual(first.input.referenceAssets, references);
  assert.deepEqual(first.input.referenceDetails, current.input.referenceDetails);
  assert.deepEqual(first.input.character, current.input.character);
  assert.equal(first.input.profileId, current.input.profileId);
  assert.equal(first.input.count, current.input.count);
  assert.equal(
    first.input.typedPrompt,
    undefined,
    "the writer's new prompt must not inherit a stale typed prompt",
  );
  assert.deepEqual(first.input.writing, { kind: "set", scope: "image" });
  assert.deepEqual(first.scope, {
    sessionId: "chat-a",
    operation: "image",
    parentJobId: "frog",
    parentItemId: selected.id,
  });
  const queued = { ...current, ...first.scope, id: "new-1", input: first.input };
  assert.deepEqual(setPrompts(currentStore, queued, item), {
    source: selected.settings.typedPrompt,
    prompts: [],
  });
  assert.equal(
    setPrompts(
      currentStore,
      { ...queued, input: { ...queued.input, writing: { kind: "set" } } },
      item,
    ).source,
    jobs[0].input.prompt,
  );
  assert.deepEqual(writingRequest({ kind: "set", scope: "image", source: "smuggled puppy" }), {
    kind: "set",
    scope: "image",
  });
  const calls = [];
  const frames = [];
  const stage = createPromptStage({
    engine: {
      model: async () => "writer",
      supportsVision: async () => true,
      chat: async (request) => {
        calls.push(request);
        return { text: '{"prompt":"A green frog with golden eyes beside a pond"}' };
      },
    },
    account: () => undefined,
    profiles: async () => [{ id: "image:test", label: "Image Quality" }],
    guide: () => null,
    frame: async (account, id) => {
      frames.push({ account, id });
      return { mime: "image/png", data: "SELECTED_FRAME" };
    },
    caption: () => {
      throw new Error("vision must read the selected frame");
    },
    setPrompts: (job) => setPrompts(currentStore, job, item),
  });
  const written = await stage(queued, { onThinking() {}, onDelta() {} });
  assert.equal(written.prompt, "A green frog with golden eyes beside a pond");
  assert.match(calls[0].messages[0].content, /variation of the selected image/);
  assert.match(calls[0].messages[0].content, /Preserve its species, breed, identity/);
  assert.deepEqual(frames, [{ account: undefined, id: selected.id }]);
  assert.deepEqual(calls[0].messages[1].content[1], {
    type: "image_url",
    image_url: { url: "data:image/png;base64,SELECTED_FRAME" },
  });
  assert.match(calls[0].messages[1].content[0].text, /A green frog with golden eyes/);
  assert.doesNotMatch(calls[0].messages[1].content[0].text, /Maltese|Shih Tzu|puppy|lily pad/);
  for (const invalid of [
    { ...queued, ownerId: "bob" },
    { ...queued, sessionId: "another-chat" },
    { ...queued, parentItemId: "puppy:0" },
  ])
    assert.throws(() => setPrompts(currentStore, invalid, item), /source image is unavailable/);
  assert.equal(
    (await route.run({ userId: "bob" }, { body: { itemId: selected.id, scope: "image" } })).status,
    404,
  );
  assert.equal(
    (await route.run(account, { body: { itemId: selected.id, scope: "all" } })).status,
    400,
  );
  assert.equal(admitted.length, 2, "refused scopes never admit a job");
});

test("image scope works outside result sets, and still enforces assistant access at writing", async () => {
  const original = { ...jobs[2], input: { ...jobs[2].input, profileId: "image:test" } };
  const selected = {
    id: "other:0",
    jobId: original.id,
    type: "image",
    prompt: original.input.prompt,
  };
  const item = (owner, id) => (owner === "alice" && id === selected.id ? selected : undefined);
  const admitted = [];
  const app = { post() {} };
  registerResultSetRoutes(app, {
    store: { ...store, job: () => original },
    item,
    admit: async (input, account, scope) => {
      admitted.push({ input, scope });
      return { status: 200, payload: { jobId: "new" } };
    },
  });
  const route = findDirectRoute(app, "POST", "/api/result-sets/more");
  const account = { userId: "alice" };
  assert.equal((await route.run(account, { body: { itemId: selected.id } })).status, 404);
  assert.equal(
    (await route.run(account, { body: { itemId: selected.id, scope: "image" } })).status,
    200,
  );
  assert.equal(admitted[0].input.resultSet, undefined);
  const queued = { ...original, ...admitted[0].scope, input: admitted[0].input };
  assert.equal(setPrompts(store, queued, item).source, "Elsewhere");
  const stage = createPromptStage({
    engine: {},
    account: () => ({ authenticated: true, features: { promptAssistant: false } }),
  });
  await assert.rejects(stage(queued, {}), /prompt assistant is off/);
});

test("image scope uses only its selected image's caption for a writer without vision", async () => {
  const item = { id: "frog:1", jobId: "frog", type: "image", prompt: "A green frog" };
  const queued = { ...job("new", 3, ""), parentJobId: "frog", parentItemId: item.id };
  queued.input.writing = { kind: "set", scope: "image" };
  const described = [];
  const calls = [];
  const stage = createPromptStage({
    engine: {
      model: async () => "text-writer",
      supportsVision: async () => false,
      chat: async (request) => {
        calls.push(request);
        return { text: '{"prompt":"A green frog with golden eyes beside a pond"}' };
      },
    },
    account: () => undefined,
    profiles: async () => [{ id: "image:test" }],
    guide: () => null,
    setPrompts: (current) => setPrompts(store, current, () => item),
    frame: () => {
      throw new Error("a text writer must not fetch pixels");
    },
    caption: (account, id) => {
      described.push({ account, id });
      return "A green frog with golden eyes on a stone";
    },
  });
  await stage(queued, {});
  assert.deepEqual(described, [{ account: undefined, id: item.id }]);
  assert.match(
    calls[0].messages[1].content,
    /What the selected image shows: A green frog with golden eyes/,
  );
  assert.doesNotMatch(calls[0].messages[1].content, /Maltese|Shih Tzu|puppy/);
});
