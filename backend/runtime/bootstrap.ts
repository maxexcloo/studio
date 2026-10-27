import type { Express, RequestHandler } from "express";
import { readRuntimeDocument, writeRuntimeDocument } from "../persistence/runtime.ts";
import { RuntimeController, type RuntimeRecord } from "./controller.ts";
import {
  inClusterRequest,
  KubernetesEngine,
  urlRequest,
  type KubernetesRequest,
} from "./kubernetes.ts";
import { createRuntimeRouter } from "./routes.ts";
import { kubernetesWorkloads } from "./workloads.ts";

type Environment = Record<string, string | undefined>;

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
  const { pools, workloads } = kubernetesWorkloads(environment);
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
  return { controller };
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
