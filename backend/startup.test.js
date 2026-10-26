import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const version = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

for (const development of [false, true]) {
  test(
    `startup reports the packaged version and ${development ? "Vite preview" : "bound API"} URL`,
    { timeout: 15000 },
    async (t) => {
      const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-startup-"));
      const child = fork(new URL("./index.js", import.meta.url), [], {
        env: {
          ...process.env,
          STUDIO_CONFIG_DIR: "",
          STUDIO_DATA_DIR: data,
          STUDIO_ENV_FILE: path.join(data, ".env"),
          STUDIO_DEMO: "1",
          HOST: "127.0.0.1",
          PORT: "0",
          COMFY_URL: "http://127.0.0.1:9",
          npm_lifecycle_event: development ? "dev" : "",
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
      assert.ok(output.includes(`Studio v${version}\nOpen ${ready.url}`));
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
