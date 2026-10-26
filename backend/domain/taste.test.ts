import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import express from "express";
import { closeRuntimeDatabase } from "../persistence/runtime.ts";
import { createTaste, registerTasteRoutes, tasteSignal } from "./taste.ts";

function tasteFixture(t: TestContext, options: Partial<Parameters<typeof createTaste>[0]> = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-taste-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return createTaste({ dataDir, ...options });
}

test("signals keep their prompt, profile and enabled LoRAs, newest first, capped per account", (t) => {
  const taste = tasteFixture(t);
  assert.deepEqual(
    tasteSignal("iterate", "job-1", {
      prompt: `  ${"a fox ".repeat(80)}`,
      profileId: "flux-2",
      loras: [{ name: "film.safetensors" }, { name: "off", enabled: false }, "grain"],
    }),
    {
      kind: "iterate",
      jobId: "job-1",
      prompt: "a fox ".repeat(80).trim().slice(0, 300),
      profileId: "flux-2",
      loras: ["film.safetensors", "grain"],
    },
  );
  for (let index = 0; index < 205; index++)
    taste.record("alice", [tasteSignal("star", `job-${index}`)]);
  taste.record("bob", [tasteSignal("unstar", "theirs")]);
  const alice = taste.read("alice");
  assert.equal(alice.signals.length, 200);
  assert.equal(alice.signals[0].jobId, "job-204");
  assert.equal(alice.since, 205);
  assert.ok(alice.signals[0].at);
  assert.deepEqual(
    taste.read("bob").signals.map((signal) => signal.jobId),
    ["theirs"],
  );
  // Single-user mode is the "" owner, separate from every account.
  assert.equal(taste.read("").signals.length, 0);
  taste.forget("alice");
  assert.equal(taste.read("alice").signals.length, 0);
  assert.equal(taste.read("bob").signals.length, 1);
});

test("taste routes read, edit and forget only the caller's own profile", async (t) => {
  const taste = tasteFixture(t);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const user = String(req.headers["x-user"] || "");
    if (user) Object.assign(req, { studioAccount: { userId: user, role: "user" } });
    next();
  });
  registerTasteRoutes(app as unknown as Parameters<typeof registerTasteRoutes>[0], { taste });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const request = async (method: string, body?: unknown, user = "alice") => {
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/taste`,
      {
        method,
        headers: { "content-type": "application/json", ...(user ? { "x-user": user } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    return { status: response.status, body: await response.json() };
  };
  taste.record("alice", [tasteSignal("star", "a"), tasteSignal("compare", "b")]);
  const read = await request("GET");
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, { summary: "", source: "studio", updatedAt: "", signals: 2 });
  assert.equal((await request("PUT", { summary: "x".repeat(1001) })).status, 400);
  const saved = await request("PUT", { summary: "  Moody harbours at dusk.  " });
  assert.equal(saved.body.summary, "Moody harbours at dusk.");
  assert.equal(saved.body.source, "user");
  assert.ok(saved.body.updatedAt);
  // Editing keeps the signals the summary has not taken in yet.
  assert.equal(taste.read("alice").since, 2);
  assert.equal((await request("GET", undefined, "bob")).body.summary, "");
  assert.equal((await request("GET", undefined, "")).body.summary, "");
  const cleared = await request("DELETE");
  assert.deepEqual([cleared.body.summary, cleared.body.signals], ["", 0]);
});
