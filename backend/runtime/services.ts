import type {
  ServiceEndpoint,
  ServiceKind,
  ServiceStatus,
  ServicesStatus,
} from "../../shared/services.ts";
import type { RuntimeController } from "./controller.ts";

interface Worker {
  id: string;
  name: string;
  url: string;
  capabilities: string[];
}
type Environment = Record<string, string | undefined>;
type Probe = Pick<
  ServiceEndpoint,
  | "state"
  | "reason"
  | "checkedAt"
  | "device"
  | "version"
  | "memoryTotal"
  | "memoryFree"
  | "loadedModel"
>;
interface Options {
  workers: () => Worker[];
  controller?: RuntimeController;
  environment?: Environment;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  cacheMs?: number;
}

function directAddress(value: string, path: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return;
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${path}`;
  return url.href;
}

/**
 * Whether the running text model reads images: every text workload scaled up must say so on its
 * `/props` (Radiance and llama.cpp report `modalities.vision` there), and at least one must run.
 * Anything unclear counts as text-only. The answer is cached briefly, so a switch shows soon.
 */
export function createTextVision({
  controller,
  environment = process.env,
  fetchImpl = fetch,
  now = Date.now,
  cacheMs = 30_000,
}: Pick<Options, "environment" | "fetchImpl" | "now" | "cacheMs"> & {
  controller: RuntimeController;
}) {
  let cached: { until: number; result: Promise<boolean> } | undefined;
  const reads = async ({ url, apiKeyEnv }: { url: string; apiKeyEnv?: string }) => {
    const response = await fetchImpl(directAddress(url, "props")!, {
      headers: apiKeyEnv ? { Authorization: `Bearer ${environment[apiKeyEnv]}` } : {},
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return false;
    }
    return (await response.json())?.modalities?.vision === true;
  };
  return () => {
    if (cached && cached.until > now()) return cached.result;
    const result = controller
      .running("text")
      .then(
        async (running) =>
          running.length > 0 && (await Promise.all(running.map(reads))).every(Boolean),
      )
      .catch(() => false);
    cached = { until: now() + cacheMs, result };
    return result;
  };
}

const sameUrl = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

/** The media workers every Studio workload behind which is parked; a worker Studio doesn't manage never is. */
export async function parkedWorkers(controller: RuntimeController | undefined, workers: Worker[]) {
  if (!controller) return new Set<string>();
  const parked = await controller.parked();
  return new Set(
    workers
      .filter((worker) => {
        const serving = controller.workloads.filter(
          (workload) => workload.kind !== "text" && sameUrl(workload.url, worker.url),
        );
        return serving.length > 0 && serving.every((workload) => parked.has(workload.id));
      })
      .map((worker) => worker.id),
  );
}

/** Observe the direct runtimes only. This never starts, stops or acquires a workload. */
export function createServicesObserver({
  workers,
  controller,
  environment = process.env,
  fetchImpl = fetch,
  now = Date.now,
  timeoutMs = 1500,
  cacheMs = 5000,
}: Options) {
  const cache = new Map<string, { until: number; result: Promise<Probe> }>();
  const managed = controller?.workloads ?? [];
  function probe(endpoint: string, kind: ServiceKind, apiKeyEnv?: string): Promise<Probe> {
    for (const [key, entry] of cache) if (entry.until <= now()) cache.delete(key);
    const key = `${kind}:${endpoint}:${apiKeyEnv || ""}`;
    const previous = cache.get(key);
    if (previous && previous.until > now()) return previous.result;
    const result = (async (): Promise<Probe> => {
      const checkedAt = new Date(now()).toISOString();
      if (apiKeyEnv && !environment[apiKeyEnv])
        return {
          state: "unknown",
          reason: "The direct health credential is not configured.",
          checkedAt,
        };
      try {
        const response = await fetchImpl(endpoint, {
          method: "GET",
          headers: apiKeyEnv ? { Authorization: `Bearer ${environment[apiKeyEnv]}` } : {},
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
          await response.body?.cancel();
          return {
            state: response.status === 401 || response.status === 403 ? "unknown" : "offline",
            reason:
              response.status === 401 || response.status === 403
                ? "The direct health endpoint requires server-side authentication."
                : `Direct health check returned HTTP ${response.status}.`,
            checkedAt,
          };
        }
        if (kind === "text") {
          await response.body?.cancel();
          return {
            state: "healthy",
            reason: "The direct text runtime health endpoint is ready.",
            checkedAt,
          };
        }
        const stats = await response.json();
        if (!stats?.system || !Array.isArray(stats?.devices))
          return {
            state: "unknown",
            reason: "The worker returned an unrecognised health response.",
            checkedAt,
          };
        const device = stats.devices[0];
        return {
          state: "healthy",
          reason: "The direct media worker is ready.",
          checkedAt,
          ...(typeof device?.name === "string" ? { device: device.name } : {}),
          ...(typeof stats.system.comfyui_version === "string"
            ? { version: stats.system.comfyui_version }
            : {}),
          ...(Number.isFinite(device?.vram_total) ? { memoryTotal: device.vram_total } : {}),
          ...(Number.isFinite(device?.vram_free) ? { memoryFree: device.vram_free } : {}),
        };
      } catch (error) {
        const timedOut =
          error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
        const unreadable = error instanceof SyntaxError;
        return {
          state: timedOut || unreadable ? "unknown" : "offline",
          reason: timedOut
            ? "The direct health check timed out; readiness is unknown."
            : unreadable
              ? "The worker returned an unrecognised health response."
              : "The direct runtime could not be reached.",
          checkedAt,
        };
      }
    })();
    cache.set(key, { until: now() + cacheMs, result });
    return result;
  }
  return async ({
    allowed,
    administrator = false,
    waitingWorkers = [],
  }: {
    allowed: ServiceKind[];
    administrator?: boolean;
    waitingWorkers?: string[];
  }): Promise<ServicesStatus> => {
    const services: ServicesStatus["services"] = {};
    const parked = (await controller?.parked()) ?? new Set<string>();
    await Promise.all(
      allowed.map(async (kind) => {
        // Text endpoints are the managed text deployments; media endpoints are the workers, matched to theirs by URL.
        const targets =
          kind === "text"
            ? managed
                .filter((workload) => workload.kind === "text")
                .map((workload) => ({
                  id: workload.id,
                  label: workload.label,
                  url: workload.url,
                  workloads: [workload.id],
                  apiKeyEnv: workload.apiKeyEnv,
                }))
            : workers()
                .filter((worker) => worker.capabilities.includes(kind))
                .map((worker) => {
                  // One- and two-GPU video deployments can serve one worker address.
                  const matches = managed.filter((workload) => sameUrl(workload.url, worker.url));
                  return {
                    id: worker.id,
                    label: worker.name,
                    url: worker.url,
                    ...(matches.length ? { workloads: matches.map((item) => item.id) } : {}),
                    apiKeyEnv: matches[0]?.apiKeyEnv,
                  };
                });
        const endpoints = await Promise.all(
          targets.map(async ({ url, apiKeyEnv, ...target }): Promise<ServiceEndpoint> => {
            let endpoint: string | undefined;
            try {
              endpoint = url
                ? directAddress(url, kind === "text" ? "health" : "system_stats")
                : undefined;
              const gateway = environment.STUDIO_CHAT_GATEWAY_URL || environment.STUDIO_BIFROST_URL;
              if (
                kind === "text" &&
                endpoint &&
                gateway &&
                new URL(endpoint).origin === new URL(gateway).origin
              )
                endpoint = undefined;
            } catch {
              endpoint = undefined;
            }
            // A parked worker has no pod to ask; probing it would only wait out the refusal.
            const observed: Probe = target.workloads?.every((id) => parked.has(id))
              ? {
                  state: "parked",
                  reason: "Parked: stopped on purpose. An administrator can start it.",
                  checkedAt: new Date(now()).toISOString(),
                }
              : endpoint
                ? { ...(await probe(endpoint, kind, apiKeyEnv)) }
                : {
                    state: "unknown",
                    reason: "No direct runtime health endpoint is configured for this workload.",
                  };
            if (observed.state === "offline" && waitingWorkers.includes(target.id)) {
              observed.state = "waiting";
              observed.reason = "Your accepted work is waiting for this worker to become ready.";
            }
            return {
              ...target,
              ...observed,
              ...(administrator && endpoint ? { endpoint } : {}),
            };
          }),
        );
        const bound = endpoints.filter((endpoint) => endpoint.checkedAt);
        // Parked endpoints are neither failures nor readiness: the service is parked only when all are.
        const active = bound.filter((endpoint) => endpoint.state !== "parked");
        const state: ServiceStatus["state"] = active.some(
          (endpoint) => endpoint.state === "healthy",
        )
          ? "healthy"
          : active.some((endpoint) => endpoint.state === "waiting")
            ? "waiting"
            : bound.length && !active.length
              ? "parked"
              : !active.length || active.some((endpoint) => endpoint.state === "unknown")
                ? "unknown"
                : "offline";
        services[kind] = {
          state,
          endpoints,
          reason: !endpoints.length
            ? `No direct ${kind} runtime endpoint is configured.`
            : state === "healthy"
              ? "A direct runtime is healthy."
              : state === "waiting"
                ? "Waiting for the selected runtime."
                : state === "parked"
                  ? "Parked: stopped on purpose. An administrator can start it."
                  : state === "offline"
                    ? "The direct runtime health checks are offline."
                    : "Runtime readiness is unknown; inspect the endpoint details.",
        };
      }),
    );
    return {
      services,
      runtime: {
        configured: Boolean(controller),
        automaticLifecycle: controller?.automaticLifecycle === true,
        reason: !controller
          ? "Studio runtime control is not configured; GPU workloads are neither observed nor switched."
          : controller.automaticLifecycle
            ? "Studio starts and stops GPU workloads as queued work needs them."
            : "Studio switches GPU workloads only when an administrator applies a placement.",
      },
    };
  };
}
