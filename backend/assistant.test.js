import assert from "node:assert/strict";
import test from "node:test";
import {
  assistantSettings,
  cleanPrompt,
  createAssistant,
  createThinkFilter,
  draftedProfile,
  preFilterLoras,
  readServerSentEvents,
  stripThinking,
  validDraftGuide,
} from "./assistant.js";
import { flux3Upsampler } from "./prompt-upsamplers.js";

const gateway = (extra = {}) => ({
  STUDIO_PROMPT_WRITER_URL: "http://litellm.invalid:4000",
  STUDIO_PROMPT_WRITER_KEY: "fixture-key",
  STUDIO_PROMPT_WRITER_MODEL: "ai/text-quick",
  ...extra,
});
const quiet = { info: () => {}, warn: () => {} };
const profile = { id: "custom:fixture", label: "Fixture Image", kind: "image", family: "krea2" };
const encoder = new TextEncoder();
/** A text/event-stream response that sends `chunks` (strings) as they are, split wherever the test wants. */
const sse = (chunks) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
const event = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const json = (content) => Response.json({ choices: [{ message: { content } }] });

/** A fake gateway: `/v1/models` answers from `models`, completions from `reply(body)`. */
function fakeGateway(reply, { models = ["ai/text-quick", "ai/vision", "ai/uncensored"] } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/v1/models")) return Response.json({ data: models.map((id) => ({ id })) });
    const body = JSON.parse(options.body);
    calls.push({ url, body, authorization: options.headers.Authorization, signal: options.signal });
    return reply(body, options);
  };
  return { fetchImpl, calls };
}

test("settings reuse the prompt writer gateway; the assistant model defaults to its model and Spicy is off without one", () => {
  assert.equal(assistantSettings({}), null);
  assert.throws(
    () => assistantSettings({ STUDIO_PROMPT_WRITER_URL: "http://x.invalid" }),
    /needs STUDIO_PROMPT_WRITER_KEY/,
  );
  const plain = assistantSettings(gateway());
  assert.deepEqual(
    [plain.endpoint, plain.root, plain.model, plain.writerModel, plain.spicyModel],
    [
      "http://litellm.invalid:4000/v1/chat/completions",
      "http://litellm.invalid:4000",
      "ai/text-quick",
      "ai/text-quick",
      "",
    ],
  );
  const chosen = assistantSettings(
    gateway({ STUDIO_ASSISTANT_MODEL: "ai/vision", STUDIO_ASSISTANT_SPICY_MODEL: "ai/uncensored" }),
  );
  assert.deepEqual(
    [chosen.model, chosen.writerModel, chosen.spicyModel],
    ["ai/vision", "ai/text-quick", "ai/uncensored"],
  );
  assert.equal(createAssistant({}), null);
});

test("think blocks are stripped from whole replies and from streams split anywhere", () => {
  assert.equal(stripThinking("<think>plan</think>\nA cabin."), "A cabin.");
  assert.equal(
    stripThinking("reasoning only, opened by the template</think> A cabin."),
    "A cabin.",
  );
  assert.equal(stripThinking("A cabin. <THINK>unfinished"), "A cabin.");
  const reply =
    "<think>first I will consider the light</think>  A warm cabin <think>again</think>at dusk.";
  for (let size = 1; size <= 12; size += 1) {
    const filter = createThinkFilter();
    let shown = "";
    for (let index = 0; index < reply.length; index += size)
      shown += filter.push(reply.slice(index, index + size));
    shown += filter.flush();
    assert.equal(shown, "A warm cabin at dusk.", `chunks of ${size}`);
  }
  assert.equal(cleanPrompt('```\nPrompt: "A cabin at dusk."\n```'), "A cabin at dusk.");
});

test("server-sent events parse across chunk boundaries, skip comments and stop at [DONE]", async () => {
  const events = [];
  const body = sse([
    ": keep-alive\n\n",
    'data: {"a"',
    ":1}\r\n\r\ndata: not json\n\n",
    'data: {"b":2}\n\ndata: [DONE]\n\ndata: {"c":3}\n\n',
  ]).body;
  for await (const item of readServerSentEvents(body)) events.push(item);
  assert.deepEqual(events, [{ a: 1 }, { b: 2 }]);
});

