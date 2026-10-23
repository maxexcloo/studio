import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { McpMedia } from "./mcp-media.js";
import { createGenerationAdmission } from "./rewrite/admission.ts";
import { GenerationQueue } from "./rewrite/queue.ts";
import { RewriteStore } from "./rewrite/store.ts";

test("MCP generation uses shared durable admission and owned reads without HTTP", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "studio-mcp-domain-"));
  const store = new RewriteStore(":memory:");
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
  await queue.stop();
  const accounts = new Map([
    ["alice", { authenticated: true, role: "user", userId: "alice" }],
    ["bob", { authenticated: true, role: "user", userId: "bob" }],
    ["disabled", { authenticated: false, role: "user", userId: "disabled" }],
  ]);
  const admit = createGenerationAdmission({
    store,
    queue,
    jobLimit: 2,
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
  const media = new McpMedia({
    dataDir: directory,
    baseUrl: "http://127.0.0.1:1",
    publicUrl: "http://localhost:1",
    fetchImpl: async () => {
      throw new Error("Core generation must not use HTTP");
    },
    async domainRequest(method, route, input, owner) {
      calls.push([method, route, owner]);
      const account = accounts.get(owner);
      if (method === "POST") return admit(input, account);
      if (!account?.authenticated) return { status: 401, payload: {} };
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
  } finally {
    await queue.stop();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
