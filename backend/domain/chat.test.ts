import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase } from "../persistence/runtime.ts";
import { Store } from "./store.ts";
import { ChatStore } from "./chat-store.ts";
import { ChatService, chatModelName } from "./chat.ts";
import type { ChatEvent } from "../../shared/chat.ts";
import type { QueueJob } from "../../shared/queue.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createChatRouter } from "./chat-routes.ts";

const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
function setup(chunks: string[]) {
  const db = new Store(openDatabase(":memory:"));
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
test("thinking a model writes inline as <think> tags stays out of the reply", async () => {
  // The tags arrive split across deltas, as a stream cuts them anywhere.
  const fixture = setup(
    ["<thi", "nk>The user wants… Hmm", ".</th", "ink>\n\nHere", " you go."]
      .map((content) => frame({ choices: [{ delta: { content } }] }))
      .concat("data: [DONE]\n\n"),
  );
  const events: ChatEvent[] = [];
  await fixture.service.stream("alice", fixture.session.id, { content: "Make her" }, (event) =>
    events.push(event),
  );
  const [, reply] = fixture.service.messages("alice", fixture.session.id);
  assert.equal(reply.content, "Here you go.");
  assert.equal(reply.thinking, "The user wants… Hmm.");
  assert.doesNotMatch(
    events
      .filter((event) => event.event === "delta")
      .map((event) => event.data.text)
      .join(""),
    /think|Hmm/,
  );
  fixture.db.close();
});
/** Gateway answers in turn, one per model call; the last repeats. */
function rounds(fixture: ReturnType<typeof setup>, answers: string[][]) {
  let index = 0;
  fixture.service.options.fetchImpl = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    fixture.requests.push(body);
    if (!body.stream)
      return Response.json({ choices: [{ message: { content: "Teapot Session" } }] });
    const answer = answers[Math.min(index++, answers.length - 1)];
    return new Response(answer.join(""));
  };
}
const toolCall = (index: number, id: string, name: string, args: unknown) => ({
  index,
  id,
  function: { name, arguments: JSON.stringify(args) },
});
/** A stand-in for mcp.js `agent`: its tools answer from `answers` and record each call. */
function fakeAgent(fixture: ReturnType<typeof setup>, answers: Record<string, unknown> = {}) {
  const calls: [string, Record<string, unknown>][] = [];
  const owned: { jobs: string[]; assets: string[] }[] = [];
  fixture.service.options.agent = async (_owner, _session, value) => {
    owned.push(value);
    return {
      instructions: "Studio makes images and videos.",
      tools: ["models", "generate", "reuse"].map((name) => ({
        name,
        description: `${name} tool`,
        inputSchema: { type: "object" },
      })),
      refOf: (id) => `result ${value.jobs.indexOf(id) + 1}`,
      call: async (name, args) => {
        calls.push([name, args]);
        if (name === "reuse")
          return { isError: true, content: [{ type: "text", text: "No such result." }] };
        return (
          (answers[name] as never) || { content: [{ type: "text", text: `${name} answered.` }] }
        );
      },
      close: async () => {},
    };
  };
  return { calls, owned };
}