test("a rewrite streams visible text, returns the cleaned prompt, and logs no prompt text", async () => {
  const { fetchImpl, calls } = fakeGateway(() =>
    sse([
      event("<think>hidden"),
      event(" plan</think>A secret cabin"),
      event(" at dusk, warm window light."),
      "data: [DONE]\n\n",
    ]),
  );
  const lines = [];
  const engine = createAssistant(gateway(), {
    fetchImpl,
    log: { info: (line) => lines.push(line), warn: (line) => lines.push(line) },
  });
  const deltas = [];
  const result = await engine.rewrite({
    profile,
    guide: { summary: "Lead with the light.", sources: ["https://x.invalid"] },
    prompt: "secret cabin",
    preset: "photographic",
    onDelta: (text) => deltas.push(text),
  });
  assert.equal(deltas.join(""), "A secret cabin at dusk, warm window light.");
  assert.deepEqual(
    [result.prompt, result.source, result.preset, result.model, result.referencesRead],
    [
      "A secret cabin at dusk, warm window light.",
      "assistant",
      "photographic",
      "ai/text-quick",
      false,
    ],
  );
  const [{ body, authorization, url }] = calls;
  assert.equal(url, "http://litellm.invalid:4000/v1/chat/completions");
  assert.equal(authorization, "Bearer fixture-key");
  assert.equal(body.stream, true);
  assert.match(
    body.messages[0].content,
    /Fixture Image[\s\S]*Lead with the light\.[\s\S]*Style: Photographic: write it as a real photograph/,
  );
  assert.doesNotMatch(body.messages[0].content, /x\.invalid/, "no guide sources");
  assert.equal(body.messages[1].content, "secret cabin");
  assert.match(lines[0], /^Prompt assistant rewrite for custom:fixture in \d+ ms$/);
  assert.doesNotMatch(lines.join("\n"), /secret/);
});

test("a gateway that does not stream hands over the whole reply; a guide may override a preset", async () => {
  const { fetchImpl, calls } = fakeGateway(() => json("<think>x</think>Short cabin."));
  const engine = createAssistant(gateway(), { fetchImpl, log: quiet });
  const deltas = [];
  const result = await engine.rewrite({
    profile,
    guide: { summary: "S", presets: { concise: "House concise rule." } },
    prompt: "a cabin",
    preset: "concise",
    onDelta: (text) => deltas.push(text),
  });
  assert.deepEqual([deltas, result.prompt], [["Short cabin."], "Short cabin."]);
  assert.match(calls[0].body.messages[0].content, /Style: House concise rule\.$/);
});

