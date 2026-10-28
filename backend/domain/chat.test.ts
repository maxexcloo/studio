import assert from "node:assert/strict";
import test from "node:test";
import { RewriteStore } from "./store.ts";
import { ChatStore } from "./chat-store.ts";
import { ChatService } from "./chat.ts";
import type { ChatEvent } from "../../shared/chat.ts";
import type { QueueJob } from "../../shared/queue.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createChatRouter } from "./chat-routes.ts";

const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
function setup(chunks: string[]) {
  const db = new RewriteStore(":memory:");
  const session = db.createSession("alice");
  const store = new ChatStore(db.db);
  const admissions: unknown[] = [];
  const requests: Record<string, unknown>[] = [];
  const service = new ChatService({
    store,
    session: (owner, id) => db.session(owner, id),
    settings: () => ({
      endpoint: "http://gateway.invalid/v1/chat/completions",
      key: "fixture",
      model: "selected-text",
    }),
    admit: async (request) => {
      admissions.push(request);
      return {
        job: {
          id: request.turnId,
          sessionId: request.sessionId,
          input: request.draft.input,
          parentJobId: request.draft.parentJobId,
        } as QueueJob,
      };
    },
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(String(options?.body)));
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
            controller.close();
          },
        }),
      );
    },
  });
  return { db, session, store, admissions, requests, service };
}
test("text discussion streams and persists without submitting media; history stays account scoped", async () => {
  const fixture = setup([
    // Bifrost's shape: the same reasoning under both names, then an empty content delta.
    frame({
      choices: [
        { delta: { reasoning: "Define it.", reasoning_content: "Define it.", content: "" } },
      ],
    }),
    frame({ choices: [{ delta: { content: "Hello" } }] }),
    "data: [DONE]\n\n",
  ]);
  const events: ChatEvent[] = [];
  await fixture.service.stream(
    "alice",
    fixture.session.id,
    { content: "What is depth of field?" },
    (event) => events.push(event),
  );
  assert.equal(fixture.service.messages("alice", fixture.session.id)[1].content, "Hello");
  assert.equal(fixture.service.messages("alice", fixture.session.id)[1].thinking, "Define it.");
  assert.equal(events.find((event) => event.event === "thinking")?.data.text, "Define it.");
  assert.equal(
    fixture.db.session("alice", fixture.session.id)?.updatedAt,
    fixture.service.messages("alice", fixture.session.id)[1].createdAt,
  );
  assert.equal(events.find((event) => event.event === "delta")?.data.text, "Hello");
  assert.equal(fixture.admissions.length, 0);
  assert.throws(() => fixture.service.messages("bob", fixture.session.id), /not found/);
  await assert.rejects(
    fixture.service.stream("bob", fixture.session.id, { content: "hello" }, () => {}),
    /not found/,
  );
  fixture.db.close();
});
test("explicit media tool preserves selected settings and records stable admission identity", async () => {
  const fixture = setup([
    frame({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: {
                  name: "request_media",
                  arguments: '{"operation":"refine","prompt":"blue teapot"}',
                },
              },
            ],
          },
        },
      ],
    }),
    "data: [DONE]\n\n",
  ]);
  const events: ChatEvent[] = [];
  await fixture.service.stream(
    "alice",
    fixture.session.id,
    {
      content: "Make it blue",
      generation: {
        operation: "refine",
        input: { profileId: "chosen", seed: 42, allowFallback: false },
        parentJobId: "parent",
      },
    },
    (event) => events.push(event),
  );
  const message = fixture.service.messages("alice", fixture.session.id)[1];
  assert.deepEqual(message.draft?.input, {
    profileId: "chosen",
    seed: 42,
    allowFallback: false,
    prompt: "blue teapot",
  });
  assert.equal(message.jobId, message.id);
  assert.equal(events.filter((event) => event.event === "generation").length, 1);
  assert.equal(fixture.admissions.length, 1);
  fixture.db.close();
});

test("request_media applies the number of images the user asked for", async () => {
  const fixture = setup([
    frame({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: {
                  name: "request_media",
                  arguments: '{"operation":"image","prompt":"teapots","count":4}',
                },
              },
            ],
          },
        },
      ],
    }),
    "data: [DONE]\n\n",
  ]);
  await fixture.service.stream(
    "alice",
    fixture.session.id,
    {
      content: "Make four teapots",
      generation: { operation: "image", input: { profileId: "chosen", count: 1 } },
    },
    () => {},
  );
  assert.equal(fixture.service.messages("alice", fixture.session.id)[1].draft?.input.count, 4);
  fixture.db.close();
});

