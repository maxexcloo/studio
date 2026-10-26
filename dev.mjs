import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { migrateRuntime } from "./backend/persistence/migration.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const { values } = parseArgs({ options: { demo: { type: "boolean" } } });
const dataDir = path.join(root, "data", values.demo ? "demo" : "development");
const environment = {
  ...process.env,
  HOST: "127.0.0.1",
  PORT: process.env.STUDIO_DEV_API_PORT || "18787",
  STUDIO_DEV_API_PORT: process.env.STUDIO_DEV_API_PORT || "18787",
  STUDIO_COMFY_SEARCH: "0",
  STUDIO_DATA_DIR: dataDir,
  STUDIO_ENV_FILE: path.join(dataDir, ".env"),
  STUDIO_MEDIA_DIR: path.join(dataDir, "media"),
  STUDIO_DEV_PROXY_TOKEN: crypto.randomBytes(32).toString("base64url"),
  STUDIO_RUNTIME_AUTOMATIC: "0",
  STUDIO_MULTI_USER: "0",
  STUDIO_OUTPUT_STORAGE: "studio",
};
if (values.demo) environment.STUDIO_DEMO = "1";
const siblingConfig = path.resolve(root, "../ai");
if (!environment.STUDIO_CONFIG_DIR && fs.existsSync(path.join(siblingConfig, "profiles")))
  environment.STUDIO_CONFIG_DIR = siblingConfig;
if (!environment.STUDIO_WORKERS && !environment.COMFY_URL && environment.STUDIO_CONFIG_DIR) {
  const workloadsFile = path.join(environment.STUDIO_CONFIG_DIR, "workloads.json");
  if (fs.existsSync(workloadsFile)) {
    const workloads = JSON.parse(fs.readFileSync(workloadsFile, "utf8"));
    const workers = Object.entries(workloads).flatMap(([id, workload]) =>
      ["image", "video"].includes(workload.kind) && workload.service?.url
        ? [
            {
              id,
              name: workload.label,
              url: workload.service.url,
              capabilities: workload.kind === "image" ? ["image", "models", "upscale"] : ["video"],
            },
          ]
        : [],
    );
    if (workers.length) environment.STUDIO_WORKERS = JSON.stringify(workers);
  }
}
const migration = migrateRuntime(dataDir, { apply: true });
if (migration.conflicts.length) throw new Error(migration.conflicts.join("\n"));

const children = [
  spawn(process.execPath, ["--watch", "--watch-preserve-output", "backend/index.js"], {
    cwd: root,
    env: environment,
    stdio: "inherit",
  }),
  spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--config",
      "frontend/vite.config.ts",
      "--host",
      environment.HOST,
      "--port",
      "5173",
      "--strictPort",
    ],
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
  `Studio preview: http://localhost:5173 (${values.demo ? "sample data" : "isolated development data"}; lifecycle control disabled)`,
);
