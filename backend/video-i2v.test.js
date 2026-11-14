import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-video-i2v-"));
process.env.STUDIO_DATA_DIR = path.join(scratch, "data");
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { classifyModel } = await import("./model/families.js");

test("Wan 2.2 14B I2V is read from its weights or name, and Wan 2.1 I2V stays apart", () => {
  assert.equal(
    classifyModel("unet", "remote/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors").family,
    "wan22_14b_i2v",
    "the name says i2v",
  );
});
