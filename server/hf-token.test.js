import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// A token comes from the deployment: .env or the environment. Studio never writes one.
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "studio-env-"));
const envFile = path.join(folder, ".env");
const fromFile = `hf_${"f".repeat(20)}1234`;
fs.writeFileSync(envFile, `COMFY_URL=http://127.0.0.1:8188\nHF_TOKEN=${fromFile}\n`);
process.env.STUDIO_ENV_FILE = envFile;
delete process.env.HF_TOKEN;
delete process.env.HUGGING_FACE_HUB_TOKEN;
const hfAccess = await import("./hf-access.js");
const { hfTokenStatus } = hfAccess;
test.after(() => fs.rmSync(folder, { recursive: true, force: true }));

test("a token read from .env says so, without the token", () => {
  const status = hfTokenStatus();
  assert.deepEqual(status, { set: true, source: "file", key: "HF_TOKEN", hint: "hf_…1234" });
  assert.equal(JSON.stringify(status).includes(fromFile), false);
});

test("a token set outside .env reads as the environment's", () => {
  const status = hfTokenStatus({ HUGGING_FACE_HUB_TOKEN: `hf_${"s".repeat(20)}4321` });
  assert.deepEqual(status, {
    set: true,
    source: "environment",
    key: "HUGGING_FACE_HUB_TOKEN",
    hint: "hf_…4321",
  });
});

test("nothing in Studio can save or clear a token", () => {
  assert.equal("saveHfToken" in hfAccess, false);
  assert.match(fs.readFileSync(envFile, "utf8"), /^HF_TOKEN=/m);
});
