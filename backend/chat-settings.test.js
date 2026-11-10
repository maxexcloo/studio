import assert from "node:assert/strict";
import test from "node:test";
import {
  chatModelAllowed,
  chatSettings,
  preferredChatModel,
  servedChatModels,
} from "./chat-settings.js";

test("Chat uses the assistant's gateway with an anchored explicit model allowlist", () => {
  assert.equal(chatSettings({}), null);
  assert.equal(
    chatSettings({
      STUDIO_ASSISTANT_URL: "http://writer.invalid",
      STUDIO_ASSISTANT_KEY: "writer-fixture",
      STUDIO_ASSISTANT_CLOUD_MODEL: "writer",
    }),
    null,
  );
  const environment = {
    STUDIO_ASSISTANT_URL: "https://gateway.invalid/openai/v1",
    STUDIO_ASSISTANT_KEY: "chat-fixture",
    STUDIO_CHAT_MODELS: "local/*,deepseek/specific",
  };
  const settings = chatSettings(environment);
  assert.equal(settings.endpoint, "https://gateway.invalid/openai/v1/chat/completions");
  assert.equal(settings.root, "https://gateway.invalid/openai");
  for (const [id, allowed] of [
    ["local/text", true],
    ["deepseek/specific", true],
    ["other/local/text", false],
    ["deepseek/specific-extra", false],
  ])
    assert.equal(chatModelAllowed(id, settings.patterns), allowed);
  // Without a model list Chat is off; with one, the assistant's gateway must be set.
  assert.equal(chatSettings({ ...environment, STUDIO_CHAT_MODELS: "" }), null);
  for (const name of ["STUDIO_ASSISTANT_URL", "STUDIO_ASSISTANT_KEY"])
    assert.throws(() => chatSettings({ ...environment, [name]: "" }), new RegExp(name));
  for (const patterns of [", ,", "local/*/text", "local/**"])
    assert.throws(
      () => chatSettings({ ...environment, STUDIO_CHAT_MODELS: patterns }),
      /STUDIO_CHAT_MODELS/,
    );
  assert.throws(
    () => chatSettings({ ...environment, STUDIO_ASSISTANT_URL: "not-a-url" }),
    /STUDIO_ASSISTANT_URL/,
  );
});

test("administrators see every model with its workloads; others models that run or are parked", () => {
  const models = [
    { id: "cloud/model" },
    { id: "gemma/31b" },
    { id: "qwen/27b" },
    { id: "mistral/24b" },
  ];
  const workloads = [
    { id: "text-gemma", model: "gemma/31b" },
    { id: "text-gemma-tp2", model: "gemma/31b" },
    { id: "text-qwen", model: "qwen/27b" },
    { id: "text-mistral", model: "mistral/24b" },
    { id: "text-llama", model: "llama/8b" },
    { id: "comfyui" },
  ];
  assert.deepEqual(servedChatModels(models, workloads), [
    { id: "cloud/model" },
    { id: "gemma/31b", workloads: ["text-gemma", "text-gemma-tp2"] },
    { id: "qwen/27b", workloads: ["text-qwen"] },
    { id: "mistral/24b", workloads: ["text-mistral"] },
    { id: "llama/8b", label: "llama/8b", local: true, workloads: ["text-llama"] },
  ]);
  const phases = {
    "text-gemma": "parked",
    "text-gemma-tp2": "running",
    "text-qwen": "parked",
    "text-mistral": "down",
    "text-llama": "parked",
    comfyui: "running",
  };
  assert.deepEqual(servedChatModels(models, workloads, phases), [
    { id: "cloud/model" },
    { id: "gemma/31b" },
    { id: "qwen/27b", parked: true },
    { id: "llama/8b", label: "llama/8b", local: true, parked: true },
  ]);
});

test("Chat's default runs on the preferred side while it can answer, otherwise the other with a note", () => {
  const models = [{ id: "cloud/auto" }, { id: "local/auto", local: true }];
  assert.deepEqual(preferredChatModel(models, "cloud"), { id: "cloud/auto", note: "" });
  assert.deepEqual(preferredChatModel(models, undefined), { id: "local/auto", note: "" });
  const stopped = (model) => !model.local;
  assert.deepEqual(preferredChatModel(models, "local", stopped), {
    id: "cloud/auto",
    note: "No local text model is running, so a cloud one answered.",
  });
  assert.match(preferredChatModel(models.slice(1), "cloud").note, /No cloud text model/);
  // With nothing that can answer, the first listed stays, without a note.
  assert.deepEqual(
    preferredChatModel(models, "local", () => false),
    { id: "cloud/auto", note: "" },
  );
});