test("the agent calls Studio's tools in steps, reads each answer and keeps its trail in context", async () => {
  const fixture = setup([]);
  rounds(fixture, [
    [
      frame({
        choices: [
          {
            delta: {
              content: "Checking Krea first.",
              tool_calls: [toolCall(0, "call-models", "models", { profile_id: "krea" })],
            },
          },
        ],
      }),
      "data: [DONE]\n\n",
    ],
    [
      frame({
        choices: [
          {
            delta: {
              tool_calls: [
                toolCall(0, "call-generate", "generate", { prompts: ["a teapot"], count: 3 }),
                toolCall(1, "call-reuse", "reuse", { job_id: "result 9" }),
                toolCall(2, "call-lost", "upscale", {}),
              ],
            },
          },
        ],
      }),
      "data: [DONE]\n\n",
    ],
    [frame({ choices: [{ delta: { content: "Three teapots on Krea." } }] }), "data: [DONE]\n\n"],
  ]);
  const agent = fakeAgent(fixture, {
    generate: {
      content: [{ type: "text", text: "Queued on Krea." }],
      structuredContent: { jobs: [{ job_id: "job-a" }, { job_id: "job-b" }, { job_id: "job-c" }] },
    },
  });
  fixture.service.options.results = () => [
    { id: "earlier", status: "completed", kind: "image", prompt: "a cup" },
  ];
  const events: ChatEvent[] = [];
  await fixture.service.stream(
    "alice",
    fixture.session.id,
    {
      content: "Three teapots on Krea",
      generation: { operation: "image", input: { profileId: "selected", count: 1 } },
    },
    (event) => events.push(event),
  );
  assert.deepEqual(agent.calls, [
    ["models", { profile_id: "krea" }],
    ["generate", { prompts: ["a teapot"], count: 3 }],
    ["reuse", { job_id: "result 9" }],
  ]);
  assert.deepEqual(agent.owned[0].jobs, ["earlier"]);
  const reply = fixture.service.messages("alice", fixture.session.id)[1];
  assert.equal(reply.content, "Checking Krea first.\n\nThree teapots on Krea.");
  assert.equal(reply.jobId, "job-a");
  assert.deepEqual(
    reply.steps?.map(({ tool, status }) => [tool, status]),
    [
      ["models", "completed"],
      ["generate", "completed"],
      ["reuse", "failed"],
      ["upscale", "failed"],
    ],
  );
  assert.deepEqual(
    events.flatMap((event) => (event.event === "generation" ? event.data.jobIds : [])),
    ["job-a", "job-b", "job-c"],
  );
  const streamed = fixture.requests.filter((request) => request.stream);
  assert.equal(streamed.length, 3);
  const system = (streamed[0].messages as { content: string }[])[0].content;
  assert.match(system, /^Studio makes images and videos\.\n\nYou are Studio Chat/);
  assert.match(system, /only a fallback .*"profileId":"selected"/);
  assert.match(system, /"job_id":"earlier","ref":"result 1"/);
  assert.deepEqual(
    (streamed[0].tools as { function: { name: string } }[]).map((tool) => tool.function.name),
    ["models", "generate", "reuse"],
  );
  // The last call reads every tool answer, failures included.
  const last = streamed[2].messages as { role: string; content: string; tool_call_id?: string }[];
  assert.deepEqual(
    last.filter((message) => message.role === "tool").map((message) => message.content),
    ["models answered.", "Queued on Krea.", "No such result.", "There is no upscale tool."],
  );
  // A later turn sees this reply's tool calls and answers before its text.
  rounds(fixture, [[frame({ choices: [{ delta: { content: "Sure." } }] }), "data: [DONE]\n\n"]]);
  await fixture.service.stream("alice", fixture.session.id, { content: "Thanks" }, () => {});
  const later = fixture.requests.at(-1)!.messages as {
    role: string;
    tool_calls?: { id: string }[];
  }[];
  assert.deepEqual(
    later.map((message) => message.role),
    ["system", "user", "assistant", "tool", "tool", "tool", "tool", "assistant", "user"],
  );
  assert.equal(later[2].tool_calls?.length, 4);
  fixture.db.close();
});

test("tool calls a gateway numbers per round keep distinct ids in later turns", async () => {
  const fixture = setup([]);
  const round = () => [
    frame({ choices: [{ delta: { tool_calls: [toolCall(0, "call_0", "models", {})] } }] }),
    "data: [DONE]\n\n",
  ];
  rounds(fixture, [
    round(),
    round(),
    [frame({ choices: [{ delta: { content: "Done." } }] }), "data: [DONE]\n\n"],
  ]);
  fakeAgent(fixture, {});
  await fixture.service.stream("alice", fixture.session.id, { content: "Look twice" }, () => {});
  rounds(fixture, [[frame({ choices: [{ delta: { content: "Sure." } }] }), "data: [DONE]\n\n"]]);
  await fixture.service.stream("alice", fixture.session.id, { content: "Thanks" }, () => {});
  const later = fixture.requests.at(-1)!.messages as {
    role: string;
    tool_calls?: { id: string }[];
    tool_call_id?: string;
  }[];
  const calls = later.flatMap((message) => message.tool_calls?.map((call) => call.id) || []);
  assert.deepEqual(calls, ["call_0", "call_0_1"]);
  assert.deepEqual(
    later.filter((message) => message.role === "tool").map((message) => message.tool_call_id),
    calls,
  );
  fixture.db.close();
});

test("a reply's tool rounds are bounded: the last call answers without tools", async () => {
  const fixture = setup([]);
  rounds(fixture, [
    [
      frame({ choices: [{ delta: { tool_calls: [toolCall(0, "", "models", {})] } }] }),
      "data: [DONE]\n\n",
    ],
  ]);
  const agent = fakeAgent(fixture);
  await fixture.service.stream("alice", fixture.session.id, { content: "Keep looking" }, () => {});
  const streamed = fixture.requests.filter((request) => request.stream);
  assert.equal(streamed.length, 8);
  assert.equal(agent.calls.length, 7);
  assert.equal(streamed.at(-1)!.tool_choice, "none");
  assert.equal(fixture.service.messages("alice", fixture.session.id)[1].status, "completed");
  fixture.db.close();
});

