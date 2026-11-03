import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeRuntimeDocument, readRuntimeDocument } from "./persistence/runtime.ts";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-deployment-settings-"));
process.env.STUDIO_DATA_DIR = temporary;
process.env.STUDIO_DEFAULT_IMAGE_PROFILE = "deployment-profile";
delete process.env.STUDIO_GALLERY_CAPTIONS;
delete process.env.STUDIO_IMAGE_SEARCH;
writeRuntimeDocument(temporary, "settings", {
  STUDIO_GALLERY_CAPTIONS: "0",
  STUDIO_DEFAULT_IMAGE_PROFILE: "saved-profile",
});
const settings = await import("./deployment-settings.js");
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

test("values report their source and only deployment values are locked", () => {
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