test("several request_media calls in one turn start one generation each", async () => {
  const call = (index: number, prompt: string) => ({
    index,
    function: {
      name: "request_media",
      arguments: JSON.stringify({ operation: "image", prompt }),
    },
  });
  const fixture = setup([
    frame({ choices: [{ delta: { tool_calls: [call(0, "at the beach")] } }] }),
    frame({ choices: [{ delta: { tool_calls: [call(1, "in a cafe")] } }] }),
    frame({ choices: [{ delta: { tool_calls: [call(2, "at a gym")] } }] }),
    "data: [DONE]\n\n",
  ]);
  const events: ChatEvent[] = [];
  await fixture.service.stream(
    "alice",
    fixture.session.id,
    {
      content: "A few variations in different settings",
      generation: { operation: "image", input: { profileId: "chosen" } },
    },
    (event) => events.push(event),
  );
  const prompts = (fixture.admissions as { draft: { input: { prompt: string } } }[]).map(
    (request) => request.draft.input.prompt,
  );
  assert.deepEqual(prompts, ["at the beach", "in a cafe", "at a gym"]);
  assert.equal(events.filter((event) => event.event === "generation").length, 3);
  const reply = fixture.service.messages("alice", fixture.session.id)[1];
  assert.equal(reply.status, "completed");
  assert.equal(reply.draft?.input.prompt, "at the beach");
  fixture.db.close();
});

test("request_media keeps selected LoRAs and adds the ones the user named for this family", async () => {
  const fixture = setup([
    frame({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: {
                  name: "request_media",
                  arguments: JSON.stringify({
                    operation: "image",
                    prompt: "film portrait",
                    loras: ["grain", "Unknown Style"],
                  }),
                },
              },
            ],
          },
        },
      ],
    }),
    "data: [DONE]\n\n",
  ]);
  fixture.service.options.loras = async () => [
    { name: "styles/grainscape_krea2.safetensors", title: "Grainscape", strength: 0.8 },
    { name: "ass_v2.safetensors", title: "Ass V2", strength: 1 },
  ];
  const selected = { name: "ass_v2.safetensors", strength: 0.6, enabled: true };
  await fixture.service.stream(
    "alice",
    fixture.session.id,
    {
      content: "Use the grain LoRA",
      generation: { operation: "image", input: { profileId: "chosen", loras: [selected] } },
    },
    () => {},
  );
  assert.deepEqual(fixture.service.messages("alice", fixture.session.id)[1].draft?.input.loras, [
    selected,
    { name: "styles/grainscape_krea2.safetensors", strength: 0.8, enabled: true },
  ]);
  assert.match(JSON.stringify(fixture.requests[0]), /Grainscape/);
  fixture.db.close();
});

