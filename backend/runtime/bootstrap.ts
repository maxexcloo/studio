import type { Express, RequestHandler } from "express";

import type { BenchmarkRun } from "../../shared/runtime.ts";
import { logEvent } from "../crash-log.js";
import { readRuntimeDocument, writeRuntimeDocument } from "../persistence/runtime.ts";
import { RadianceClient } from "../providers/radiance.ts";
import { Benchmarks } from "./benchmarks.ts";
import { RuntimeController, type RuntimeRecord } from "./controller.ts";
import {
  KubernetesEngine,
  type KubernetesRequest,
  inClusterRequest,
  urlRequest,
} from "./kubernetes.ts";
import { createRuntimeRouter } from "./routes.ts";
import { discoverWorkloads } from "./workloads.ts";

type Environment = Record<string, string | undefined>;

/** Studio scales the GPU deployments it finds at start on the cluster it runs in. */
export async function loadRuntime(
  environment: Environment = process.env,
  {
    dataDir,
    fetchImpl = fetch,
    request,
  }: {
    dataDir: string;
    fetchImpl?: typeof fetch;
    request?: KubernetesRequest;
  },
) {
  if (!environment.STUDIO_KUBERNETES_NAMESPACES) return undefined;
  const send =
    request ??
    (environment.STUDIO_KUBERNETES_URL
      ? urlRequest(environment.STUDIO_KUBERNETES_URL, fetchImpl)
      : inClusterRequest(environment));
  const { pools, workloads } = await discoverWorkloads(environment, send);
  if (!workloads.length) return undefined;
  const engine = new KubernetesEngine(send);
  const document = <T>(name: string) => ({
    store: {
      read: () => readRuntimeDocument(dataDir, name) as T | undefined,
      write: (value: T) => writeRuntimeDocument(dataDir, name, value),
    },
  });
  const controller = new RuntimeController({
    engine,
    workloads,
    pools,
    ...document<RuntimeRecord>("runtime-operations"),
  });
  const benchmarks = new Benchmarks({
    request: send,
    workloads,
    environment,
    fetchImpl,
    ...document<BenchmarkRun[]>("runtime-benchmarks"),
  });
  const shutdown = new AbortController();
  const radiance = workloads
    .filter((workload) => workload.backend === "radiance")
    .map(({ id, url }) => ({
      id,
      client: new RadianceClient(url, fetchImpl, environment.STUDIO_RADIANCE_KEY),
      since: Date.now() / 1000,
    }));
  const reconcile = setInterval(() => {
    // Restore placement, handle swaps, then recover an idle Radiance short of host memory.
    void controller
      .reconcile()
      .then(() => (shutdown.signal.aborted ? undefined : controller.swapOnDemand()))
      .then(() => controller.restartWhenIdle(shutdown.signal))
      .catch(() => {});
    // Retain recent GPU samples in the logs. Allow one missed interval before dropping old samples.
    for (const fleet of radiance)
      void fleet.client
        .cardHistory(Math.max(fleet.since, Date.now() / 1000 - 60), shutdown.signal)
        .then((history) => {
          if (!history || shutdown.signal.aborted) return;
          fleet.since = history.at.at(-1)!;
          logEvent("Radiance card utilisation", { worker: fleet.id, ...history });
        })
        .catch(() => {});
  }, 30_000).unref();
  return {
    controller,
    benchmarks,
    stop() {
      clearInterval(reconcile);
      shutdown.abort();
    },
  };
}

/** Mount after account middleware with the existing administrator requirement. */
export function registerRuntimeStatus(
  app: Express,
  runtime: Awaited<ReturnType<typeof loadRuntime>>,
  requireAdmin: RequestHandler,
  requestedBy: (request: Parameters<RequestHandler>[0]) => string,
) {
  if (runtime)
    app.use(
      "/api/runtime",
      requireAdmin,
      createRuntimeRouter(runtime.controller, runtime.benchmarks, requestedBy),
    );
}
