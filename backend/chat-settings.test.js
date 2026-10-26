import assert from "node:assert/strict";
import test from "node:test";
import { chatModelAllowed, chatSettings } from "./chat-settings.js";

test("Chat has a separate required gateway and anchored explicit model allowlist", () => {
  assert.equal(chatSettings({}), null);
  assert.equal(
    chatSettings({
      STUDIO_PROMPT_WRITER_URL: "http://writer.invalid",
      STUDIO_PROMPT_WRITER_KEY: "writer-fixture",
      STUDIO_PROMPT_WRITER_MODEL: "writer",
    }),
    null,
  );
  const environment = {
    STUDIO_CHAT_GATEWAY_URL: "https://gateway.invalid/openai/v1",
    STUDIO_CHAT_GATEWAY_KEY: "chat-fixture",
    STUDIO_CHAT_GATEWAY_MODELS: "ai/*,deepseek/specific",
  };
  const settings = chatSettings(environment);
  assert.equal(settings.endpoint, "https://gateway.invalid/openai/v1/chat/completions");
  assert.equal(settings.root, "https://gateway.invalid/openai");
  for (const [id, allowed] of [
    ["ai/text", true],
    ["deepseek/specific", true],
    ["other/ai/text", false],
    ["deepseek/specific-extra", false],
  ])
    assert.equal(chatModelAllowed(id, settings.patterns), allowed);
  for (const name of Object.keys(environment))
    assert.throws(() => chatSettings({ ...environment, [name]: "" }), new RegExp(name));
  for (const patterns of [", ,", "ai/*/text", "ai/**"])
    assert.throws(
      () => chatSettings({ ...environment, STUDIO_CHAT_GATEWAY_MODELS: patterns }),
      /STUDIO_CHAT_GATEWAY_MODELS/,
    );
  assert.throws(
    () => chatSettings({ ...environment, STUDIO_CHAT_GATEWAY_URL: "not-a-url" }),
    /STUDIO_CHAT_GATEWAY_URL/,
  );
});
