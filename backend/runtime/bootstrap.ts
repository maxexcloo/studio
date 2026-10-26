import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Express, RequestHandler } from "express";
import { DockerEngine, RuntimeController, type Workload } from "./controller.ts";
import { createRuntimeRouter, createTextAdmissionRouter } from "./routes.ts";

type Environment = Record<string, string | undefined>;
interface ConfiguredWorkload {
  kind: "image" | "video" | "text";
  placements: string[];
  studio?: { container: string; placement: string; url: string; apiKeyEnv?: string };
}

function required(environment: Environment, name: string) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

/** The ai-owned workload records retain identifiers; studio selects one fixed placement. */
export function loadRuntime(environment: Environment = process.env, fetchImpl = fetch) {
  if (!environment.STUDIO_CONFIG_DIR) return undefined;
  const path = join(environment.STUDIO_CONFIG_DIR, "workloads.json");
  if (!existsSync(path)) return undefined;
  const records = JSON.parse(readFileSync(path, "utf8")) as Record<string, ConfiguredWorkload>;
  const keys = new Map<string, string>();
  const workloads = Object.entries(records).flatMap(([id, record]): Workload[] => {
    if (!record.studio) return [];
    const config = record.studio;
    if (!record.placements.includes(config.placement))
      throw new Error(`Workload ${id} has an unsupported Studio placement.`);
    const target = new URL(config.url);
    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    )
      throw new Error(`Workload ${id} needs a direct worker URL.`);
    if (environment.BIFROST_URL && target.origin === new URL(environment.BIFROST_URL).origin)
      throw new Error(`Workload ${id} must point directly to its worker, not Bifrost.`);
    if (config.apiKeyEnv) keys.set(id, required(environment, config.apiKeyEnv));
    return [
      {
        id,
        container: config.container,
        devices: config.placement.split(","),
        kind: record.kind === "text" ? "text" : "media",
        url: config.url.replace(/\/$/, ""),
      },
    ];
  });
  if (!workloads.length) return undefined;
  const automatic = environment.STUDIO_RUNTIME_AUTOMATIC === "1";
  if (
    automatic &&
    (environment.STUDIO_RUNTIME_OWNERSHIP_ACKNOWLEDGED !== "1" ||
      environment.STUDIO_TEXT_ADMISSION_ACKNOWLEDGED !== "1")
  ) {
    throw new Error(
      "Automatic runtime control requires STUDIO_RUNTIME_OWNERSHIP_ACKNOWLEDGED=1 and STUDIO_TEXT_ADMISSION_ACKNOWLEDGED=1.",
    );
  }
  const engine = new DockerEngine(required(environment, "STUDIO_DOCKER_URL"), fetchImpl);
  const readiness = async (workload: Workload) => {
    try {
      const key = keys.get(workload.id);
      const response = await fetchImpl(
        `${workload.url}/${workload.kind === "text" ? "health" : "system_stats"}`,
        {
          headers: key ? { Authorization: `Bearer ${key}` } : {},
          redirect: "error",
          signal: AbortSignal.timeout(5_000),
        },
      );
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  };
  const controller = new RuntimeController(
    {
      running: (id) => engine.running(id),
      start: (id) => engine.start(id),
      stop: (id) => engine.stop(id),
      ready: readiness,
    },
    workloads,
    automatic,
  );
  return { controller, keys };
}

/** Mount before browser sign-in middleware, after JSON parsing and request guards. */
export function registerTextAdmission(
  app: Express,
  runtime: ReturnType<typeof loadRuntime>,
  environment: Environment = process.env,
) {
  if (!environment.STUDIO_TEXT_ADMISSION_TOKEN) return;
  if (!runtime) throw new Error("Text admission requires configured Studio workloads.");
  const expected = Buffer.from(`Bearer ${environment.STUDIO_TEXT_ADMISSION_TOKEN}`);
  const authenticate: RequestHandler = (request, response, next) => {
    const actual = Buffer.from(request.get("Authorization") ?? "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      response.status(401).json({ error: "Unauthorised." });
      return;
    }
    next();
  };
  const workloadId = required(environment, "STUDIO_TEXT_WORKLOAD");
  if (
    !runtime.controller.workloads.some(
      (workload) => workload.id === workloadId && workload.kind === "text",
    )
  )
    throw new Error("STUDIO_TEXT_WORKLOAD must select a configured text workload.");
  const apiKey = runtime.keys.get(workloadId);
  if (!apiKey) throw new Error("Text admission requires the workload studio.apiKeyEnv credential.");
  app.use(
    "/api/local-text",
    authenticate,
    createTextAdmissionRouter({ controller: runtime.controller, workloadId, apiKey }),
  );
}

/** Mount after account middleware with the existing administrator requirement. */
export function registerRuntimeStatus(
  app: Express,
  runtime: ReturnType<typeof loadRuntime>,
  requireAdmin: RequestHandler,
) {
  if (runtime) app.use("/api/runtime", requireAdmin, createRuntimeRouter(runtime.controller));
}
