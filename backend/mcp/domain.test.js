import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGenerationAdmission } from "../domain/admission.ts";
import { findDirectRoute } from "../domain/direct-route.ts";
import { GenerationQueue } from "../domain/queue.ts";
import { registerQueueRoutes } from "../domain/routes.ts";
import { Store } from "../domain/store.ts";
import { openDatabase } from "../persistence/runtime.ts";
import { McpMedia } from "./media.js";

test("MCP generation uses shared durable admission and owned reads without HTTP", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "studio-mcp-domain-"));
  const store = new Store(openDatabase(":memory:"));
  const submitted = [];
  const queue = new GenerationQueue(store, {
    async submit(job) {
      submitted.push(job.id);
      return { status: "running", providerJobId: job.id };
    },
    async observe() {},
    async cancel() {},
    async saveOutputs() {},
  });
  // Persist admission without a background submit racing assertions.
  queue.stop();
  const accounts = new Map([
    ["alice", { authenticated: true, role: "user", userId: "alice" }],
    ["bob", { authenticated: true, role: "user", userId: "bob" }],
    ["disabled", { authenticated: false, role: "user", userId: "disabled" }],
  ]);
  const admit = createGenerationAdmission({
    store,
    queue,
    async validate(input) {
      return input.prompt
        ? { status: 200, payload: {} }
        : { status: 400, payload: { error: "Enter a prompt." } };
    },
    async resourceFor() {
      return "worker:fixture";
    },
    pendingItems: (id) => [{ jobId: id, status: "pending", type: "image" }],
    revision: () => 1,
  });
  const calls = [];
  const app = {};
  registerQueueRoutes(app, {
    store,
    queue,
    admit,
    media: () => assert.fail("counting unfinished outputs should not load gallery media"),
    ownsItem: () => false,
  });
  const media = new McpMedia({
    dataDir: directory,
    publicUrl: "http://localhost:1",
    async domainRequest(method, route, input, owner) {
      calls.push([method, route, owner]);
      const account = accounts.get(owner);
      if (method === "POST") return admit(input, account);
      if (!account?.authenticated) return { status: 401, payload: {} };
      const url = new URL(route, "http://localhost");
      if (url.pathname === "/api/queue") {
        const found = findDirectRoute(app, method, url.pathname);
        return found.run(account, {
          params: found.params,
          query: Object.fromEntries(url.searchParams),
        });
      }
      const job = store.job(owner, route.split("/").pop());
      return {
        status: 200,
        payload: route.startsWith("/api/gallery/")
          ? { items: job?.items || [] }
          : { status: job?.status || "missing" },
      };
    },
  });
  try {
    const input = { prompt: "A neutral landscape", clientJobId: "owned-generation" };
    const httpResult = await admit(input, accounts.get("alice"));
    const generated = await media.request("POST", "/api/generate", input, "alice");
    assert.deepEqual(generated, httpResult.payload);
    assert.equal(store.jobs("alice").length, 1);
    const sessionId = httpResult.payload.sessionId;
    const foreignSession = store.createSession("bob");
    assert.equal(
      (
        await admit({ prompt: "Refine" }, accounts.get("alice"), {
          sessionId: foreignSession.id,
          operation: "refine",
        })
      ).status,
      404,
    );
    const anotherSession = store.createSession("alice");
    assert.equal(
      (
        await admit({ prompt: "Refine" }, accounts.get("alice"), {
          sessionId: anotherSession.id,
          operation: "refine",
          parentJobId: input.clientJobId,
        })
      ).status,
      400,
    );
    const scoped = await admit(
      { prompt: "Refine", clientJobId: "session-turn" },
      accounts.get("alice"),
      { sessionId, operation: "refine", parentJobId: input.clientJobId },
    );
    assert.equal(scoped.status, 200);
    assert.equal(scoped.payload.sessionId, sessionId);
    assert.equal(store.job("alice", "session-turn").parentJobId, input.clientJobId);
    const duplicateTurn = await admit(
      { prompt: "Refine", clientJobId: "session-turn" },
      accounts.get("alice"),
      { sessionId, operation: "refine", parentJobId: input.clientJobId },
    );
    assert.equal(duplicateTurn.payload.jobId, scoped.payload.jobId);
    assert.equal(store.jobs("alice").length, 2);
    assert.deepEqual(await media.request("GET", "/api/jobs/owned-generation", undefined, "alice"), {
      status: "queued",
    });
    assert.deepEqual(await media.request("GET", "/api/jobs/owned-generation", undefined, "bob"), {
      status: "missing",
    });
    assert.deepEqual(
      await media.request("GET", "/api/gallery/jobs/owned-generation", undefined, "bob"),
      { items: [] },
    );
    await assert.rejects(media.request("POST", "/api/generate", input, "bob"), /already in use/);
    await assert.rejects(media.request("POST", "/api/generate", input, "disabled"), /HTTP 401/);
    await assert.rejects(media.request("POST", "/api/generate", {}, "alice"), /Enter a prompt/);
    assert.equal(store.jobs("disabled").length, 0);
    assert.equal(calls.length, 7);
    assert.deepEqual(submitted, []);

    const batch = store.enqueue("alice", sessionId, { kind: "image", count: 3 }, "image");
    const video = store.enqueue("alice", sessionId, { kind: "video" }, "animate");
    const finished = store.enqueue("alice", sessionId, { kind: "image", count: 8 }, "image");
    store.save({ ...finished, status: "completed" });
    store.enqueue("alice", sessionId, { kind: "image", count: 7 }, "image");
    media.adopt("alice", "chat", { jobs: [batch.id, video.id, finished.id] });
    assert.equal(await media.pendingOutputs("alice"), 3);
    assert.equal(await media.pendingOutputs("bob"), 0);
  } finally {
    queue.stop();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Near Grok's usage limit a cloud default runs locally, and an asked-for cloud run still runs", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "studio-mcp-held-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let held = true;
  const media = new McpMedia({
    dataDir: directory,
    publicUrl: "http://localhost:1",
    cloudHeld: async () => held,
    async domainRequest() {
      return {
        status: 200,
        payload: {
          defaults: { imageModel: "grok-image" },
          profiles: [
            { id: "grok-image", kind: "image", label: "Grok Image", provider: "cliproxyapi" },
            { id: "flux", kind: "image", label: "Flux" },
          ],
        },
      };
    },
  });
  const local = await media.choose("owner", { kind: "image" });
  assert.equal(local.profile.id, "flux");
  assert.match(local.note, /Grok is near its weekly usage limit, so this runs locally/);
  const asked = await media.choose("owner", { kind: "image", cloud: true });
  assert.equal(asked.profile.id, "grok-image");
  assert.match(asked.note, /this still uses it as asked/);
  held = false;
  const usual = await media.choose("owner", { kind: "image" });
  assert.equal(usual.profile.id, "grok-image");
  assert.equal(usual.note, "");
});
