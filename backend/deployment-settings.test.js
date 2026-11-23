import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { dreamTimingSettings, maxDreamIdleMinutes } from "../shared/dream.ts";
import { readRuntimeDocument, writeRuntimeDocument } from "./persistence/runtime.ts";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-deployment-settings-"));
process.env.STUDIO_DATA_DIR = temporary;
process.env.STUDIO_DEFAULT_IMAGE_PROFILE = "deployment-profile";
delete process.env.STUDIO_GALLERY_CAPTIONS;
delete process.env.STUDIO_IMAGE_SEARCH;
delete process.env.STUDIO_GALLERY_WHILE_BUSY;
delete process.env.STUDIO_RETIRED_SETTING;
delete process.env.STUDIO_DEFAULT_TEXT_PROFILE;
writeRuntimeDocument(temporary, "settings", {
  STUDIO_GALLERY_CAPTIONS: "0",
  STUDIO_DEFAULT_IMAGE_PROFILE: "saved-profile",
  STUDIO_RETIRED_SETTING: "old",
});
const settings = await import("./deployment-settings.js");
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

test("values report their source, only deployment values are locked and retired keys drop", () => {
  assert.equal(process.env.STUDIO_RETIRED_SETTING, undefined);
  assert.deepEqual(settings.settingSource("STUDIO_DEFAULT_IMAGE_PROFILE"), {
    source: "deployment",
    locked: true,
  });
  assert.equal(process.env.STUDIO_DEFAULT_IMAGE_PROFILE, "deployment-profile");
  assert.deepEqual(settings.settingSource("STUDIO_GALLERY_CAPTIONS"), {
    source: "studio",
    locked: false,
  });
  assert.equal(settings.flagEnabled("STUDIO_GALLERY_CAPTIONS"), false);
  assert.deepEqual(settings.settingSource("STUDIO_IMAGE_SEARCH"), {
    source: "default",
    locked: false,
  });
  assert.equal(settings.flagEnabled("STUDIO_IMAGE_SEARCH"), true, "Image Search starts on");
  assert.equal(
    settings.flagEnabled("STUDIO_GALLERY_WHILE_BUSY"),
    false,
    "Run While Busy starts off",
  );
});

test("a switch saves only when it differs from its default", () => {
  settings.saveFlag("STUDIO_GALLERY_WHILE_BUSY", true);
  assert.equal(settings.flagEnabled("STUDIO_GALLERY_WHILE_BUSY"), true);
  settings.saveFlag("STUDIO_GALLERY_WHILE_BUSY", false);
  assert.equal(settings.flagEnabled("STUDIO_GALLERY_WHILE_BUSY"), false);
  assert.equal(readRuntimeDocument(temporary, "settings").STUDIO_GALLERY_WHILE_BUSY, undefined);
});

test("saving writes SQLite, refuses deployment values and clears back to the default", () => {
  assert.throws(
    () => settings.saveDeploymentSetting("STUDIO_DEFAULT_IMAGE_PROFILE", "other"),
    /deployment configuration/,
  );
  assert.deepEqual(settings.saveDeploymentSetting("STUDIO_DEFAULT_VIDEO_PROFILE", "video-1"), {
    source: "studio",
    locked: false,
  });
  assert.equal(readRuntimeDocument(temporary, "settings").STUDIO_DEFAULT_VIDEO_PROFILE, "video-1");
  assert.deepEqual(settings.saveDeploymentSetting("STUDIO_DEFAULT_VIDEO_PROFILE", ""), {
    source: "default",
    locked: false,
  });
  assert.equal(process.env.STUDIO_DEFAULT_VIDEO_PROFILE, undefined);
  // A value the deployment overrides stays saved for when it stops setting one.
  assert.deepEqual(readRuntimeDocument(temporary, "settings"), {
    STUDIO_GALLERY_CAPTIONS: "0",
    STUDIO_DEFAULT_IMAGE_PROFILE: "saved-profile",
  });
});

test("Dream overrides force only what is set, off included, and deployment locks apply", () => {
  assert.deepEqual(settings.dreamOverrides(), {});
  settings.saveDeploymentSetting("STUDIO_DREAM_OVERRIDE_UNCENSORED", "0");
  settings.saveDeploymentSetting("STUDIO_DREAM_OVERRIDE_IMAGE_BACKEND", "cloud");
  assert.deepEqual(settings.dreamOverrides(), { uncensored: false, imageBackend: "cloud" });
  assert.equal(settings.describeDreamPolicy().imageBackend.source, "studio");
  assert.equal(settings.describeDreamPolicy().enabled.value, null);
  process.env.STUDIO_DREAM_OVERRIDE_ENABLED = "1";
  try {
    assert.equal(settings.describeDreamPolicy().enabled.locked, true);
    assert.equal(settings.dreamOverrides().enabled, true);
    assert.throws(() => settings.saveDeploymentSetting("STUDIO_DREAM_OVERRIDE_ENABLED", "0"), {
      status: 409,
    });
  } finally {
    delete process.env.STUDIO_DREAM_OVERRIDE_ENABLED;
  }
});

