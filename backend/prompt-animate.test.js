import assert from "node:assert/strict";
import test from "node:test";
import { animateClip, animateInstructions, writeAnimatePrompt } from "./prompt-animate.js";
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
    const system = animateInstructions({ profile, guide, writing, clip: { seconds: 8 } });
    assert.ok(system.includes(guide.mode.rules[0]), profile.id);
    assert.match(system, /makes sound with the picture/, profile.id);
    assert.match(system, /only 8 seconds long: write for exactly that time/, profile.id);
    assert.match(system, /awake and able to speak, give them a short spoken line/, profile.id);
    assert.match(system, /speech to about 20 words/, profile.id);
  }
  const silent = animateInstructions({
    profile: { id: "video:wan", family: "wan22" },
    writing,
    clip: { seconds: 5, fps: 16 },
  });
  assert.match(silent, /makes no sound/);
  assert.doesNotMatch(silent, /dialogue with who says it/);
  assert.match(silent, /only 5 seconds long at 16 fps/);
  assert.match(silent, /At 16 fps fast motion judders/);
  assert.match(silent, /never add subjects or objects/);
  assert.match(silent, /Don't make it any more sexual/);
  assert.match(silent, /Let the light or mood shift/);
  assert.match(silent, /Animate what that prompt was going for/);
  const extend = animateInstructions({ ...shapes.grok, writing: { ...writing, extend: true } });
  assert.match(extend, /Don't replay its action: escalate it or turn it/);
  assert.match(extend, /two or three beats/);
  assert.doesNotMatch(extend, /judders/);
  assert.equal(writingRequest({ kind: "animate", theme: "action", extend: true }).extend, true);
});

test("each theme asks for its own motion and camera", () => {
  const theme = (name) =>
    animateInstructions({ ...shapes.grok, writing: { theme: name } }).split("Theme: ")[1];
  assert.match(theme("cinematic"), /camera move the subject's action motivates/);
  assert.match(theme("living"), /keeps rolling as if the photo were a candid video/);
  assert.match(theme("action"), /energetic action that this frame sets up/);
  assert.match(theme("dialogue"), /the people in the frame talk/);
  assert.match(theme("spicy"), /already in the frame[\s\S]*Every person in it is an adult/);
  assert.match(theme("custom"), /instruction decides what happens.*with what is in the frame/);
});

test("the beats and their pacing scale with the clip's length", () => {
  const pace = (seconds) =>
    animateInstructions({ ...shapes.grok, writing: { theme: "action" }, clip: { seconds } });
  assert.match(pace(5), /two beats of about 2\.5 seconds each/);
  assert.match(pace(5), /land by about 3 seconds/);
  assert.match(pace(8), /three beats of about 2\.7 seconds each[^:]*: the start state/);
  assert.match(pace(10), /three beats of about 3\.3 seconds each/);
  assert.match(pace(10), /land by about 6 seconds/);
  assert.match(pace(10), /needs more than 10 seconds/);
  assert.match(pace(10), /one main action/);
});

test("the clip's length and frame rate come from the control the profile runs on", () => {
  const frames = { defaults: { frames: 192, fps: 24, duration: 5 } };
  assert.deepEqual(animateClip({}, frames), { seconds: 8, fps: 24 });
  assert.deepEqual(animateClip({ frames: 288 }, frames), { seconds: 12, fps: 24 });
  assert.deepEqual(animateClip({ duration: 10 }, { capabilities: { duration: true } }), {
    seconds: 10,
    fps: 0,
  });
  assert.deepEqual(animateClip({}, {}), { seconds: 0, fps: 0 });
});

const video = { id: "video:test", label: "Motion", kind: "video" };
const calls = [];
const engine = {
  model: async (call) => `local/${call}`,
  supportsVision: async () => false,
  chat: async (body) => {
    calls.push(body);
    body.onThinking?.("A push-in suits a bird.");
    body.onDelta?.('"The camera slowly pushes in."');
    return { text: '"The camera slowly pushes in."', thinking: "A push-in suits a bird." };
  },
};
const user = (features) => ({
  authenticated: true,
  role: "user",
  features: { promptAssistant: true, ...features },
});
const issue = (features, writing) =>
  writingIssue(writingRequest({ kind: "animate", ...writing }), { engine, account: user(features) })
    ?.status;

test("Animate is admitted only for known themes, with Spicy behind Uncensored Models", () => {
  assert.equal(issue({}, { theme: "cinematic" }), undefined);
  assert.equal(issue({}, { theme: "dialogue" }), undefined);
  assert.equal(issue({}, { theme: "dance" }), 400);
  assert.equal(issue({}, { theme: "custom" }), 400);
  assert.equal(issue({}, { theme: "spicy" }), 403);
  assert.equal(issue({ uncensoredModels: true }, { theme: "spicy" }), undefined);
  assert.equal(issue({ promptAssistant: false }, { theme: "cinematic" }), 403);
  // Dream's Spicy needs it too.
  const dream = (features) =>
    writingIssue(writingRequest({ kind: "dream", spicy: true }), {
      engine,
      account: user(features),
    });
  assert.equal(dream({})?.status, 403);
  assert.equal(dream({ uncensoredModels: true }), null);
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
    frame: async () => assert.fail("a text-only model is never shown the frame"),
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
  assert.match(calls[0].messages[0].content, /only 5 seconds long at 24 fps/);
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

test("the writer sees the first frame when the model reads images, and reads its caption otherwise", async () => {
  const frame = { mime: "image/jpeg", data: "AAAA" };
  const asked = [];
  const stage = (vision, described = "") =>
    createPromptStage({
      engine: { ...engine, supportsVision: async () => vision },
      account: () => undefined,
      profiles: async () => [video],
      guide: () => null,
      frame: async (_account, assetId) => (asked.push(["frame", assetId]), frame),
      caption: (_account, assetId) => (asked.push(["caption", assetId]), described),
    })(
      {
        ownerId: "",
        input: {
          profileId: video.id,
          referenceAssets: [{ assetId: "frame-1", slot: "image" }],
          writing: { kind: "animate", theme: "living", source: "An amber bird" },
        },
      },
      { signal: new AbortController().signal },
    );
  calls.length = 0;
  await stage(true, "A small amber bird on a branch.");
  const [system, request] = calls[0].messages;
  assert.deepEqual(asked, [["frame", "frame-1"]]);
  assert.match(system.content, /You can see that frame\. Read it before writing/);
  assert.doesNotMatch(system.content, /under \d+ words/);
  assert.deepEqual(request.content[1], {
    type: "image_url",
    image_url: { url: "data:image/jpeg;base64,AAAA" },
  });
  assert.match(request.content[0].text, /An amber bird/);
  assert.doesNotMatch(request.content[0].text, /What the frame shows/);
  // A text-only writer reads the frame's caption instead.
  asked.length = calls.length = 0;
  await stage(false, "A small amber bird on a branch.");
  assert.deepEqual(asked, [["caption", "frame-1"]]);
  assert.match(calls[0].messages[0].content, /its description below says what it shows/);
  assert.match(
    calls[0].messages[1].content,
    /made from: An amber bird\nWhat the frame shows: A small amber bird on a branch\./,
  );
  // Without a caption it keeps to the prompt.
  calls.length = 0;
  await stage(false);
  assert.equal(typeof calls[0].messages[1].content, "string");
  assert.match(calls[0].messages[0].content, /keep to what the prompt below states/);
  assert.doesNotMatch(calls[0].messages[1].content, /What the frame shows/);
});