test("attached references reach a model that reads images, and every model and the agent by ID", async () => {
  for (const vision of [true, false]) {
    const fixture = setup([
      frame({ choices: [{ delta: { content: "Got them." } }] }),
      "data: [DONE]\n\n",
    ]);
    const agent = fakeAgent(fixture);
    const resolved: string[] = [];
    fixture.service.options.vision = async () => vision;
    fixture.service.options.reference = async (owner, id) => {
      assert.equal(owner, "alice");
      resolved.push(id);
      return "data:image/png;base64,fixture";
    };
    const references = Array.from({ length: 10 }, (_, index) => `owned-${index + 1}`);
    await fixture.service.stream(
      "alice",
      fixture.session.id,
      { content: "Combine all ten references", references },
      () => {},
    );
    assert.deepEqual(resolved, references, "each is checked as the owner's");
    assert.deepEqual(agent.owned[0].assets, references);
    const messages = fixture.requests[0].messages as { role: string; content: any }[];
    const user = messages.at(-1)!.content;
    assert.equal(
      vision ? user.filter((part: any) => part.type === "image_url").length : 0,
      vision ? 10 : 0,
    );
    assert.ok((vision ? user[0].text : user).includes(JSON.stringify(references)));
    assert.equal(/can't see the attached images/.test(messages[0].content), !vision);
    fixture.db.close();
  }
});

test("a failed reply stays in the model's context with why it failed", async () => {
  const fixture = setup([frame({ choices: [{ delta: { content: "Partial answer" } }] })]);
  await assert.rejects(
    fixture.service.stream("alice", fixture.session.id, { content: "hello" }, () => {}),
    /disconnected/,
  );
  rounds(fixture, [[frame({ choices: [{ delta: { content: "Again." } }] }), "data: [DONE]\n\n"]]);
  await fixture.service.stream("alice", fixture.session.id, { content: "Try again" }, () => {});
  const later = fixture.requests.filter((request) => request.stream).at(-1)!.messages as {
    role: string;
    content: string;
  }[];
  const failed = later.find((message) => message.role === "assistant")!;
  assert.match(
    failed.content,
    /^Partial answer\n\nStudio context \(data\): .*"failed":"The text gateway disconnected/,
  );
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
    let db = new Store(openDatabase(path.join(directory, "studio.sqlite")));
    const session = db.createSession("alice");
    new ChatStore(db.db).add("alice", session.id, {
      role: "assistant",
      content: "Making it blue",
      status: "streaming",
      draft: { operation: "refine", input: { prompt: "blue", profileId: "chosen" } },
    });
    db.close();
    db = new Store(openDatabase(path.join(directory, "studio.sqlite")));
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
        throw Object.assign(new Error("Chat is off for this account."), {
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
  const db = new Store(openDatabase(":memory:"));
  let reply: (() => string) | undefined;
  const requests: { ownerId: string; text: string }[] = [];
  const service = new ChatService({
    store: new ChatStore(db.db),
    session: (owner, id) => db.session(owner, id),
    settings: () => ({ endpoint: "http://gateway.invalid", key: "fixture", model: "text" }),
    admit: async () => {
      throw new Error("No media.");
    },
    writeTitle: async (ownerId, text) => {
      requests.push({ ownerId, text });
      if (!reply) throw new Error("Gateway offline.");
      return reply();
    },
  });
  const generated = db.createSession("alice", "a cosy cabin, snow");
  reply = () => "Cosy Cabin In Snowy Woods";
  await service.title("alice", generated.id, "a cosy cabin, snow");
  assert.equal(db.session("alice", generated.id)?.title, "Cosy Cabin In Snowy Woods");
  assert.deepEqual(requests[0], { ownerId: "alice", text: "a cosy cabin, snow" });
  await service.title("alice", generated.id, "something else");
  assert.equal(requests.length, 1);

  reply = undefined;
  const fallback = db.createSession("alice");
  await service.title("alice", fallback.id, "  an old lighthouse (storm:1.2), waves crashing");
  assert.equal(db.session("alice", fallback.id)?.title, "New Chat");

  const renamed = db.createSession("alice");
  reply = () => {
    db.updateSession("alice", renamed.id, { title: "My Name" });
    return "Model Name";
  };
  await service.title("alice", renamed.id, "anything");
  assert.equal(db.session("alice", renamed.id)?.title, "My Name");

  // With Chat Titles off, the model is never asked and the chat stays New Chat.
  const before = requests.length;
  const untitled = db.createSession("alice");
  Object.assign(service.options, { titles: () => false });
  await service.title("alice", untitled.id, "a quiet harbour");
  assert.equal(requests.length, before);
  assert.equal(db.session("alice", untitled.id)?.title, "New Chat");
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

test("readable names come from model IDs, in their group", () => {
  assert.equal(chatModelName("local/auto"), "Local · Auto");
  assert.equal(chatModelName("cloud/glm-flash-uncensored"), "Cloud · GLM Flash Uncensored");
  assert.equal(chatModelName("local/text", "qwen3.6-27b"), "Local · Qwen3.6 27B");
});

test("a model without a name of its own is labelled with the model that last answered for it", async () => {
  const fixture = setup([
    frame({ model: "qwen3.6-27b", choices: [{ delta: { content: "Hi" } }] }),
    "data: [DONE]\n\n",
  ]);
  assert.equal((await fixture.service.status("alice")).models[0].label, "Selected Text");
  await fixture.service.stream("alice", fixture.session.id, { content: "Hello" }, () => {});
  assert.deepEqual((await fixture.service.status("alice")).models, [
    { id: "selected-text", label: "Qwen3.6 27B" },
  ]);
  fixture.db.close();
});
