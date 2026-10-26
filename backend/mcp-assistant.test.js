import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { registerMcpRoutes } from "./mcp.js";
import { createChatAssistantMemory } from "./mcp-assistant.js";

const gateway = {
  STUDIO_PROMPT_WRITER_URL: "http://fixture-writer.invalid:4000",
  STUDIO_PROMPT_WRITER_KEY: "fixture-writer-key",
  STUDIO_PROMPT_WRITER_MODEL: "ai/text-quick",
};
const profile = {
  id: "fixture-image",
  kind: "image",
  family: "flux",
  label: "Fixture Image",
  model: "fixture.safetensors",
  workflow: "fixture-image",
  ready: true,
  capabilities: { negativePrompt: true },
  defaults: { width: 512, height: 512, steps: 4 },
  options: { loras: ["glow.safetensors"] },
  mediaInputs: [],
};
const tokens = {
  "assistant-token-long-enough-for-the-fixture-0001": {
    userId: "with",
    role: "user",
    authenticated: true,
    generationProfiles: [profile.id],
    features: { promptAssistant: true, loras: true },
  },
  "assistant-token-long-enough-for-the-fixture-0002": {
    userId: "without",
    role: "user",
    authenticated: true,
    generationProfiles: [profile.id],
    features: { promptAssistant: false },
  },
};

