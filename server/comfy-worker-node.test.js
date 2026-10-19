import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

// The companion ComfyUI node (comfyui/studio_worker) is Python; its own tests run here when Python is available.
const python = ["python3", "python"].find((command) => spawnSync(command, ["--version"]).status === 0);

test("the HEISS worker ComfyUI node deletes only named media inside its folders", { skip: python ? false : "Python is not installed" }, () => {
  const result = spawnSync(python, ["-I", "-B", "-m", "unittest", "discover", "-s", "comfyui/studio_worker", "-p", "test_*.py"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
