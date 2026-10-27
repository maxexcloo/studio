import assert from "node:assert/strict";
import test from "node:test";
import { writeAnimatePrompt } from "./prompt-animate.js";
import { createPromptStage, writingIssue, writingRequest } from "./prompt-stage.js";

const video = { id: "video:test", label: "Motion", kind: "video" };
const calls = [];
const engine = {
  settings: () => ({ model: "ai/text", spicyModel: "ai/spicy" }),
  chat: async (body) => {
    calls.push(body);
    body.onThinking?.("A push-in suits a bird.");
    body.onDelta?.('"The camera slowly pushes in."');
    return { text: '"The camera slowly pushes in."', thinking: "A push-in suits a bird." };
  },
};
const user = (features) => ({ authenticated: true, role: "user", features });
const issue = (features, writing) =>
  writingIssue(writingRequest({ kind: "animate", ...writing }), { engine, account: user(features) })
    ?.status;

test("Animate is admitted only for known themes, with Spicy behind NSFW Models", () => {
  assert.equal(issue({ promptAssistant: true }, { theme: "cinematic" }), undefined);
  assert.equal(issue({}, { theme: "cinematic" }), 403);
  assert.equal(issue({ promptAssistant: true }, { theme: "dance" }), 400);
  assert.equal(issue({ promptAssistant: true }, { theme: "custom" }), 400);
  assert.equal(issue({ promptAssistant: true }, { theme: "spicy" }), 403);
  assert.equal(issue({ promptAssistant: true, nsfwModels: true }, { theme: "spicy" }), undefined);
  // A client can't pass off its own text as the written prompt.
  assert.equal(
    writingRequest({ kind: "animate", theme: "living", prompt: "x", thinking: "y" }).prompt,
    undefined,
  );
});

test("the writing stage streams the motion prompt and its thinking with room to think", async () => {
  const shown = [];
  const stage = createPromptStage({
    engine,
    account: () => undefined,
    profiles: async () => [video],
    guide: () => null,
  });
  const written = await stage(
    {
      ownerId: "",
      input: {
        profileId: video.id,
        writing: { kind: "animate", theme: "cinematic", source: "An amber bird" },
      },
    },
    {
      signal: new AbortController().signal,
      onThinking: (piece) => shown.push(["thinking", piece]),
      onDelta: (piece) => shown.push(["prompt", piece]),
    },
  );
  assert.deepEqual(written, {
    prompt: "The camera slowly pushes in.",
    thinking: "A push-in suits a bird.",
    model: "ai/text",
  });
  assert.deepEqual(shown, [
    ["thinking", "A push-in suits a bird."],
    ["prompt", '"The camera slowly pushes in."'],
  ]);
  assert.match(calls[0].messages[0].content, /Cinematic Camera/);
  assert.match(calls[0].messages[1].content, /An amber bird/);
  const spicy = await writeAnimatePrompt({
    engine,
    profile: video,
    guide: null,
    writing: { theme: "spicy" },
  });
  assert.equal(spicy.model, "ai/spicy");
  await assert.rejects(
    writeAnimatePrompt({
      engine: { ...engine, chat: async () => ({ text: "", thinking: "Out of tokens." }) },
      profile: video,
      guide: null,
      writing: { theme: "living" },
    }),
    /unusable reply/,
  );
});
