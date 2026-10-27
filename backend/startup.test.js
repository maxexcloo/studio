import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const commit = "0123456789abcdef0123456789abcdef01234567";
const version = commit.slice(0, 7);

for (const development of [false, true]) {
  test(
    `startup reports the image commit and ${development ? "Vite preview" : "bound API"} URL`,
    { timeout: 15000 },
    async (t) => {
      const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-startup-"));
      const child = fork(new URL("./index.js", import.meta.url), [], {
        env: {
          ...process.env,
          STUDIO_COMMIT: commit,
          STUDIO_CONFIG_DIR: "",
          STUDIO_DATA_DIR: data,
          STUDIO_ENV_FILE: path.join(data, ".env"),
          STUDIO_DEMO: "1",
          HOST: "127.0.0.1",
          PORT: "0",
          STUDIO_WORKERS: JSON.stringify([
            {
              id: "primary",
              url: "http://127.0.0.1:9",
              capabilities: ["image", "video", "upscale", "models"],
            },
          ]),
          STUDIO_DEV_PROXY_TOKEN: development ? "startup-test-proxy" : "",
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      const exited = once(child, "exit");
      t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await exited;
        fs.rmSync(data, { recursive: true, force: true });
      });
      let output = "";
      const reported = new Promise((resolve) =>
        child.stdout.on("data", (chunk) => {
          output += chunk;
          if (output.includes("Open http://localhost:")) resolve();
        }),
      );
      let errors = "";
      child.stderr.on("data", (chunk) => {
        errors += chunk;
      });
      const ready = await new Promise((resolve, reject) => {
        child.once("message", resolve);
        child.once("exit", (code) => reject(new Error(`Startup exited ${code}: ${errors}`)));
      });
      await reported;
      assert.equal(ready.version, version);
      assert.ok(output.includes(`Studio ${version}\nOpen ${ready.url}`));
      if (development) assert.equal(ready.url, "http://localhost:5173");
      else {
        const response = await fetch(`${ready.url}/api/stats`);
        assert.equal(response.ok, true);
        assert.equal((await response.json()).version, version);
      }
      child.kill("SIGTERM");
      assert.deepEqual(await exited, [0, null]);
    },
  );
}
