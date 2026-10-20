import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-deployment-settings-"));
const envFile = path.join(temporary, ".env");
fs.writeFileSync(envFile, "STUDIO_ENABLE_LORAS=0\n");
process.env.HEISS_ENV_FILE = envFile;
process.env.STUDIO_DEFAULT_IMAGE_PROFILE = "deployment-profile";
delete process.env.STUDIO_ENABLE_LORAS;
delete process.env.STUDIO_ENABLE_GROK;
const settings = await import("./deployment-settings.js");
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

test("values report their source and only deployment values are locked", () => {
  assert.deepEqual(settings.settingSource("STUDIO_DEFAULT_IMAGE_PROFILE"), { source: "deployment", locked: true });
  assert.deepEqual(settings.settingSource("STUDIO_ENABLE_LORAS"), { source: "studio", locked: false });
  assert.deepEqual(settings.settingSource("STUDIO_ENABLE_GROK"), { source: "default", locked: false });
  const loras = settings.describeFlag(settings.catalogueFlags.find((item) => item.key === "STUDIO_ENABLE_LORAS"));
  assert.equal(loras.value, false);
  // Settings no longer switches built-in profiles or Tessera; Grok reads as Cloud Models.
  assert.equal(settings.catalogueFlags.some((item) => ["STUDIO_ENABLE_BUILTIN_PROFILES", "STUDIO_ENABLE_TESSERA"].includes(item.key)), false);
  assert.equal(settings.catalogueFlags.find((item) => item.key === "STUDIO_ENABLE_GROK").label, "Cloud Models");
  assert.equal(settings.catalogueFlags.find((item) => item.key === "STUDIO_ENABLE_LORAS").applies, "restart");
});

test("saving writes this studio's .env, refuses deployment values and clears back to the default", () => {
  assert.throws(() => settings.saveDeploymentSetting("STUDIO_DEFAULT_IMAGE_PROFILE", "other"), /deployment configuration/);
  assert.equal(process.env.STUDIO_DEFAULT_IMAGE_PROFILE, "deployment-profile");
  assert.deepEqual(settings.saveDeploymentSetting("STUDIO_DEFAULT_VIDEO_PROFILE", "video-1"), { source: "studio", locked: false });
  assert.match(fs.readFileSync(envFile, "utf8"), /STUDIO_DEFAULT_VIDEO_PROFILE=video-1/);
  assert.deepEqual(settings.saveDeploymentSetting("STUDIO_DEFAULT_VIDEO_PROFILE", ""), { source: "default", locked: false });
  assert.doesNotMatch(fs.readFileSync(envFile, "utf8"), /STUDIO_DEFAULT_VIDEO_PROFILE/);
});
