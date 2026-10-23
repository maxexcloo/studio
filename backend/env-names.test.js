import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyLegacyEnvNames,
  currentEnvName,
  legacyEnvName,
  legacyEnvNotice,
  renamedSettings,
  shadowedLegacyEnvNames,
} from "./env-names.js";
import { readEnvFile, resolveLan } from "./lan.js";

const here = path.dirname(fileURLToPath(import.meta.url));

test("every old HEISS_* setting maps to its STUDIO_* name and back", () => {
  assert.ok(renamedSettings.includes("DATA_DIR"));
  assert.equal(currentEnvName("HEISS_DATA_DIR"), "STUDIO_DATA_DIR");
  assert.equal(legacyEnvName("STUDIO_DATA_DIR"), "HEISS_DATA_DIR");
  // Names that were never HEISS_* have no alias, either way.
  assert.equal(currentEnvName("HEISS_MULTI_USER"), "HEISS_MULTI_USER");
  assert.equal(legacyEnvName("STUDIO_MULTI_USER"), "");
  assert.equal(currentEnvName("COMFY_URL"), "COMFY_URL");
});

test("an old name fills the new one only when the new one is unset", () => {
  const env = { HEISS_DATA_DIR: "/old", HEISS_LAN: "1", STUDIO_LAN: "0", HEISS_UNKNOWN: "x" };
  assert.deepEqual(applyLegacyEnvNames(env), ["HEISS_DATA_DIR"]);
  assert.equal(env.STUDIO_DATA_DIR, "/old");
  assert.equal(env.STUDIO_LAN, "0", "the new name wins");
  assert.equal(env.STUDIO_UNKNOWN, undefined);
  // Limited to one source's keys.
  const limited = { HEISS_DEMO: "1", HEISS_TRASH_DAYS: "5" };
  assert.deepEqual(applyLegacyEnvNames(limited, new Set(["HEISS_DEMO"])), ["HEISS_DEMO"]);
  assert.equal(limited.STUDIO_TRASH_DAYS, undefined);
});

test("the deprecation notice is one line naming each old and new name", () => {
  assert.equal(legacyEnvNotice([]), "");
  const notice = legacyEnvNotice(["HEISS_TRASH_DAYS", "HEISS_DATA_DIR", "HEISS_DATA_DIR"]);
  assert.doesNotMatch(notice, /\n/);
  assert.match(notice, /HEISS_DATA_DIR → STUDIO_DATA_DIR, HEISS_TRASH_DAYS → STUDIO_TRASH_DAYS\.$/);
  // An old name beside a different new value (the image's own default, say) is called out, not silently lost.
  const shadowed = shadowedLegacyEnvNames({
    HEISS_DATA_DIR: "/elsewhere",
    STUDIO_DATA_DIR: "/data",
    HEISS_LAN: "1",
    STUDIO_LAN: "1",
  });
  assert.deepEqual(shadowed, ["HEISS_DATA_DIR"]);
  assert.match(
    legacyEnvNotice([], shadowed),
    /HEISS_DATA_DIR \(ignored: STUDIO_DATA_DIR is set\)\.$/,
  );
});

test("the dev launcher's view of .env and the LAN switch read old names too", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-lan-env-"));
  try {
    fs.writeFileSync(path.join(dir, ".env"), "HEISS_LAN=1\nHEISS_DATA_DIR=/data\n");
    const file = readEnvFile(dir);
    assert.equal(file.values.STUDIO_LAN, "1");
    assert.equal(file.values.STUDIO_DATA_DIR, "/data");
    assert.ok(file.keys.has("STUDIO_LAN"));
    assert.equal(resolveLan({ env: file.values, fileKeys: file.keys }).host, "0.0.0.0");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// env.js runs once per process, so each case starts a fresh one.
function inChild(env, script) {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: path.join(here, ".."),
    env: { PATH: process.env.PATH, NODE_TEST_CONTEXT: "", ...env },
    encoding: "utf8",
  });
  return JSON.parse(output);
}

test("old names from the shell and from Studio's settings file keep working, and saving retires the old line", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-env-"));
  const file = path.join(dir, "settings.env");
  try {
    fs.writeFileSync(
      file,
      "HEISS_LAN=1\nHEISS_COMFY_SEARCH=0\nSTUDIO_TRASH_DAYS=9\nHEISS_TRASH_DAYS=3\n",
    );
    const result = inChild(
      { HEISS_ENV_FILE: file, HEISS_DATA_DIR: "/shell-data", STUDIO_COMFY_SEARCH: "1" },
      `
      const env = await import("./backend/env.js");
      const before = { data: process.env.STUDIO_DATA_DIR, lan: process.env.STUDIO_LAN, search: process.env.STUDIO_COMFY_SEARCH, trash: process.env.STUDIO_TRASH_DAYS,
        lanFromFile: env.envFileKeys.has("STUDIO_LAN"), dataFromFile: env.envFileKeys.has("STUDIO_DATA_DIR"), used: [...env.legacyEnvInUse].sort() };
      env.writeLocalEnvValue("STUDIO_LAN", "0");
      env.removeLocalEnvValue("STUDIO_TRASH_DAYS");
      console.log(JSON.stringify({ before, lan: process.env.STUDIO_LAN, trash: process.env.STUDIO_TRASH_DAYS ?? null, file: (await import("node:fs")).readFileSync(${JSON.stringify(file)}, "utf8") }));
    `,
    );
    assert.equal(result.before.data, "/shell-data", "an old name from the shell");
    assert.equal(result.before.lan, "1", "an old name from the settings file");
    assert.equal(result.before.search, "1", "the new name wins over the old one");
    assert.equal(result.before.trash, "9", "the new name in the file wins over the old one there");
    assert.equal(
      result.before.lanFromFile,
      true,
      "an old name from the file stays editable in Settings",
    );
    assert.equal(
      result.before.dataFromFile,
      false,
      "an old name from the shell stays the deployment's",
    );
    assert.deepEqual(result.before.used, ["HEISS_DATA_DIR", "HEISS_ENV_FILE", "HEISS_LAN"]);
    assert.equal(result.lan, "0");
    assert.equal(result.trash, null);
    assert.equal(result.file, "STUDIO_LAN=0\nHEISS_COMFY_SEARCH=0\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an old name in the shell still beats a new one in the settings file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-env-"));
  const file = path.join(dir, "settings.env");
  try {
    fs.writeFileSync(file, "STUDIO_ALLOWED_HOSTS=from-file\n");
    const result = inChild(
      { STUDIO_ENV_FILE: file, HEISS_ALLOWED_HOSTS: "from-shell" },
      `
      const env = await import("./backend/env.js");
      console.log(JSON.stringify({ hosts: process.env.STUDIO_ALLOWED_HOSTS, fromFile: env.envFileKeys.has("STUDIO_ALLOWED_HOSTS") }));
    `,
    );
    assert.deepEqual(result, { hosts: "from-shell", fromFile: false });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
