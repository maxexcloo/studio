import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

// The companion ComfyUI nodes (comfyui/) are Python; their own tests run here when Python is available.
const available = (command) => spawnSync(command, ["--version"]).status === 0;
const python = ["python3", "python"].find(available);
const unittest = ["-I", "-B", "-m", "unittest", "discover", "-p", "test_*.py"];

for (const [node, command, args] of [
  ["studio_worker", python, [...unittest, "-s", "comfyui/studio_worker"]],
  // Radiance tests import the package; CLIProxy loads its node with ComfyUI stubbed and needs Pillow.
  ["radiance", python, [...unittest, "-s", "comfyui/radiance", "-t", "comfyui"]],
  [
    "cliproxy",
    available("uv") && "uv",
    ["run", "--no-project", "--with", "pillow", "python", ...unittest, "-s", "comfyui/cliproxy"],
  ],
]) {
  test(
    `the ${node} ComfyUI node passes its Python tests`,
    { skip: command ? false : "Python or uv is not installed" },
    () => {
      const result = spawnSync(command, args, { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    },
  );
}
