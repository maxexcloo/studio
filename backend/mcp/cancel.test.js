import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import express from "express";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-mcp-cancel-"));
process.env.STUDIO_DATA_DIR = dataDir;
process.env.STUDIO_MULTI_USER = "1";
const { accountAccessForId, createLocalAccount } = await import("../account-store.js");
const { GenerationQueue } = await import("../domain/queue.ts");
const { registerQueueRoutes, unconfirmedCancel } = await import("../domain/routes.ts");
const { Store, queuePriority } = await import("../domain/store.ts");
const { registerJobRoutes } = await import("../job-routes.js");
const { mcpOwnership } = await import("../persistence/mcp-ownership.ts");
const { closeRuntimeDatabase, openDatabase, runtimeDatabase } =
  await import("../persistence/runtime.ts");
const { registerMcpRoutes } = await import("./mcp.js");
const { createMcpDomainRequest } = await import("./studio-requests.js");
const alice = await createLocalAccount({
  username: "alice",
  password: "fixture-password",
  role: "administrator",
});
const bob = await createLocalAccount({
  username: "bob",
  password: "fixture-password",
  role: "administrator",
});
after(() => {
  closeRuntimeDatabase(dataDir);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function fixture(t, conversation = "") {
  const store = new Store(openDatabase(":memory:"));
  const jobs = {};
  // pending and confirmed came from chat-a; the rest from elsewhere.
  for (const [name, owner, status, chat] of [
    ["pending", alice.id, "queued", "chat-a"],
    ["requested", alice.id, "running", "chat-b"],
    ["confirmed", alice.id, "running", "chat-a"],
    ["unconfirmed", alice.id, "running"],
    ["completed", alice.id, "completed", "chat-a"],
    ["failed", alice.id, "failed"],
    ["dream", alice.id, "queued"],
    ["foreign", bob.id, "queued", "chat-a"],
  ]) {
    const session = store.createSession(owner);
    const input = chat ? { chat: { conversationId: chat } } : {};
    const job = store.enqueue(owner, session.id, input, "image", undefined, undefined, name);
    store.save({
      ...job,
      status,
      ...(status === "running" ? { providerJobId: `provider-${name}` } : {}),
      ...(name === "dream" ? { priority: queuePriority.dream } : {}),
    });
    jobs[name] = store.job(owner, job.id);
  }
  const providerCalls = [];
  const queue = new GenerationQueue(store, {
    async submit() {
      throw new Error("This fixture must never submit work.");
    },
    async observe() {},
    async cancel(job) {
      providerCalls.push(job.id);
      if (job.id === jobs.unconfirmed.id) throw new Error("Fixture provider unavailable");
      if (job.id === jobs.confirmed.id) return { status: "cancelled", reason: "Provider stopped" };
    },
    async saveOutputs() {},
  });
  queue.stop();
  const app = express();
  app.use(express.json());
  registerQueueRoutes(app, {
    store,
    queue,
    admit: async () => {
      throw new Error("This fixture must never admit work.");
    },
    media: () => [],
    ownsItem: () => false,
  });
  registerJobRoutes(app, { store, queue });
  const requests = [];
  const domainRequest = createMcpDomainRequest({ app });
  let base = "http://127.0.0.1:1";
  const mcp = registerMcpRoutes(app, {
    dataDir,
    baseUrl: () => base,
    environment: { STUDIO_MCP_API_KEY: "fixture-gateway" },
    accountMode: true,
    authenticateGatewayIdentity: (id) => accountAccessForId(id),
    domainRequest: async (...args) => {
      const answer = await domainRequest(...args);
      requests.push({ method: args[0], route: args[1], answer });
      return answer;
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
  const client = new Client({ name: "cancel-fixture", version: "1.0.0" });
  t.after(async () => {
    mcp.endWaits();
    await client.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    queue.stop();
    store.close();
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: {
        headers: {
          Authorization: "Bearer fixture-gateway",
          "x-ai-user-id": alice.id,
          ...(conversation ? { "x-studio-conversation-id": conversation } : {}),
        },
      },
    }),
  );
  const call = (name, args) => client.callTool({ name, arguments: args });
  const rows = mcpOwnership(runtimeDatabase(dataDir));
  return { call, jobs, providerCalls, requests, rows, store };
}

const data = (reply) => {
  assert.notEqual(reply.isError, true, JSON.stringify(reply.content));
  return JSON.parse(reply.content.find((item) => item.type === "text").text);
};

test("SDK Cancel All counts a pending cancellation without a requested flag", async (t) => {
  const f = await fixture(t);
  for (const name of ["confirmed", "requested", "unconfirmed"])
    f.store.save({ ...f.jobs[name], status: "completed" });
  assert.deepEqual(data(await f.call("queue", { action: "cancel_all", scope: "account" })), {
    scope: "account",
    cancelled: 1,
  });
  assert.equal(f.requests[0].answer.payload.outcomes[0].cancelRequested, false);
  assert.deepEqual(f.providerCalls, []);
});

test("SDK Cancel All counts real route confirmations and acknowledged requests, excluding provider errors", async (t) => {
  const f = await fixture(t);
  const reply = data(await f.call("queue", { action: "cancel_all", scope: "account" }));
  assert.deepEqual(reply, {
    scope: "account",
    cancelled: 3,
    note: "Some jobs could not confirm their cancel; check queue list.",
  });
  assert.deepEqual(
    f.requests.map(({ method, route }) => [method, route]),
    [["POST", "/api/queue/cancel-all"]],
  );
  const outcomes = f.requests[0].answer.payload.outcomes;
  assert.deepEqual(outcomes.map(({ job }) => job.id).sort(), [
    "confirmed",
    "pending",
    "requested",
    "unconfirmed",
  ]);
  const pending = outcomes.find(({ job }) => job.id === "pending");
  assert.equal(pending.job.status, "cancelled");
  assert.equal(pending.cancelRequested, false);
  const requested = outcomes.find(({ job }) => job.id === "requested");
  assert.equal(requested.job.status, "running");
  assert.equal(requested.cancelRequested, true);
  const unconfirmed = outcomes.find(({ job }) => job.id === "unconfirmed");
  assert.equal(unconfirmed.job.status, "running");
  assert.equal(unconfirmed.cancelRequested, true);
  assert.equal(unconfirmed.error, unconfirmedCancel);
  assert.deepEqual(f.providerCalls.sort(), ["confirmed", "requested", "unconfirmed"]);
  for (const name of ["completed", "dream", "failed", "foreign"])
    assert.deepEqual(f.store.job(f.jobs[name].ownerId, name), f.jobs[name]);
  assert.deepEqual(data(await f.call("queue", { action: "cancel_all", scope: "account" })), {
    scope: "account",
    cancelled: 1,
    note: "Some jobs could not confirm their cancel; check queue list.",
  });
});

test("SDK Cancel All stops only the calling chat's work unless asked for the account", async (t) => {
  const unnamed = await fixture(t);
  const refused = await unnamed.call("queue", { action: "cancel_all" });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /no conversation id.*scope "account"/);
  assert.deepEqual(unnamed.requests, []);

  const f = await fixture(t, "chat-a");
  assert.deepEqual(data(await f.call("queue", { action: "cancel_all" })), {
    scope: "chat",
    cancelled: 2,
  });
  assert.deepEqual(f.providerCalls, ["confirmed"]);
  assert.equal(f.store.job(alice.id, "pending").status, "cancelled");
  for (const name of ["requested", "unconfirmed", "completed", "failed", "dream", "foreign"])
    assert.deepEqual(f.store.job(f.jobs[name].ownerId, name), f.jobs[name]);
  const misplaced = await f.call("queue", { action: "list", scope: "account" });
  assert.equal(misplaced.isError, true);
  assert.match(misplaced.content[0].text, /scope is for cancel_all/);
});

test("SDK Cancel preserves ownership, stale responses and provider errors with only its mutation route", async (t) => {
  const f = await fixture(t);
  // Queue list is the production path that adopts existing account-owned jobs into MCP.
  data(await f.call("queue", { action: "list" }));
  f.requests.length = 0;
  assert.deepEqual(data(await f.call("cancel", { job_id: "pending" })), { ok: true });
  assert.equal(f.store.job(alice.id, "pending").status, "cancelled");
  assert.deepEqual(data(await f.call("cancel", { job_id: "requested" })), { ok: true });
  assert.equal(f.store.job(alice.id, "requested").status, "running");
  assert.equal(f.store.job(alice.id, "requested").cancelRequested, true);
  const refused = await f.call("cancel", { job_id: "unconfirmed" });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /Cancellation could not be confirmed/);
  assert.equal(f.requests.at(-1).answer.status, 503);
  const count = f.requests.length;
  const foreign = await f.call("cancel", { job_id: "foreign" });
  assert.equal(foreign.isError, true);
  assert.match(foreign.content[0].text, /submitted by this account/);
  assert.equal(f.requests.length, count);
  // Even stale MCP ownership cannot bypass the mutation route's account check.
  f.rows.setJobOwner("foreign", alice.id);
  f.rows.setJobOwner("missing", alice.id);
  for (const job_id of ["foreign", "missing"])
    assert.deepEqual(data(await f.call("cancel", { job_id })), {
      ok: true,
      stale: true,
      changed: false,
    });
  assert.deepEqual(f.store.job(bob.id, "foreign"), f.jobs.foreign);
  assert.deepEqual(f.providerCalls, ["requested", "unconfirmed"]);
  assert.deepEqual(
    f.requests.map(({ method, route }) => [method, route]),
    [
      ["POST", "/api/jobs/pending/cancel"],
      ["POST", "/api/jobs/requested/cancel"],
      ["POST", "/api/jobs/unconfirmed/cancel"],
      ["POST", "/api/jobs/foreign/cancel"],
      ["POST", "/api/jobs/missing/cancel"],
    ],
  );
});
