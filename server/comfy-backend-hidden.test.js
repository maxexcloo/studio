import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startFakeComfy } from "./fixtures/fake-comfy.js";
import { withComfyBackend } from "./comfy-backends.js";

const primary = await startFakeComfy();
const video = await startFakeComfy();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-hidden-backend-"));
const output = path.join(temporary, "output");
fs.mkdirSync(path.join(output, "heiss-ui"), { recursive: true });
process.env.COMFY_URL = primary.url;
process.env.COMFY_VIDEO_URL = video.url;
process.env.HEISS_DATA_DIR = path.join(temporary, "data");
process.env.COMFY_OUTPUT_DIR = output;
const { comfy } = await import("./comfy.js");
const hidden = await import("./hidden-runs.js");

test.after(async () => { await primary.close(); await video.close(); fs.rmSync(temporary, { recursive: true, force: true }); });

test("secondary Hidden runs survive restart/outage and cleanup never uses primary history", async () => {
  const promptId = crypto.randomUUID();
  await withComfyBackend("video", async () => {
    hidden.rememberHiddenRun(null, promptId, { body: { prompt: "private reference", comfyBackend: "video" } });
    await comfy("/prompt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt_id: promptId, prompt: {}, extra_data: { heiss_hidden: true } }) });
  });
  // A restart loses the old job follower; do not also schedule cleanup in the
  // original module, which would race the restarted module for the same history.
  const persisted = fs.readFileSync(path.join(temporary, "data/hidden-runs.json"), "utf8");
  assert.match(persisted, /"comfyBackend":\s*"video"/);
  assert.equal(persisted.includes("private reference"), false);
  const restarted = await import("./hidden-runs.js?backend-restart");
  video.setDown(true);
  await restarted.settleHiddenRuns();
  assert.equal(restarted.hiddenRunCount(), 1, "unavailable video must not be mistaken for absent work on primary");
  const filename = path.join(output, "heiss-ui/late.mp4");
  fs.writeFileSync(filename, "private bytes");
  video.finish(promptId, { outputs: { saved: { videos: [{ filename: "late.mp4", subfolder: "heiss-ui", type: "output" }] } } });
  video.setDown(false);
  await restarted.settleHiddenRuns();
  assert.equal(restarted.hiddenRunCount(), 0);
  assert.equal(fs.existsSync(filename), false);
  assert.ok(video.deleted.includes(promptId));
  assert.equal(primary.deleted.length, 0);
});
