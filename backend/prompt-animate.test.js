import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { registerAnimatePromptRoute } from "./prompt-animate.js";

const video = { id: "video:test", label: "Motion", kind: "video" };
const calls = [];
const engine = {
  settings: () => ({ model: "ai/text", spicyModel: "ai/spicy" }),
  chat: async (body) => {
    calls.push(body);
    return { text: '"The camera slowly pushes in."' };
  },
};

async function post(account, body) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.studioAccount = account;
    next();
  });
  registerAnimatePromptRoute(app, { engine, profiles: async () => [video], guide: () => null });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/assistant/animate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

const user = (features) => ({ authenticated: true, role: "user", features });

test("Animate themes write a motion prompt and keep Spicy behind NSFW Models", async () => {
  const written = await post(user({ promptAssistant: true }), {
    profileId: video.id,
    prompt: "An amber bird",
    theme: "cinematic",
  });
  assert.deepEqual(written, {
    status: 200,
    body: { ok: true, prompt: "The camera slowly pushes in.", model: "ai/text" },
  });
  assert.match(calls[0].messages[0].content, /Cinematic Camera/);
  assert.match(calls[0].messages[1].content, /An amber bird/);

  const refused = await post(user({ promptAssistant: true }), {
    profileId: video.id,
    theme: "spicy",
  });
  assert.equal(refused.status, 403);
  const spicy = await post(user({ promptAssistant: true, nsfwModels: true }), {
    profileId: video.id,
    theme: "spicy",
  });
  assert.equal(spicy.body.model, "ai/spicy");

  assert.equal(
    (await post(user({ promptAssistant: true }), { profileId: video.id, theme: "custom" })).status,
    400,
  );
  assert.equal(
    (await post(user({ promptAssistant: true }), { profileId: "image:test", theme: "action" }))
      .status,
    404,
  );
  assert.equal(calls.length, 2);
});
