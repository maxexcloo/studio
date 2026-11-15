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
