import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const { values } = parseArgs({ options: { demo: { type: "boolean" } } });

// The preferred port, or a free one when another checkout already holds it.
function freePort(preferred) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (error) => (preferred ? resolve(freePort(0)) : reject(error)));
    probe.listen(Number(preferred), "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(String(port)));
    });
  });
}

const dataDir =
  process.env.STUDIO_DATA_DIR || path.join(root, "data", values.demo ? "demo" : "development");
const apiPort = await freePort(process.env.STUDIO_DEV_API_PORT || 18787);
const pagePort = await freePort(process.env.STUDIO_DEV_PORT || 5173);
// The shell overrides these. Image Search and Face Check download about 950 MB of models.
const environment = {
  HOST: "127.0.0.1",
  STUDIO_ENV_FILE: path.join(dataDir, ".env"),
  STUDIO_FACE_CHECK: "0",
  STUDIO_IMAGE_SEARCH: "0",
  STUDIO_MULTI_USER: "0",
  ...process.env,
  PORT: apiPort,
  STUDIO_DATA_DIR: dataDir,
  STUDIO_DEV_API_PORT: apiPort,
  STUDIO_DEV_PORT: pagePort,
};
if (values.demo) environment.STUDIO_DEMO = "1";

const children = [
  spawn(process.execPath, ["--watch", "--watch-preserve-output", "backend/index.js"], {
    cwd: root,
    env: environment,
    stdio: "inherit",
  }),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--config", "frontend/vite.config.ts"],
    { cwd: root, env: environment, stdio: "inherit" },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, () => stop());
for (const child of children) {
  child.once("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.once("exit", (code) => stop(code ?? 1));
}
console.log(
  `Studio preview: http://localhost:${pagePort} (${values.demo ? "sample data" : "isolated development data"}; lifecycle control disabled)`,
);
