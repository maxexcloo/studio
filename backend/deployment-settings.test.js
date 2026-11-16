import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readRuntimeDocument, writeRuntimeDocument } from "./persistence/runtime.ts";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-deployment-settings-"));
process.env.STUDIO_DATA_DIR = temporary;
process.env.STUDIO_DEFAULT_IMAGE_PROFILE = "deployment-profile";
delete process.env.STUDIO_GALLERY_CAPTIONS;
delete process.env.STUDIO_IMAGE_SEARCH;
delete process.env.STUDIO_GALLERY_WHILE_BUSY;
delete process.env.STUDIO_RETIRED_SETTING;
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
  settings.saveDeploymentSetting("STUDIO_DREAM_OVERRIDE_SPICY", "0");
  settings.saveDeploymentSetting("STUDIO_DREAM_OVERRIDE_IMAGE_BACKEND", "cloud");
  assert.deepEqual(settings.dreamOverrides(), { spicy: false, imageBackend: "cloud" });
  assert.equal(settings.describeDreamOverrides().imageBackend.source, "studio");
  assert.equal(settings.describeDreamOverrides().enabled.value, null);
  process.env.STUDIO_DREAM_OVERRIDE_PAUSED = "1";
  try {
    assert.equal(settings.describeDreamOverrides().paused.locked, true);
    assert.equal(settings.dreamOverrides().paused, true);
    assert.throws(() => settings.saveDeploymentSetting("STUDIO_DREAM_OVERRIDE_PAUSED", "0"), {
      status: 409,
    });
  } finally {
    delete process.env.STUDIO_DREAM_OVERRIDE_PAUSED;
  }
});

test("Dream administration requires admin authority, validates inputs and reads saved overrides back", async () => {
  const { registerDeploymentRoutes } = await import("./deployment-routes.js");
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
    { mediaModels: async () => ({ models: { profiles: [] } }), unavailableModels: () => ({}) },
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
      ["STUDIO_DREAM_OVERRIDE_PAUSED", "false"],
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
  } finally {
    if (previous === undefined) delete process.env.STUDIO_MULTI_USER;
    else process.env.STUDIO_MULTI_USER = previous;
  }
});