test("all ten selected reference identities reach vision, media admission and later conversation context", async () => {
  const fixture = setup([
    frame({
      choices: [
        {
          delta: {
            content: "Using all ten references.",
            tool_calls: [
              {
                index: 0,
                function: {
                  name: "request_media",
                  arguments: '{"operation":"image","prompt":"Combine the references"}',
                },
              },
            ],
          },
        },
      ],
    }),
    "data: [DONE]\n\n",
  ]);
  const references = Array.from({ length: 10 }, (_, index) => ({
    assetId: `owned-${index + 1}`,
    slot: "images",
  }));
  const resolved: string[] = [];
  fixture.service.options.reference = async (owner, id) => {
    assert.equal(owner, "alice");
    resolved.push(id);
    return "data:image/png;base64,fixture";
  };
  await fixture.service.stream(
    "alice",
    fixture.session.id,
    {
      content: "Combine all ten references",
      references: references.map((reference) => reference.assetId),
      generation: {
        operation: "image",
        input: { profileId: "ten-reference-profile", referenceAssets: references },
      },
    },
    () => {},
  );
  assert.deepEqual(
    resolved,
    references.map((reference) => reference.assetId),
  );
  const first = fixture.requests[0].messages as { role: string; content: any }[];
  assert.equal(first.at(-1)!.content.filter((part: any) => part.type === "image_url").length, 10);
  for (const reference of references)
    assert.ok(first[0].content.includes(JSON.stringify(reference)));
  assert.deepEqual(
    fixture.service.messages("alice", fixture.session.id)[1].draft!.input.referenceAssets,
    references,
  );
  fixture.service.options.fetchImpl = async (_url, options) => {
    fixture.requests.push(JSON.parse(String(options?.body)));
    return new Response(
      frame({ choices: [{ delta: { content: "The references work together." } }] }) +
        "data: [DONE]\n\n",
    );
  };
  await fixture.service.stream(
    "alice",
    fixture.session.id,
    { content: "Explain the composition" },
    () => {},
  );
  // The first reply also asked for a title; only streamed requests carry the conversation.
  const later = fixture.requests.filter((request) => request.stream)[1].messages as {
    role: string;
    content: string;
  }[];
  const previous = later.find((message) => message.role === "assistant")!.content;
  for (const reference of references) assert.ok(previous.includes(JSON.stringify(reference)));
  assert.equal(fixture.admissions.length, 1, "discussion does not create a second generation");
  fixture.db.close();
});
test("truncated gateway response keeps partial text failed and never submits an incomplete action", async () => {
  const fixture = setup([frame({ choices: [{ delta: { content: "Partial answer" } }] })]);
  await assert.rejects(
    fixture.service.stream("alice", fixture.session.id, { content: "hello" }, () => {}),
    /disconnected/,
  );
  const message = fixture.service.messages("alice", fixture.session.id)[1];
  assert.equal(message.content, "Partial answer");
  assert.equal(message.status, "failed");
  assert.match(message.error || "", /disconnected/);
  assert.equal(fixture.admissions.length, 0);
  fixture.db.close();
});
test("card revisions preserve exact settings after a complete text answer and never run after a failed answer", async () => {
  for (const complete of [true, false]) {
    const fixture = setup([
      frame({
        model: "actual-text",
        choices: [{ delta: { content: "I changed the seed and prompt." } }],
      }),
      ...(complete ? ["data: [DONE]\n\n"] : []),
    ]);
    fixture.service.options.revision = async (_owner, _session, value) => ({
      ...value,
      previousInput: { prompt: "Old prompt", seed: 1 },
    });
    const revision = {
      sourceJobId: "existing-card",
      operation: "image" as const,
      input: {
        prompt: "Exact prompt",
        profileId: "chosen",
        seed: 2,
        inpaint: { mask: "private-mask-bytes" },
      },
    };
    const run = fixture.service.stream(
      "alice",
      fixture.session.id,
      { content: "Submit this edited card", revision },
      () => {},
    );
    if (complete) await run;
    else await assert.rejects(run, /disconnected/);
    const messages = fixture.service.messages("alice", fixture.session.id);
    assert.deepEqual(messages[0].revision?.changes?.seed, { before: 1, after: 2 });
    assert.equal(fixture.admissions.length, complete ? 1 : 0);
    if (complete) assert.deepEqual(messages[1].draft?.input, revision.input);
    assert.equal(messages[1].actualModelId, "actual-text");
    assert.doesNotMatch(JSON.stringify(fixture.requests), /private-mask-bytes/);
    fixture.db.close();
  }
});
test("only Stop cancels a reply: it aborts upstream, keeps the partial text and frees the chat", async () => {
  const fixture = setup([]);
  let upstreamSignal: AbortSignal | undefined;
  fixture.service.options.fetchImpl = async (_url, options) => {
    upstreamSignal = options?.signal as AbortSignal;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(frame({ choices: [{ delta: { content: "Partial" } }] })),
          );
          upstreamSignal!.addEventListener("abort", () => controller.error(new Error("aborted")), {
            once: true,
          });
        },
      }),
    );
  };
  await assert.rejects(
    fixture.service.stream("alice", fixture.session.id, { content: "hello" }, (event) => {
      if (event.event === "delta")
        assert.equal(fixture.service.stop("alice", fixture.session.id), true);
    }),
    /aborted/,
  );
  assert.equal(upstreamSignal?.aborted, true);
  assert.equal(fixture.service.messages("alice", fixture.session.id)[1].status, "cancelled");
  assert.equal(fixture.service.active.size, 0);
  assert.equal(fixture.service.stop("alice", fixture.session.id), false);
  fixture.db.close();
});
test("unauthorised reference fails before sending any content or persisting messages", async () => {
  const fixture = setup([]);
  fixture.service.options.reference = async () => {
    throw new Error("Reference not found.");
  };
  await assert.rejects(
    fixture.service.stream(
      "alice",
      fixture.session.id,
      { content: "Look", references: ["other-owner"] },
      () => {},
    ),
    /not found/,
  );
  assert.equal(fixture.requests.length, 0);
  assert.equal(fixture.service.messages("alice", fixture.session.id).length, 0);
  fixture.db.close();
});
test("restart retains prepared action and partial text without resubmitting a generation", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "studio-chat-"));
  try {
    let db = new RewriteStore(path.join(directory, "studio.sqlite"));
    const session = db.createSession("alice");
    new ChatStore(db.db).add("alice", session.id, {
      role: "assistant",
      content: "Making it blue",
      status: "streaming",
      draft: { operation: "refine", input: { prompt: "blue", profileId: "chosen" } },
    });
    db.close();
    db = new RewriteStore(path.join(directory, "studio.sqlite"));
    const messages = new ChatStore(db.db).messages("alice", session.id);
    assert.equal(messages[0].status, "failed");
    assert.equal(messages[0].content, "Making it blue");
    assert.equal(messages[0].draft?.input.profileId, "chosen");
    assert.equal(db.jobs("alice").length, 0);
    db.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test("media admission rejection leaves selected settings and a recoverable inline action error", async () => {
  const fixture = setup([
    frame({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: {
                  name: "request_media",
                  arguments: '{"operation":"animate","prompt":"slow pan"}',
                },
              },
            ],
          },
        },
      ],
    }),
    "data: [DONE]\n\n",
  ]);
  fixture.service.options.admit = async () => {
    throw new Error("Choose a video model to animate.");
  };
  await fixture.service.stream(
    "alice",
    fixture.session.id,
    {
      content: "Animate this",
      generation: { operation: "image", input: { profileId: "image-selected" } },
    },
    () => {},
  );
  const message = fixture.service.messages("alice", fixture.session.id)[1];
  assert.equal(message.actionError, "Choose a video model to animate.");
  assert.equal(message.draft?.input.profileId, "image-selected");
  assert.equal(message.status, "completed");
  assert.ok(message.content);
  assert.equal(message.jobId, undefined);
  fixture.db.close();
});
test("an admission note, such as Animate going to Grok, joins the reply", async () => {
  const fixture = setup([
    frame({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: {
                  name: "request_media",
                  arguments: '{"operation":"animate","prompt":"slow pan"}',
                },
              },
            ],
          },
        },
      ],
    }),
    "data: [DONE]\n\n",
  ]);
  const note = "Local video isn't running, so this runs on Grok Video.";
  fixture.service.options.admit = async (request) => ({
    job: { id: request.turnId, input: request.draft.input } as QueueJob,
    note,
  });
  const events: ChatEvent[] = [];
  await fixture.service.stream(
    "alice",
    fixture.session.id,
    { content: "Animate this", generation: { operation: "image", input: {} } },
    (event) => events.push(event),
  );
  const message = fixture.service.messages("alice", fixture.session.id)[1];
  assert.equal(message.content, `I'll animate the selected image with these settings.\n\n${note}`);
  assert.ok(events.some((event) => event.event === "delta" && event.data.text.endsWith(note)));
  fixture.db.close();
});

