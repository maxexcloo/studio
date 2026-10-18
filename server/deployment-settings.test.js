import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-deployment-settings-"));
const envFile = path.join(temporary, ".env");
fs.writeFileSync(envFile, "HEISS_ENABLE_TESSERA=0\n");
process.env.HEISS_ENV_FILE = envFile;
process.env.HEISS_DEFAULT_IMAGE_PROFILE = "deployment-profile";
delete process.env.HEISS_ENABLE_TESSERA;
delete process.env.HEISS_ENABLE_GROK;
const settings = await import("./deployment-settings.js");
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

test("values report their source and only deployment values are locked", () => {
  assert.deepEqual(settings.settingSource("HEISS_DEFAULT_IMAGE_PROFILE"), { source: "deployment", locked: true });
  assert.deepEqual(settings.settingSource("HEISS_ENABLE_TESSERA"), { source: "studio", locked: false });
  assert.deepEqual(settings.settingSource("HEISS_ENABLE_GROK"), { source: "default", locked: false });
  const tessera = settings.describeFlag(settings.catalogueFlags.find((item) => item.key === "HEISS_ENABLE_TESSERA"));
  assert.equal(tessera.value, false);
  assert.equal(settings.catalogueFlags.find((item) => item.key === "HEISS_ENABLE_LORAS").applies, "restart");
});

test("saving writes this studio's .env, refuses deployment values and clears back to the default", () => {
  assert.throws(() => settings.saveDeploymentSetting("HEISS_DEFAULT_IMAGE_PROFILE", "other"), /deployment configuration/);
  assert.equal(process.env.HEISS_DEFAULT_IMAGE_PROFILE, "deployment-profile");
  assert.deepEqual(settings.saveDeploymentSetting("HEISS_DEFAULT_VIDEO_PROFILE", "video-1"), { source: "studio", locked: false });
  assert.match(fs.readFileSync(envFile, "utf8"), /HEISS_DEFAULT_VIDEO_PROFILE=video-1/);
  assert.deepEqual(settings.saveDeploymentSetting("HEISS_DEFAULT_VIDEO_PROFILE", ""), { source: "default", locked: false });
  assert.doesNotMatch(fs.readFileSync(envFile, "utf8"), /HEISS_DEFAULT_VIDEO_PROFILE/);
});