test("chat streams reasoning_content and <think> blocks as thinking, apart from the reply", async () => {
  const reasoning = (text) =>
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: text } }] })}\n\n`;
  const { fetchImpl } = fakeGateway(() =>
    sse([reasoning("Consider "), reasoning("the light."), event("<think>Warm.</think>A cabin.")]),
  );
  const engine = createAssistant(gateway(), { fetchImpl, log: quiet });
  const thinking = [];
  const shown = [];
  const reply = await engine.chat({
    model: "ai/text",
    messages: [],
    onThinking: (piece) => thinking.push(piece),
    onDelta: (piece) => shown.push(piece),
  });
  assert.equal(thinking.join(""), "Consider the light.\n\nWarm.");
  assert.equal(shown.join(""), "A cabin.");
  assert.deepEqual([reply.text, reply.thinking], ["A cabin.", "Consider the light.\n\nWarm."]);
  // Without streaming, both kinds come back with the reply.
  const whole = createAssistant(gateway(), {
    fetchImpl: fakeGateway(() =>
      Response.json({
        choices: [
          { message: { reasoning_content: "Plan.", content: "<think>More.</think>Done." } },
        ],
      }),
    ).fetchImpl,
    log: quiet,
  });
  const answer = await whole.chat({ model: "ai/text", messages: [] });
  assert.deepEqual([answer.text, answer.thinking], ["Done.", "Plan.\n\nMore."]);
});

test("failures fall back to the original prompt with the reason, and a timeout aborts the call", async () => {
  const failing = [
    () => new Response("busy", { status: 503 }),
    () => {
      throw new TypeError("fetch failed");
    },
    () => json(""),
  ];
  const reasons = [];
  for (const reply of failing) {
    const engine = createAssistant(gateway(), {
      fetchImpl: fakeGateway(reply).fetchImpl,
      log: quiet,
    });
    const result = await engine.rewrite({ profile, prompt: "a cabin" });
    assert.deepEqual([result.prompt, result.source], ["a cabin", "fallback"]);
    reasons.push(result.reason);
  }
  assert.deepEqual(reasons, ["HTTP 503", "unreachable", "unusable reply"]);
  const hanging = (_body, options) =>
    new Promise((_resolve, reject) =>
      options.signal.addEventListener("abort", () => reject(options.signal.reason)),
    );
  const slow = createAssistant(gateway(), {
    fetchImpl: fakeGateway(hanging).fetchImpl,
    log: quiet,
    timeoutMs: 30,
    streamTimeoutMs: 30,
  });
  const started = Date.now();
  const timedOut = await slow.rewrite({ profile, prompt: "a cabin", onDelta: () => {} });
  assert.deepEqual([timedOut.source, timedOut.reason], ["fallback", "timeout"]);
  assert.ok(Date.now() - started < 2000);
  // A caller's own cancel is not a fallback: it throws.
  const controller = new AbortController();
  const pending = slow.rewrite({ profile, prompt: "a cabin", signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /cancelled/);
});

test("references go to a vision model as image parts; a text-only model gets none and says so", async () => {
  const references = [
    { mime: "image/jpeg", data: "AAAA" },
    { mime: "image/png", data: "BBBB" },
  ];
  const seen = fakeGateway(() => json("A cabin like the reference."));
  const vision = createAssistant(gateway(), {
    fetchImpl: seen.fetchImpl,
    log: quiet,
    supportsVision: async () => true,
  });
  const read = await vision.rewrite({ profile, prompt: "a cabin", references });
  assert.equal(read.referencesRead, true);
  const content = seen.calls[0].body.messages[1].content;
  assert.deepEqual(
    content.map((part) => part.type),
    ["text", "image_url", "image_url"],
  );
  assert.equal(content[1].image_url.url, "data:image/jpeg;base64,AAAA");
  assert.match(seen.calls[0].body.messages[0].content, /2 reference images are attached: describe/);
  // Without a runtime to ask, the text model counts as text-only.
  const text = fakeGateway(() => json("A cabin."));
  const blind = createAssistant(gateway(), { fetchImpl: text.fetchImpl, log: quiet });
  const unread = await blind.rewrite({ profile, prompt: "a cabin", references });
  assert.equal(unread.referencesRead, false);
  assert.equal(typeof text.calls[0].body.messages[1].content, "string");
  assert.match(text.calls[0].body.messages[0].content, /not shown to you/);
  assert.deepEqual(
    await createAssistant(gateway(), { fetchImpl: text.fetchImpl, log: quiet }).listModels(),
    ["ai/text-quick", "ai/uncensored", "ai/vision"],
  );
});

test("FLUX.3 Enhance uses the maker’s upsampler prompt verbatim", async () => {
  const seen = fakeGateway(() => json("Full-color outdoor photograph of a cabin."));
  const engine = createAssistant(gateway(), {
    fetchImpl: seen.fetchImpl,
    log: quiet,
    supportsVision: async () => true,
  });
  await engine.rewrite({
    profile: { ...profile, family: "flux3" },
    prompt: "a cabin",
    preset: "enhance",
  });
  assert.equal(seen.calls[0].body.messages[0].content, flux3Upsampler.text);
  assert.equal(seen.calls[0].body.messages[1].content, "a cabin");
  await engine.rewrite({
    profile: { ...profile, family: "flux3" },
    prompt: "make it red",
    preset: "enhance",
    references: [{ mime: "image/jpeg", data: "AAAA" }],
  });
  assert.equal(seen.calls[1].body.messages[0].content, flux3Upsampler.edit);
  assert.match(
    seen.calls[1].body.messages[1].content[0].text,
    /^Reference images follow in order[\s\S]*User request: make it red/,
  );
  // Other presets keep Studio's own instructions.
  await engine.rewrite({
    profile: { ...profile, family: "flux3" },
    prompt: "a cabin",
    preset: "cinematic",
  });
  assert.match(seen.calls[2].body.messages[0].content, /Style: Cinematic/);
});

test("Spicy runs on its own model and is refused without one", async () => {
  const seen = fakeGateway(() => json("A sultry scene."));
  const off = createAssistant(gateway(), { fetchImpl: seen.fetchImpl, log: quiet });
  await assert.rejects(
    off.rewrite({ profile, prompt: "a couple", preset: "spicy" }),
    (error) => error.status === 409 && /Spicy model/.test(error.message),
  );
  const environment = gateway();
  const live = createAssistant(environment, { fetchImpl: seen.fetchImpl, log: quiet });
  environment.STUDIO_ASSISTANT_SPICY_MODEL = "ai/uncensored";
  const result = await live.rewrite({ profile, prompt: "a couple", preset: "spicy" });
  assert.equal(result.model, "ai/uncensored", "a model chosen in Settings applies at once");
  assert.equal(seen.calls.at(-1).body.model, "ai/uncensored");
  await assert.rejects(live.rewrite({ profile, prompt: "x", preset: "nope" }), /known preset/);
});

test("negatives: none when the guide says so, written otherwise, the guide default as fallback", async () => {
  const seen = fakeGateway(() => json("Negative: blurry, extra fingers"));
  const engine = createAssistant(gateway(), { fetchImpl: seen.fetchImpl, log: quiet });
  assert.deepEqual(
    await engine.negative({ profile, guide: { negative: { effect: "none" } }, prompt: "a cabin" }),
    { negative: null, unused: true, source: "guide" },
  );
  assert.equal(
    (
      await engine.negative({
        profile: { ...profile, capabilities: { negativePrompt: false } },
        prompt: "a cabin",
      })
    ).unused,
    true,
  );
  assert.equal(seen.calls.length, 0);
  const written = await engine.negative({
    profile,
    guide: { negative: { effect: "recommended", default: "lowres" } },
    prompt: "a cabin",
    cfg: 4,
  });
  assert.deepEqual([written.negative, written.source], ["blurry, extra fingers", "assistant"]);
  const down = createAssistant(gateway(), {
    fetchImpl: fakeGateway(() => new Response("", { status: 500 })).fetchImpl,
    log: quiet,
  });
  const fallback = await down.negative({
    profile,
    guide: { negative: { effect: "recommended", default: "lowres, watermark" } },
    prompt: "a cabin",
    cfg: 4,
  });
  assert.deepEqual([fallback.negative, fallback.source], ["lowres, watermark", "fallback"]);
});

const library = [
  {
    name: "cabin-style.safetensors",
    info: {
      title: "Cosy Cabin",
      families: ["krea2"],
      triggers: ["cabincore"],
      tags: ["wooden cabin", "snow"],
      strengthRange: { min: 0, max: 1.5, step: 0.05, default: 0.8 },
    },
  },
  {
    name: "neon.safetensors",
    info: {
      title: "Neon City",
      families: ["krea2"],
      triggers: ["neonx"],
      description: "Cyberpunk streets",
    },
  },
  { name: "flux-cabin.safetensors", info: { title: "Cabin", families: ["flux1"] } },
  {
    name: "speed.safetensors",
    info: { title: "Cabin Turbo", families: ["krea2"], role: "acceleration" },
  },
];

test("LoRA matching pre-filters by family, role and words, then ranks with the model within the candidates", async () => {
  const candidates = preFilterLoras({
    profile,
    prompt: "a wooden cabin in the snow",
    loras: library,
  });
  assert.deepEqual(
    candidates.map((item) => item.name),
    ["cabin-style.safetensors"],
    "no other family, no acceleration file, no unrelated LoRA",
  );
  const seen = fakeGateway(() =>
    json(
      '```json\n{"loras": [{"name": "invented.safetensors"}, {"name": "cabin-style.safetensors", "strength": 9, "reason": "Snowy cabins"}]}\n```',
    ),
  );
  const engine = createAssistant(gateway(), { fetchImpl: seen.fetchImpl, log: quiet });
  const result = await engine.matchLoras({
    profile,
    prompt: "a wooden cabin in the snow",
    loras: library,
  });
  assert.deepEqual(result.loras, [
    {
      name: "cabin-style.safetensors",
      title: "Cosy Cabin",
      strength: 1.5,
      triggers: ["cabincore"],
      reason: "Snowy cabins",
    },
  ]);
  assert.match(
    seen.calls[0].body.messages[0].content,
    /Candidates: \[\{"name":"cabin-style\.safetensors"/,
  );
  // Nothing to choose from: no call at all.
  assert.deepEqual(await engine.matchLoras({ profile, prompt: "a jellyfish", loras: library }), {
    loras: [],
    source: "prefilter",
  });
  assert.equal(seen.calls.length, 1);
  // Without a usable reply, the pre-filter's best, at the publisher's default strength.
  const down = createAssistant(gateway(), {
    fetchImpl: fakeGateway(() => json("no idea")).fetchImpl,
    log: quiet,
  });
  const fallback = await down.matchLoras({
    profile,
    prompt: "neon cabin",
    loras: library,
    starred: ["neon.safetensors"],
  });
  assert.equal(fallback.source, "prefilter");
  assert.deepEqual(
    fallback.loras.map((item) => [item.name, item.strength]),
    [
      ["neon.safetensors", 1],
      ["cabin-style.safetensors", 0.8],
    ],
    "a starred LoRA ranks first",
  );
});

test("describe reads an image with a vision model, writes from a hint without one, and is unavailable otherwise", async () => {
  const reply = json(
    '{"prompt": "A red barn at noon.", "negative": "blurry", "profile": "custom:fixture", "loras": ["cabin-style.safetensors", "made-up"]}',
  );
  const seen = fakeGateway(() => reply.clone());
  const engine = createAssistant(gateway(), {
    fetchImpl: seen.fetchImpl,
    log: quiet,
    supportsVision: async () => true,
  });
  const read = await engine.describe({
    images: [{ mime: "image/png", data: "AAAA" }],
    profiles: [profile],
    loras: library,
  });
  assert.deepEqual(
    [read.available, read.vision, read.prompt, read.negative, read.profileId, read.loras],
    [true, true, "A red barn at noon.", "blurry", "custom:fixture", ["cabin-style.safetensors"]],
  );
  assert.equal(seen.calls[0].body.messages[1].content[1].type, "image_url");
  const blind = createAssistant(gateway(), {
    fetchImpl: fakeGateway(() => reply.clone()).fetchImpl,
    log: quiet,
  });
  assert.deepEqual(await blind.describe({ images: [{ mime: "image/png", data: "AAAA" }] }), {
    available: false,
    vision: false,
    model: "ai/text-quick",
    reason: "The running text model can’t read images.",
  });
  const hinted = await blind.describe({
    images: [{ mime: "image/png", data: "AAAA" }],
    hint: "red-barn-noon.png",
  });
  assert.deepEqual(
    [hinted.available, hinted.vision, hinted.prompt],
    [true, false, "A red barn at noon."],
  );
});

test("caption sends the image and reads the description and tags, or plain text without them", async () => {
  const tags = [
    "Red Barn",
    "noon",
    "noon",
    3,
    " field ",
    ...Array.from({ length: 20 }, (_, i) => `t${i}`),
  ];
  const seen = fakeGateway(() =>
    json(
      "```json\n" +
        JSON.stringify({ text: `  A red barn\nat noon. ${"x".repeat(700)}`, tags }) +
        "\n```",
    ),
  );
  const engine = createAssistant(gateway(), { fetchImpl: seen.fetchImpl, log: quiet });
  const reply = await engine.caption({ image: { mime: "image/jpeg", data: "AAAA" } });
  assert.equal(reply.model, "ai/text-quick");
  assert.equal(reply.text.length, 600);
  assert.match(reply.text, /^A red barn at noon\. x/);
  assert.equal(reply.tags.length, 15);
  assert.deepEqual(reply.tags.slice(0, 4), ["red barn", "noon", "field", "t0"]);
  const [system, user] = seen.calls[0].body.messages;
  assert.match(system.content, /apparent age range.*legible text, quoted exactly.*"tags"/s);
  assert.equal(user.content[1].type, "image_url");

  const plain = fakeGateway(() => json("  A red barn\nat noon."));
  const fallback = createAssistant(gateway(), { fetchImpl: plain.fetchImpl, log: quiet });
  assert.deepEqual(await fallback.caption({ image: { mime: "image/jpeg", data: "AAAA" } }), {
    text: "A red barn at noon.",
    tags: [],
    model: "ai/text-quick",
  });
});

