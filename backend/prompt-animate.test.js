import assert from "node:assert/strict";
import test from "node:test";
import { animateInstructions, clipSeconds, writeAnimatePrompt } from "./prompt-animate.js";
import { createPromptStage, writingIssue, writingRequest } from "./prompt-stage.js";

// The three shapes Animate writes for, each with its mode's format rule from the merged guide.
const shapes = {
  wrapped: {
    profile: { id: "custom:video-h3-first-frame-fast-comfyui", family: "minimax-h3" },
    guide: { mode: { id: "keyframe", rules: ["Enter only the body of the description."] } },
  },
  sections: {
    profile: { id: "custom:video-h3-reference-fast-comfyui", family: "minimax_h3" },
    guide: {
      mode: {
        id: "optional-reference",
        rules: ["With an attached image, enter all six sections."],
      },
    },
  },
  grok: {
    profile: { id: "custom:video-grok-imagine-cloud", family: "grok" },
    guide: { mode: { id: "video", rules: ["Write one detailed paragraph."] } },
  },
};

test("each profile shape gets its guide's format, with sound for H3 and Grok", () => {
  const writing = { theme: "action", source: "A skater" };
  for (const { profile, guide } of Object.values(shapes)) {
    const system = animateInstructions({ profile, guide, writing, seconds: 8 });
    assert.ok(system.includes(guide.mode.rules[0]), profile.id);
    assert.match(system, /makes sound with the picture/, profile.id);
    assert.match(system, /three beats that fill the 8-second clip/, profile.id);
  }
  const silent = animateInstructions({ profile: { id: "video:wan", family: "wan22" }, writing });
  assert.match(silent, /makes no sound/);
  assert.match(silent, /two to four beats/);
  const extend = animateInstructions({ ...shapes.grok, writing: { ...writing, extend: true } });
  assert.match(extend, /Don't replay its action: escalate it or turn it/);
  assert.equal(writingRequest({ kind: "animate", theme: "action", extend: true }).extend, true);
});

test("the clip's length comes from the control the profile runs on", () => {
  const frames = { defaults: { frames: 192, fps: 24, duration: 5 } };
  assert.equal(clipSeconds({}, frames), 8);
  assert.equal(clipSeconds({ frames: 288 }, frames), 12);
  assert.equal(clipSeconds({ duration: 10 }, { capabilities: { duration: true } }), 10);
  assert.equal(clipSeconds({}, {}), 0);
});

const video = { id: "video:test", label: "Motion", kind: "video" };
const calls = [];
const engine = {
  model: async (call) => `local/${call}`,
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

test("Animate is admitted only for known themes, with Spicy behind Uncensored Models", () => {
  assert.equal(issue({ promptAssistant: true }, { theme: "cinematic" }), undefined);
  assert.equal(issue({}, { theme: "cinematic" }), 403);
  assert.equal(issue({ promptAssistant: true }, { theme: "dance" }), 400);
  assert.equal(issue({ promptAssistant: true }, { theme: "custom" }), 400);
  assert.equal(issue({ promptAssistant: true }, { theme: "spicy" }), 403);
  assert.equal(
    issue({ promptAssistant: true, uncensoredModels: true }, { theme: "spicy" }),
    undefined,
  );
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
        frames: 120,
        fps: 24,
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
    model: "local/animate",
  });
  assert.deepEqual(shown, [
    ["thinking", "A push-in suits a bird."],
    ["prompt", '"The camera slowly pushes in."'],
  ]);
  assert.match(calls[0].messages[0].content, /Cinematic Camera/);
  assert.match(calls[0].messages[0].content, /5-second clip/);
  assert.match(calls[0].messages[1].content, /An amber bird/);
  const spicy = await writeAnimatePrompt({
    engine,
    profile: video,
    guide: null,
    writing: { theme: "spicy" },
  });
  assert.equal(spicy.model, "local/animate");
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
