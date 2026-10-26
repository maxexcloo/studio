import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-assistant-routes-"));
process.env.STUDIO_DATA_DIR = dir;
process.env.STUDIO_ENV_FILE = path.join(dir, "studio-env");
const {
  registerAssistantRoutes,
  assistantIntegration,
  assistantRecord,
  assistantSettingValue,
  imageFromDataUrl,
} = await import("./assistant-routes.js");
const { createAssistant } = await import("./assistant.js");
const { builtInAccessProfiles, effectiveAccountAccess } = await import("./account-policy.js");

const environment = {
  STUDIO_PROMPT_WRITER_URL: "http://litellm.invalid:4000",
  STUDIO_PROMPT_WRITER_KEY: "fixture-key",
  STUDIO_PROMPT_WRITER_MODEL: "ai/text-quick",
};
const sfw = { id: "custom:sfw", label: "Safe Image", kind: "image", family: "krea2" };
const nsfw = {
  id: "custom:nsfw",
  label: "Adult Image",
  kind: "image",
  family: "krea2",
  nsfw: true,
};
const user = builtInAccessProfiles.find((item) => item.id === "user");
const profiles = {
  user,
  off: { ...user, id: "off", features: { ...user.features, promptAssistant: false } },
  adult: { ...user, id: "adult", features: { ...user.features, nsfwModels: true, loras: true } },
};
const accounts = {
  admin: { id: "a1", role: "administrator" },
  user: { id: "u1", role: "user", accessProfileId: "user" },
  off: { id: "u2", role: "user", accessProfileId: "off" },
  adult: { id: "u3", role: "user", accessProfileId: "adult" },
};
const encoder = new TextEncoder();
const calls = [];
const fetchImpl = async (url, options = {}) => {
  if (url.endsWith("/model/info")) return Response.json({ data: [] });
  if (url.endsWith("/v1/models"))
    return Response.json({ data: [{ id: "ai/text-quick" }, { id: "ai/uncensored" }] });
  const body = JSON.parse(options.body);
  calls.push(body);
  if (body.stream)
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const piece of ["A cabin", " at dusk."])
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`,
              ),
            );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  return Response.json({
    choices: [
      {
        message: {
          content: /^You write negative prompts/.test(body.messages[0].content)
            ? "blurry"
            : /^You rewrite/.test(body.messages[0].content)
              ? "A cabin at dusk."
              : '{"loras": [{"name": "cabin.safetensors", "strength": 0.8, "reason": "Cabins"}]}',
        },
      },
    ],
  });
};

const app = express();
app.use(express.json({ limit: "25mb" }));
app.use((req, _res, next) => {
  const name = req.headers["x-test-account"];
  if (name) req.studioAccount = effectiveAccountAccess(accounts[name], profiles, [sfw.id, nsfw.id]);
  next();
});
const engine = createAssistant(environment, { fetchImpl, log: {} });
const loras = [
  {
    name: "cabin.safetensors",
    info: { title: "Cabin", families: ["krea2"], triggers: ["cabinx"] },
  },
];
registerAssistantRoutes(app, {
  engine,
  profiles: async (req) =>
    [sfw, nsfw].filter(
      (profile) =>
        !req.studioAccount ||
        req.studioAccount.role === "administrator" ||
        !profile.nsfw ||
        req.studioAccount.features.nsfwModels,
    ),
  guide: (profile) =>
    profile.id === nsfw.id
      ? { summary: "Tags.", negative: { effect: "none" } }
      : { summary: "Lead with light." },
  loras: async () => loras,
  starred: async () => ({ examples: ["a starred prompt"], loras: [] }),
  template: async (id) =>
    id === "base"
      ? {
          heissUi: {
            id: "base",
            name: "Base",
            kind: "image",
            defaults: { model: "old.safetensors" },
            controls: { prompt: { node: "1", input: "text" } },
          },
          graph: { 1: { class_type: "CLIPTextEncode", inputs: { text: "" } } },
        }
      : null,
});
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});
const post = async (route, body, account, headers = {}) => {
  const response = await fetch(base + route, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(account ? { "x-test-account": account } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    type: response.headers.get("content-type") || "",
    text: await response.text(),
  };
};
const get = async (route, account) =>
  (await fetch(base + route, { headers: account ? { "x-test-account": account } : {} })).json();

test("the assistant is behind Prompt Assistant, on for built-ins, and only for profiles the account may use", async () => {
  assert.deepEqual(await get("/api/assistant", "off"), { ok: true, available: false, presets: [] });
  const status = await get("/api/assistant", "user");
  assert.deepEqual(
    [status.available, status.spicy, status.loras, status.presets.map((preset) => preset.id)],
    [true, false, false, ["enhance", "photographic", "cinematic", "concise", "candid"]],
  );
  assert.equal(
    (await post("/api/assistant/rewrite", { profileId: sfw.id, prompt: "a cabin" }, "off")).status,
    403,
  );
  assert.equal(
    (await post("/api/assistant/rewrite", { profileId: nsfw.id, prompt: "a cabin" }, "user"))
      .status,
    404,
    "an NSFW profile this account can’t use",
  );
  assert.equal(
    (
      await post(
        "/api/assistant/rewrite",
        { profileId: "custom:missing", prompt: "a cabin" },
        "admin",
      )
    ).status,
    404,
  );
  const json = await post(
    "/api/assistant/rewrite",
    { profileId: sfw.id, prompt: "a cabin", preset: "concise" },
    "user",
  );
  assert.equal(json.status, 200);
  assert.deepEqual(
    [JSON.parse(json.text).prompt, JSON.parse(json.text).source],
    ["A cabin at dusk.", "assistant"],
  );
  assert.match(
    calls.at(-1).messages[0].content,
    /a starred prompt/,
    "starred prompts are style examples",
  );
});

test("a rewrite streams as server-sent events: deltas, then the final result", async () => {
  const streamed = await post(
    "/api/assistant/rewrite",
    { profileId: sfw.id, prompt: "a cabin" },
    "user",
    { accept: "text/event-stream" },
  );
  assert.match(streamed.type, /text\/event-stream/);
  const events = streamed.text
    .trim()
    .split("\n\n")
    .map((block) => ({
      event: /^event: (.+)$/m.exec(block)[1],
      data: JSON.parse(/^data: (.+)$/m.exec(block)[1]),
    }));
  assert.deepEqual(events.slice(0, -1), [
    { event: "delta", data: { text: "A cabin" } },
    { event: "delta", data: { text: " at dusk." } },
  ]);
  assert.deepEqual(
    [events.at(-1).event, events.at(-1).data.prompt, events.at(-1).data.preset],
    ["done", "A cabin at dusk.", "enhance"],
  );
});

test("Spicy needs NSFW Models, whatever the profile, and a Spicy model", async () => {
  assert.equal(
    (
      await post(
        "/api/assistant/rewrite",
        { profileId: sfw.id, prompt: "a couple", preset: "spicy" },
        "user",
      )
    ).status,
    403,
  );
  const noModel = await post(
    "/api/assistant/rewrite",
    { profileId: sfw.id, prompt: "a couple", preset: "spicy" },
    "adult",
    { accept: "text/event-stream" },
  );
  assert.deepEqual(
    [noModel.status, /application\/json/.test(noModel.type)],
    [409, true],
    "refused before the stream starts",
  );
  assert.equal((await get("/api/assistant", "adult")).spicy, false, "hidden without a Spicy model");
  environment.STUDIO_ASSISTANT_SPICY_MODEL = "ai/uncensored";
  try {
    assert.equal(
      (await get("/api/assistant", "adult")).presets.some((preset) => preset.id === "spicy"),
      true,
    );
    assert.equal((await get("/api/assistant", "user")).spicy, false);
    const spicy = await post(
      "/api/assistant/rewrite",
      { profileId: sfw.id, prompt: "a couple", preset: "spicy" },
      "adult",
    );
    assert.equal(spicy.status, 200, "an unmarked profile is fine with NSFW Models");
    assert.equal(calls.at(-1).model, "ai/uncensored");
  } finally {
    delete environment.STUDIO_ASSISTANT_SPICY_MODEL;
  }
});

test("negatives for anyone with the assistant; LoRA suggestions need LoRAs; drafts are for administrators", async () => {
  assert.equal(
    JSON.parse(
      (await post("/api/assistant/negative", { profileId: sfw.id, prompt: "a cabin" }, "user"))
        .text,
    ).negative,
    "blurry",
  );
  assert.equal(
    (await post("/api/assistant/loras", { profileId: sfw.id, prompt: "a cabin" }, "user")).status,
    403,
  );
  const suggested = JSON.parse(
    (await post("/api/assistant/loras", { profileId: sfw.id, prompt: "a cabin" }, "adult")).text,
  );
  assert.deepEqual(
    suggested.loras.map((item) => [item.name, item.triggers]),
    [["cabin.safetensors", ["cabinx"]]],
  );
  assert.equal(
    (await post("/api/assistant/draft-profile", { id: "new", templateId: "base" }, "user")).status,
    403,
  );
  assert.equal(
    (await post("/api/assistant/draft-guide", { profileId: sfw.id }, "adult")).status,
    403,
  );
  const drafted = JSON.parse(
    (
      await post(
        "/api/assistant/draft-profile",
        { id: "new-model", templateId: "base", modelFile: "new.safetensors" },
        "admin",
      )
    ).text,
  );
  assert.deepEqual(
    [
      drafted.aiDrafted,
      JSON.parse(drafted.text).heissUi.defaults.model,
      JSON.parse(drafted.text).heissUi.nsfw,
      drafted.check.ok,
    ],
    [true, "new.safetensors", true, true],
  );
  assert.equal(
    (await post("/api/assistant/describe", { image: "data:image/png;base64,AAAA" }, "user")).status,
    200,
  );
});

test("Settings rows: gateway models, vision and validated model names", async () => {
  const source = () => ({ source: "default", locked: false });
  const integration = await assistantIntegration({ environment, engine, source });
  assert.deepEqual(
    [
      integration.available,
      integration.writerModel,
      integration.models,
      integration.model.effective,
      integration.model.vision,
      integration.spicy.effective,
    ],
    [true, "ai/text-quick", ["ai/text-quick", "ai/uncensored"], "ai/text-quick", false, ""],
  );
  assert.equal(
    (await assistantIntegration({ environment: {}, engine: null, source })).available,
    false,
  );
  assert.equal(assistantSettingValue("STUDIO_ASSISTANT_MODEL", " ai/vision "), "ai/vision");
  assert.throws(() => assistantSettingValue("STUDIO_ASSISTANT_MODEL", "bad\nmodel"), /valid model/);
  assert.throws(() => assistantSettingValue("STUDIO_PROMPT_WRITER_KEY", "x"), /cannot be changed/);
  assert.deepEqual(imageFromDataUrl("data:image/png;base64,AAAA"), {
    mime: "image/png",
    data: "AAAA",
  });
  assert.equal(imageFromDataUrl("data:text/html;base64,AAAA"), null);
});

test("the composer learns which profiles take no negative", async () => {
  assert.deepEqual((await get("/api/assistant", "adult")).noNegative, [nsfw.id]);
  assert.deepEqual(
    (await get("/api/assistant", "user")).noNegative,
    [],
    "only profiles the account may use",
  );
});

test("a generation records the preset, model, source and only the chosen LoRAs it stacked", () => {
  const stack = [
    { name: "a.safetensors", enabled: true },
    { name: "b.safetensors", enabled: false },
  ];
  assert.deepEqual(
    assistantRecord(
      {
        preset: "enhance",
        model: "ai/text-quick",
        source: "ui",
        lorasSuggested: ["a.safetensors", "b.safetensors", "c.safetensors", "a.safetensors"],
      },
      stack,
    ),
    { preset: "enhance", model: "ai/text-quick", source: "ui", lorasSuggested: ["a.safetensors"] },
  );
  assert.deepEqual(assistantRecord({ preset: "cinematic", source: "chat", model: "bad\nmodel" }), {
    preset: "cinematic",
    source: "chat",
  });
  assert.equal(assistantRecord({ preset: "nonsense" }), null);
  assert.equal(assistantRecord("enhance"), null);
  assert.equal(assistantRecord(null), null);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function listen(t, app) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test("stopping prompt assistance disconnects the actual gateway request without falling back", async (t) => {
  for (const operation of ["rewrite", "negative", "loras"])
    await t.test(operation, async (t) => {
      const started = deferred();
      const disconnected = deferred();
      const warnings = [];
      const upstream = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks));
        assert.equal(body.stream, operation === "rewrite");
        res.once("close", disconnected.resolve);
        if (body.stream) {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.write('data: {"choices":[{"delta":{"content":"First words"}}]}\n\n');
        }
        started.resolve();
      });
      const gatewayUrl = await listen(t, upstream);
      const app = express();
      app.use(express.json());
      registerAssistantRoutes(app, {
        engine: createAssistant(
          { ...environment, STUDIO_PROMPT_WRITER_URL: gatewayUrl },
          { log: { warn: (message) => warnings.push(message) } },
        ),
        profiles: async () => [
          { ...sfw, capabilities: { negativePrompt: true }, defaults: { cfg: 3 } },
        ],
        loras: async () => loras,
      });
      const url = await listen(t, app);
      const controller = new AbortController();
      const response = fetch(`${url}/api/assistant/${operation}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          profileId: sfw.id,
          prompt: "A cabin",
          preset: "enhance",
          stream: operation === "rewrite",
        }),
      }).then((reply) => reply.text());
      const cancelled = assert.rejects(response, (error) => error.name === "AbortError");
      await started.promise;
      controller.abort();
      await cancelled;
      await disconnected.promise;
      assert.deepEqual(
        warnings,
        [],
        "cancellation must not produce a fallback prompt or LoRA suggestion",
      );
    });
});

test("stopping during profile discovery does not start a rewrite after discovery finishes", async (t) => {
  const discovering = deferred();
  const discovery = deferred();
  const closed = deferred();
  let completions = 0;
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.once("close", closed.resolve);
    next();
  });
  registerAssistantRoutes(app, {
    engine: createAssistant(environment, {
      fetchImpl: async () => {
        completions++;
        return Response.json({});
      },
      log: {},
    }),
    profiles: async () => {
      discovering.resolve();
      await discovery.promise;
      return [sfw];
    },
  });
  const url = await listen(t, app);
  const controller = new AbortController();
  const request = fetch(`${url}/api/assistant/rewrite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({ profileId: sfw.id, prompt: "A cabin" }),
  });
  const cancelled = assert.rejects(request, (error) => error.name === "AbortError");
  await discovering.promise;
  controller.abort();
  await cancelled;
  await closed.promise;
  discovery.resolve();
  // Drain the already-started route's asynchronous continuation, without timing an animation or poll.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completions, 0);
});
