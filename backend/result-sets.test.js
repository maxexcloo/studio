import assert from "node:assert/strict";
import test from "node:test";
import { findDirectRoute } from "./domain/direct-route.ts";
import { createPromptStage, writingRequest } from "./prompt-stage.js";
import { registerResultSetRoutes, setPrompts } from "./result-sets.js";

const set = { id: "set-a", title: "Variety Test", source: "Chat" };
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
  job("fox", 0, "A fox wizard"),
  job("owl", 1, "An owl librarian"),
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
      ownerId === "alice" && id === "fox:0" ? { id, jobId: "fox", resultSet: set } : undefined,
  });
  const route = findDirectRoute(app, "POST", "/api/result-sets/more");
  const reply = await route.run({ userId: "alice" }, { body: { itemId: "fox:0" } });
  assert.deepEqual(reply.payload, { jobIds: ["new-1", "new-2"] });
  assert.deepEqual(
    admitted.map(({ input, scope }) => [input.resultSet, input.writing, input.prompt, scope]),
    [2, 3].map((index) => [
      { ...set, index },
      { kind: "set" },
      "",
      { sessionId: "chat-a", operation: "image" },
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
  assert.equal((await route.run({ userId: "bob" }, { body: { itemId: "fox:0" } })).status, 404);
});

test("a set variation is written from the set's title and its prompts so far", async () => {
  assert.deepEqual(writingRequest({ kind: "set", prompt: "smuggled" }), { kind: "set" });
  assert.deepEqual(setPrompts(store, jobs[0]), ["A fox wizard", "An owl librarian"]);
  const calls = [];
  const stage = createPromptStage({
    engine: {
      model: async () => "writer",
      chat: async (request) => {
        calls.push(request);
        return { text: '{"title": "Heron Monk", "prompt": "A heron monk in a misty temple"}' };
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
    { ...job("new", 2, ""), input: { ...job("new", 2, "").input, writing: { kind: "set" } } },
    { signal: undefined, onThinking() {}, onDelta() {} },
  );
  assert.equal(written.prompt, "A heron monk in a misty temple");
  assert.equal(written.title, "Heron Monk");
  assert.match(calls[0].messages[0].content, /variation in the set "Variety Test"/);
  assert.match(calls[0].messages[1].content, /- A fox wizard\n- An owl librarian/);
});