test("HTTP Chat applies assistant policy, hides another account's session and delivers SSE", async () => {
  const fixture = setup([
    frame({ choices: [{ delta: { content: "Text reply" } }] }),
    "data: [DONE]\n\n",
  ]);
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createChatRouter(fixture.service, (request) => {
      if (request.headers["x-user"] === "off")
        throw Object.assign(new Error("The prompt assistant is off for this account."), {
          status: 403,
        });
      return String(request.headers["x-user"] || "bob");
    }),
  );
  app.use(
    (
      error: { status?: number; message: string },
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => response.status(error.status || 500).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  try {
    const denied = await fetch(`${url}/sessions/${fixture.session.id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user": "off" },
      body: JSON.stringify({ content: "hello" }),
    });
    assert.equal(denied.status, 403);
    assert.match((await denied.json()).error, /off for this account/);
    assert.equal((await fetch(`${url}/sessions/${fixture.session.id}/chat`)).status, 404);
    const reply = await fetch(`${url}/sessions/${fixture.session.id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user": "alice" },
      body: JSON.stringify({ content: "hello" }),
    });
    assert.match(reply.headers.get("Content-Type") || "", /text\/event-stream/);
    const events = await reply.text();
    assert.match(events, /event: delta/);
    assert.match(events, /Text reply/);
    assert.match(events, /event: done/);
    assert.equal(fixture.service.messages("alice", fixture.session.id).length, 2);
    // A page that is hidden or loses its connection mid-reply leaves the reply running and stored.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    fixture.service.options.fetchImpl = async () =>
      new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(
              new TextEncoder().encode(frame({ choices: [{ delta: { content: "Kept " } }] })),
            );
            await held;
            controller.enqueue(
              new TextEncoder().encode(
                frame({ choices: [{ delta: { content: "reply" }, finish_reason: "stop" }] }),
              ),
            );
            controller.close();
          },
        }),
      );
    const dropped = new AbortController();
    const streaming = await fetch(`${url}/sessions/${fixture.session.id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user": "alice" },
      body: JSON.stringify({ content: "keep going" }),
      signal: dropped.signal,
    });
    await streaming.body!.getReader().read();
    dropped.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    while (fixture.service.active.size) await new Promise((resolve) => setTimeout(resolve, 10));
    const stored = fixture.service.messages("alice", fixture.session.id).at(-1)!;
    assert.equal(stored.status, "completed");
    assert.equal(stored.content, "Kept reply");
    const stop = await fetch(`${url}/sessions/${fixture.session.id}/chat/stop`, {
      method: "POST",
      headers: { "x-user": "alice" },
    });
    assert.deepEqual(await stop.json(), { stopped: false });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    fixture.db.close();
  }
});
test("new chats get a model title, stay New Chat while it is offline and never replace a rename", async () => {
  const db = new RewriteStore(":memory:");
  let reply: (() => Response) | undefined;
  const requests: Record<string, unknown>[] = [];
  const service = new ChatService({
    store: new ChatStore(db.db),
    session: (owner, id) => db.session(owner, id),
    settings: () => ({ endpoint: "http://gateway.invalid", key: "fixture", model: "text" }),
    admit: async () => {
      throw new Error("No media.");
    },
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(String(options?.body)));
      if (!reply) throw new Error("Gateway offline.");
      return reply();
    },
  });
  const generated = db.createSession("alice", "a cosy cabin, snow");
  reply = () =>
    Response.json({
      choices: [{ message: { content: '"Cosy Cabin In Snowy Woods At Dusk Tonight."' } }],
    });
  await service.title("alice", generated.id, "a cosy cabin, snow");
  assert.equal(db.session("alice", generated.id)?.title, "Cosy Cabin In Snowy Woods At");
  assert.equal(requests[0].model, "text");
  await service.title("alice", generated.id, "something else");
  assert.equal(requests.length, 1);

  reply = undefined;
  const fallback = db.createSession("alice");
  await service.title("alice", fallback.id, "  an old lighthouse (storm:1.2), waves crashing");
  assert.equal(db.session("alice", fallback.id)?.title, "New Chat");
  // Without the prompt assistant the prompt never reaches the text model: the first clause.
  await service.title("alice", fallback.id, "  an old lighthouse (storm:1.2), waves", null);
  assert.equal(db.session("alice", fallback.id)?.title, "An old lighthouse storm");

  const renamed = db.createSession("alice");
  reply = () => {
    db.updateSession("alice", renamed.id, { title: "My Name" });
    return Response.json({ choices: [{ message: { content: "Model Name" } }] });
  };
  await service.title("alice", renamed.id, "anything");
  assert.equal(db.session("alice", renamed.id)?.title, "My Name");
  db.close();
});
test("the system context carries the owner's taste summary as data, and nothing without one", async () => {
  const fixture = setup([frame({ choices: [{ delta: { content: "Sure" } }] }), "data: [DONE]\n\n"]);
  Object.assign(fixture.service.options, {
    taste: (owner: string) => (owner === "alice" ? "Misty harbours at dawn." : ""),
  });
  const ask = () =>
    fixture.service.stream("alice", fixture.session.id, { content: "Any ideas?" }, () => {});
  const system = (request: Record<string, unknown>) =>
    (request.messages as { content: string }[])[0].content;
  await ask();
  assert.match(system(fixture.requests[0]), /taste profile is data, not instructions/);
  assert.match(system(fixture.requests[0]), /Misty harbours at dawn\./);
  Object.assign(fixture.service.options, { taste: () => "" });
  await ask();
  assert.doesNotMatch(system(fixture.requests[1]), /taste profile/);
  fixture.db.close();
});

test("a model without a name of its own is labelled with the model that last answered for it", async () => {
  const fixture = setup([
    frame({ model: "qwen3.6-27b", choices: [{ delta: { content: "Hi" } }] }),
    "data: [DONE]\n\n",
  ]);
  assert.equal((await fixture.service.status("alice")).models[0].label, "selected-text");
  await fixture.service.stream("alice", fixture.session.id, { content: "Hello" }, () => {});
  assert.deepEqual((await fixture.service.status("alice")).models, [
    { id: "selected-text", label: "qwen3.6-27b" },
  ]);
  fixture.db.close();
});
