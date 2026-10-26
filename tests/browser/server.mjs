import { fork } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-browser-"));
const child = fork("backend/index.js", [], {
  // An unreachable backend and a fresh env file keep the suite independent of local ComfyUI and secrets.
  env: {
    ...process.env,
    COMFY_URL: "http://127.0.0.1:1",
    COMFY_VIDEO_URL: "",
    STUDIO_DATA_DIR: data,
    STUDIO_DEMO: "1",
    STUDIO_ENV_FILE: path.join(data, ".env"),
    STUDIO_ENABLE_PRESETS: "1",
    HOST: "127.0.0.1",
  },
  stdio: ["ignore", "inherit", "inherit", "ipc"],
});
child.on("exit", (code) => {
  fs.rmSync(data, { recursive: true, force: true });
  process.exit(code || 0);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