test("guide drafts keep only the pack schema; profile drafts keep the template graph and mark unknown NSFW", async () => {
  assert.equal(validDraftGuide({ rules: ["x"] }), null);
  assert.deepEqual(
    validDraftGuide({
      name: "New",
      summary: " Lead with light. ",
      rules: ["R", 3],
      sampling: { steps: 30, nested: {} },
      negative: { effect: "none", default: "x" },
      extra: true,
    }),
    {
      name: "New",
      summary: "Lead with light.",
      patterns: [],
      rules: ["R"],
      sampling: { steps: 30 },
      pitfalls: [],
      negative: { effect: "none" },
    },
  );
  const engine = createAssistant(gateway(), {
    fetchImpl: fakeGateway(() => json('{"summary": "Write prose.", "rules": ["Keep it literal."]}'))
      .fetchImpl,
    log: quiet,
  });
  const drafted = await engine.draftGuide({ profile, sourceText: "Model card text" });
  assert.deepEqual([drafted.guide.summary, drafted.aiDrafted], ["Write prose.", true]);
  const template = {
    studio: {
      id: "krea2-template",
      name: "Template",
      kind: "image",
      defaults: { model: "old.safetensors", steps: 8 },
      controls: { prompt: { node: "2", input: "text" } },
    },
    graph: {
      1: { class_type: "UNETLoader", inputs: { unet_name: "old.safetensors" } },
      2: { class_type: "CLIPTextEncode", inputs: { text: "" } },
    },
  };
  const pure = draftedProfile({
    id: "new-model",
    template,
    modelFile: "new.safetensors",
    recommended: { steps: 28, cfg: 3.5, sampler: "euler; rm -rf" },
  });
  assert.deepEqual(
    [
      pure.studio.id,
      pure.studio.defaults.model,
      pure.studio.defaults.steps,
      pure.studio.defaults.cfg,
      pure.studio.defaults.sampler,
      pure.studio.nsfw,
      pure.graph[1].inputs.unet_name,
    ],
    ["new-model", "new.safetensors", 28, 3.5, undefined, true, "new.safetensors"],
  );
  assert.equal(template.graph[1].inputs.unet_name, "old.safetensors", "the template is untouched");
  const fromPage = createAssistant(gateway(), {
    fetchImpl: fakeGateway(() =>
      json('{"name": "New Model", "nsfw": false, "steps": 30, "sampler": "dpmpp_2m"}'),
    ).fetchImpl,
    log: quiet,
  });
  const read = await fromPage.draftProfile({
    id: "new-model",
    template,
    modelFile: "new.safetensors",
    sourceText: "Recommended: 30 steps, DPM++ 2M",
  });
  assert.deepEqual(
    [
      read.profile.studio.name,
      read.profile.studio.nsfw,
      read.profile.studio.defaults.steps,
      read.profile.studio.defaults.sampler,
      read.aiDrafted,
      read.source,
    ],
    ["New Model", false, 30, "dpmpp_2m", true, "assistant"],
  );
});