async function fixture(t, environment = gateway) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-mcp-assistant-"));
  const app = express();
  app.use(express.json({ limit: "30mb" }));
  const asked = [];
  const submitted = [];
  app.get("/api/models", (_req, res) =>
    res.json({ profiles: [profile], defaults: { imageModel: profile.id } }),
  );
  app.get("/api/loras/info", (_req, res) =>
    res.json({
      ok: true,
      loras: { "glow.safetensors": { families: ["flux"], triggers: ["glowfx"], title: "Glow" } },
    }),
  );
  app.post("/api/assistant/:operation", (req, res) => {
    asked.push({
      operation: req.params.operation,
      body: req.body,
      authorization: req.headers.authorization,
    });
    if (req.params.operation === "rewrite")
      return res.json(
        req.body.prompt === "fail"
          ? {
              ok: true,
              prompt: "fail",
              source: "fallback",
              reason: "timeout",
              preset: req.body.preset,
            }
          : {
              ok: true,
              prompt: `A ${req.body.preset} cabin at dusk.`,
              preset: req.body.preset,
              model: "ai/text-quick",
              source: "assistant",
              referencesRead: false,
            },
      );
    if (req.params.operation === "negative")
      return res.json({ ok: true, negative: "blurry", unused: false });
    res.json({
      ok: true,
      loras: [
        {
          name: "glow.safetensors",
          title: "Glow",
          strength: 0.8,
          triggers: ["glowfx"],
          reason: "Glow",
        },
      ],
    });
  });
  app.post("/api/generate", (req, res) => {
    submitted.push(req.body);
    res.json({ jobId: `job-${submitted.length}` });
  });
  app.get("/api/jobs/:id", (_req, res) => res.json({ status: "running", outputs: [] }));
  let base;
  registerMcpRoutes(app, {
    baseUrl: () => base,
    dataDir,
    environment: { MCP_PUBLIC_URL: "https://studio.example.test", ...environment },
    accountMode: true,
    imageWaitSeconds: 0,
    authenticateAccountToken: (token) => tokens[token] || null,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  t.after(async () => {
    await Promise.allSettled(clients.map((client) => client.close()));
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const client = async (token) => {
    const connected = new Client(
      { name: "assistant-fixture", version: "1.0.0" },
      { capabilities: {} },
    );
    clients.push(connected);
    await connected.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return connected;
  };
  return { asked, submitted, client };
}
const names = async (client) => (await client.listTools()).tools.map((tool) => tool.name);
const data = (result) => {
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  return JSON.parse(result.content.find((item) => item.type === "text").text);
};
const call = (client, name, args) => client.callTool({ name, arguments: args });

test("the assistant tools are only for accounts with Prompt Assistant, and only with a gateway", async (t) => {
  const f = await fixture(t);
  const withFeature = await names(
    await f.client("assistant-token-long-enough-for-the-fixture-0001"),
  );
  for (const name of ["RewritePrompt", "SuggestNegative", "SuggestLoras"])
    assert.ok(withFeature.includes(name), name);
  const without = await names(await f.client("assistant-token-long-enough-for-the-fixture-0002"));
  assert.equal(
    without.some((name) => ["RewritePrompt", "SuggestNegative", "SuggestLoras"].includes(name)),
    false,
  );
  const offline = await fixture(t, {});
  assert.equal(
    (
      await names(await offline.client("assistant-token-long-enough-for-the-fixture-0001"))
    ).includes("RewritePrompt"),
    false,
  );
});

test("the tools call the shared engine with the account credential, and Generate records what the chat used", async (t) => {
  const f = await fixture(t);
  const client = await f.client("assistant-token-long-enough-for-the-fixture-0001");
  const written = data(
    await call(client, "RewritePrompt", {
      prompt: "a cabin",
      profile_id: "Fixture Image",
      preset: "cinematic",
    }),
  );
  assert.deepEqual(
    [written.prompt, written.preset, written.profile_id],
    ["A cinematic cabin at dusk.", "cinematic", profile.id],
  );
  assert.equal(f.asked[0].authorization, "Bearer assistant-token-long-enough-for-the-fixture-0001");
  assert.deepEqual(
    data(await call(client, "SuggestNegative", { prompt: "a cabin", profile_id: profile.id })),
    { negative: "blurry" },
  );
  assert.deepEqual(
    data(
      await call(client, "SuggestLoras", { prompt: "a cabin", profile_id: profile.id }),
    ).loras.map((item) => [item.name, item.triggers]),
    [["glow.safetensors", ["glowfx"]]],
  );
  assert.equal(
    data(await call(client, "RewritePrompt", { prompt: "fail", profile_id: profile.id })).unchanged,
    true,
  );
  await call(client, "Generate", {
    prompts: [written.prompt],
    profile_id: profile.id,
    loras: [{ name: "glow.safetensors" }],
  });
  assert.deepEqual(f.submitted[0].assistant, {
    preset: "cinematic",
    model: "ai/text-quick",
    source: "chat",
    lorasSuggested: ["glow.safetensors"],
  });
  await call(client, "Generate", {
    prompts: ["Something the chat wrote itself"],
    profile_id: profile.id,
  });
  assert.equal(f.submitted[1].assistant, undefined);
});

test("the chat memory matches prompts loosely, per owner, and forgets after a while", () => {
  let clock = 0;
  const memory = createChatAssistantMemory({ now: () => clock });
  memory.rewrote("a", "A  Cabin at dusk.", { preset: "enhance", model: "m" });
  memory.suggested("a", ["x.safetensors"]);
  assert.deepEqual(
    memory.record(
      "a",
      ["a cabin at dusk."],
      [{ name: "x.safetensors" }, { name: "y.safetensors" }],
    ),
    { preset: "enhance", model: "m", source: "chat", lorasSuggested: ["x.safetensors"] },
  );
  assert.equal(memory.record("b", ["a cabin at dusk."]), null);
  clock = 7 * 60 * 60 * 1000;
  assert.equal(memory.record("a", ["a cabin at dusk."]), null);
});

test("what the chat wrote is kept on disk, so a Generate after a restart still records it", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-mcp-assistant-memory-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const file = path.join(dataDir, "mcp-assistant.json");
  let clock = 1000;
  const before = createChatAssistantMemory({ now: () => clock, file });
  before.rewrote("owner-a", "A cabin at dusk.", { preset: "cinematic", model: "ai/text-quick" });
  before.suggested("owner-a", ["glow.safetensors"]);
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), "600");
  const after = createChatAssistantMemory({ now: () => clock, file });
  assert.deepEqual(after.record("owner-a", ["a cabin at dusk."], [{ name: "glow.safetensors" }]), {
    preset: "cinematic",
    model: "ai/text-quick",
    source: "chat",
    lorasSuggested: ["glow.safetensors"],
  });
  clock += 7 * 60 * 60 * 1000;
  assert.equal(
    createChatAssistantMemory({ now: () => clock, file }).record("owner-a", ["a cabin at dusk."]),
    null,
    "old records are dropped on load",
  );
  fs.writeFileSync(file, "{ broken");
  assert.equal(
    createChatAssistantMemory({ now: () => clock, file, log: {} }).record("owner-a", [
      "a cabin at dusk.",
    ]),
    null,
    "an unreadable file starts afresh",
  );
});
