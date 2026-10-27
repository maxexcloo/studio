import { timingSafeEqual } from "node:crypto";
import type { Express, RequestHandler } from "express";
import { readRuntimeDocument, writeRuntimeDocument } from "../persistence/runtime.ts";
import { RuntimeController, type RuntimeRecord, type Workload } from "./controller.ts";
import {
  inClusterRequest,
  KubernetesEngine,
  urlRequest,
  type KubernetesRequest,
} from "./kubernetes.ts";
import { createRuntimeRouter, createTextAdmissionRouter } from "./routes.ts";

type Environment = Record<string, string | undefined>;
const kinds = ["image", "video", "text"];

function required(environment: Environment, name: string) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
function json(environment: Environment, name: string) {
  try {
    return JSON.parse(required(environment, name));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${name} is not valid JSON.`);
    throw error;
  }
}

/** Parse STUDIO_KUBERNETES_GPUS and STUDIO_KUBERNETES_WORKLOADS; anything malformed stops Studio with its name. */
function kubernetesWorkloads(environment: Environment) {
  const pools = json(environment, "STUDIO_KUBERNETES_GPUS") as Record<string, number>;
  for (const [pool, count] of Object.entries(pools))
    if (!Number.isInteger(count) || count < 1)
      throw new Error(`STUDIO_KUBERNETES_GPUS: ${pool} needs a whole number of GPUs.`);
  const records = json(environment, "STUDIO_KUBERNETES_WORKLOADS") as Record<
    string,
    Partial<Workload>
  >;
  const keys = new Map<string, string>();
  const workloads = Object.entries(records).map(([id, record]): Workload => {
    const problem = (detail: string) => new Error(`STUDIO_KUBERNETES_WORKLOADS: ${id} ${detail}.`);
    if (!kinds.includes(record.kind!)) throw problem("needs a kind of image, video or text");
    for (const field of ["namespace", "deployment", "pool", "url"] as const)
      if (typeof record[field] !== "string" || !record[field]) throw problem(`needs ${field}`);
    if (!(record.pool! in pools)) throw problem(`names pool ${record.pool}, which has no GPUs`);
    if (!Number.isInteger(record.gpus) || record.gpus! < 1 || record.gpus! > pools[record.pool!])
      throw problem(`needs gpus between 1 and the ${record.pool} pool's ${pools[record.pool!]}`);
    const target = new URL(record.url!);
    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    )
      throw problem("needs a direct worker URL");
    if (
      environment.STUDIO_BIFROST_URL &&
      target.origin === new URL(environment.STUDIO_BIFROST_URL).origin
    )
      throw problem("must point directly to its worker, not Bifrost");
    if (record.apiKeyEnv) keys.set(id, required(environment, record.apiKeyEnv));
    return {
      id,
      label: record.label || id,
      kind: record.kind!,
      namespace: record.namespace!,
      deployment: record.deployment!,
      pool: record.pool!,
      gpus: record.gpus!,
      url: record.url!.replace(/\/$/, ""),
      ...(record.apiKeyEnv ? { apiKeyEnv: record.apiKeyEnv } : {}),
    };
  });
  return { pools, workloads, keys };
}

/** Studio scales the configured GPU deployments on the cluster it runs in. */
export function loadRuntime(
  environment: Environment = process.env,
  {
    dataDir,
    fetchImpl = fetch,
    request,
  }: {
    dataDir?: string;
    fetchImpl?: typeof fetch;
    request?: KubernetesRequest;
  } = {},
) {
  if (!environment.STUDIO_KUBERNETES_WORKLOADS) return undefined;
  const { pools, workloads, keys } = kubernetesWorkloads(environment);
  if (!workloads.length) return undefined;
  const automatic = environment.STUDIO_RUNTIME_AUTOMATIC === "1";
  const engine = new KubernetesEngine(
    request ??
      (environment.STUDIO_KUBERNETES_URL
        ? urlRequest(environment.STUDIO_KUBERNETES_URL, fetchImpl)
        : inClusterRequest(environment)),
  );
  const name = "runtime-operations";
  const controller = new RuntimeController({
    engine,
    workloads,
    pools,
    automaticLifecycle: automatic,
    ...(dataDir
      ? {
          store: {
            read: () => {
              try {
                return readRuntimeDocument(dataDir, name) as RuntimeRecord;
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
                throw error;
              }
            },
            write: (record) => writeRuntimeDocument(dataDir, name, record),
          },
        }
      : {}),
  });
  if (automatic) setInterval(() => void controller.reconcile().catch(() => {}), 30_000).unref();
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
  if (!apiKey) throw new Error("Text admission requires the workload's apiKeyEnv credential.");
  app.use(
    "/api/local-text",
    authenticate,
    createTextAdmissionRouter({
      controller: runtime.controller,
      workloadId,
      apiKey,
    }),
  );
}

/** Mount after account middleware with the existing administrator requirement. */
export function registerRuntimeStatus(
  app: Express,
  runtime: ReturnType<typeof loadRuntime>,
  requireAdmin: RequestHandler,
  requestedBy: (request: Parameters<RequestHandler>[0]) => string,
) {
  if (runtime)
    app.use("/api/runtime", requireAdmin, createRuntimeRouter(runtime.controller, requestedBy));
}