test("Generation administration validates and applies Dream overrides and the default text profile", async () => {
  const { promptWriter } = await import("./account-policy.js");
  const { createAssistant } = await import("./assistant.js");
  const { registerDeploymentRoutes } = await import("./deployment-routes.js");
  let local;
  const assistantEngine = createAssistant(process.env, {
    resolveSettings: () => ({ root: "http://gateway.invalid", cloud: "cloud/auto" }),
    fetchImpl: async () => Response.json({ data: [{ id: "cloud/auto" }, { id: "local/auto" }] }),
    localText: async () => local,
  });
  const handlers = {};
  registerDeploymentRoutes(
    {
      get: (path, handler) => {
        handlers[`GET ${path}`] = handler;
      },
      post: (path, handler) => {
        handlers[`POST ${path}`] = handler;
      },
    },
    {
      assistantEngine,
      mediaModels: async () => ({ models: { profiles: [] } }),
      unavailableModels: () => ({}),
      workloadModels: () => ["local/text-default"],
    },
  );
  const previous = process.env.STUDIO_MULTI_USER;
  process.env.STUDIO_MULTI_USER = "1";
  try {
    const request = async (method, body, account = { role: "administrator" }) => {
      const response = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        setHeader() {},
        json(payload) {
          this.body = payload;
        },
      };
      await handlers[`${method} /api/settings/deployment`](
        { body, studioAccount: account },
        response,
      );
      return response;
    };
    for (const method of ["GET", "POST"]) {
      for (const account of [
        { role: "user" },
        { role: "administrator", credential: "mcp-token" },
      ]) {
        assert.equal(
          (await request(method, { key: "STUDIO_DREAM_OVERRIDE_ENABLED", value: true }, account))
            .statusCode,
          403,
        );
      }
    }
    for (const [key, value] of [
      // Paused is each account's own; it is not an override.
      ["STUDIO_DREAM_OVERRIDE_PAUSED", false],
      ["STUDIO_DREAM_OVERRIDE_VIDEO_BACKEND", "auto"],
      // Only the overridable settings are here; daily caps stay each account's.
      ["STUDIO_DREAM_DAILY_IMAGES", 10],
    ]) {
      assert.equal((await request("POST", { key, value })).statusCode, 400);
    }
    const saved = await request("POST", {
      key: "STUDIO_DREAM_OVERRIDE_VIDEO_BACKEND",
      value: "cloud",
    });
    assert.equal(saved.body.dream.videoBackend.value, "cloud");
    const read = await request("GET");
    assert.equal(read.body.dream.videoBackend.value, "cloud");
    const cleared = await request("POST", {
      key: "STUDIO_DREAM_OVERRIDE_VIDEO_BACKEND",
      value: null,
    });
    assert.equal(cleared.body.dream.videoBackend.value, null);

    for (const [name, { key, defaultValue }] of Object.entries(dreamTimingSettings)) {
      assert.equal(read.body.dream[name].value, defaultValue);
      const value = defaultValue ? 0 : 8;
      assert.equal((await request("POST", { key, value }, { role: "user" })).statusCode, 403);
      assert.equal(
        (await request("POST", { key, value: maxDreamIdleMinutes + 1 })).statusCode,
        400,
      );
      assert.equal((await request("POST", { key, value })).body.dream[name].value, value);
      assert.equal(settings.dreamTimingMinutes(name), value);
      assert.equal(readRuntimeDocument(temporary, "settings")[key], String(value));
      await request("POST", { key, value: defaultValue });
      assert.equal(readRuntimeDocument(temporary, "settings")[key], undefined);
    }

    const key = "STUDIO_DEFAULT_TEXT_PROFILE";
    assert.deepEqual((await request("GET")).body.defaults.textModels, [
      "cloud/auto",
      "local/auto",
      "local/text-default",
    ]);
    assert.equal((await request("POST", { key, value: "image-model" })).statusCode, 400);
    assert.equal((await request("POST", { key, value: "local/text-default" })).statusCode, 200);
    assert.equal((await request("GET")).body.defaults.text.configured, "local/text-default");
    assert.equal(readRuntimeDocument(temporary, "settings")[key], "local/text-default");

    const model = (preferences = {}) =>
      assistantEngine.model("rewrite", false, promptWriter(undefined, preferences));
    assert.equal(await model({ textCloud: "cloud/personal" }), "cloud/personal");
    local = { model: "local/auto" };
    assert.equal(await model(), "local/text-default");
    assert.equal(await model({ textLocal: "local/personal" }), "local/personal");
    assert.equal(await model({ text: "cloud" }), "cloud/uncensored");
    await request("POST", { key, value: "cloud/text-default" });
    assert.equal(await model(), "cloud/text-default");
    assert.equal(await model({ text: "local" }), "local/auto");
    await request("POST", { key, value: "" });
    assert.equal((await request("GET")).body.defaults.text.configured, "");
    assert.equal(await model({ textCloud: "cloud/personal" }), "cloud/personal");
  } finally {
    if (process.env.STUDIO_DEFAULT_TEXT_PROFILE)
      settings.saveDeploymentSetting("STUDIO_DEFAULT_TEXT_PROFILE", "");
    if (previous === undefined) delete process.env.STUDIO_MULTI_USER;
    else process.env.STUDIO_MULTI_USER = previous;
  }
});
