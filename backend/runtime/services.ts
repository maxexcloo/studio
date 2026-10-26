import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
interface Workload {
  kind: ServiceKind;
  label?: string;
  placements?: string[];
  service?: { url?: string; display_label?: string };
  studio?: { url: string; apiKeyEnv?: string };
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
  function workloads(): Record<string, Workload> {
    if (!environment.STUDIO_CONFIG_DIR) return {};
    const file = join(environment.STUDIO_CONFIG_DIR, "workloads.json");
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  }
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
    let records: Record<string, Workload> = {};
    let configurationError = false;
    try {
      records = workloads();
    } catch {
      configurationError = true;
    }
    const services: ServicesStatus["services"] = {};
    await Promise.all(
      allowed.map(async (kind) => {
        const configured = Object.entries(records).filter(([, record]) => record.kind === kind);
        const targets =
          kind === "text"
            ? configured.map(([id, record]) => ({
                id,
                label: record.service?.display_label || record.label || id,
                url: record.studio?.url || record.service?.url || "",
                workloadId: id,
                placements: record.placements,
                apiKeyEnv: record.studio?.apiKeyEnv,
              }))
            : workers()
                .filter((worker) => worker.capabilities.includes(kind))
                .map((worker) => {
                  const match = configured.find(
                    ([, record]) =>
                      (record.studio?.url || record.service?.url || "").replace(/\/+$/, "") ===
                      worker.url.replace(/\/+$/, ""),
                  );
                  return {
                    id: worker.id,
                    label: worker.name,
                    url: worker.url,
                    workloadId: match?.[0],
                    placements: match?.[1].placements,
                    apiKeyEnv: match?.[1].studio?.apiKeyEnv,
                  };
                });
        const endpoints = await Promise.all(
          targets.map(async ({ url, apiKeyEnv, ...target }): Promise<ServiceEndpoint> => {
            let endpoint: string | undefined;
            try {
              endpoint = url
                ? directAddress(url, kind === "text" ? "health" : "system_stats")
                : undefined;
              const gateway = environment.STUDIO_CHAT_GATEWAY_URL || environment.BIFROST_URL;
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
            const observed: Probe = endpoint
              ? { ...(await probe(endpoint, kind, apiKeyEnv)) }
              : {
                  state: "unknown",
                  reason: "No direct runtime health endpoint is configured for this workload.",
                };
            if (observed.state === "offline" && waitingWorkers.includes(target.id)) {
              observed.state = "waiting";
              observed.reason = "Your accepted work is waiting for this worker to become ready.";
            }
            return { ...target, ...observed, ...(administrator && endpoint ? { endpoint } : {}) };
          }),
        );
        const bound = endpoints.filter((endpoint) => endpoint.checkedAt);
        const state: ServiceStatus["state"] = bound.some((endpoint) => endpoint.state === "healthy")
          ? "healthy"
          : bound.some((endpoint) => endpoint.state === "waiting")
            ? "waiting"
            : !bound.length || bound.some((endpoint) => endpoint.state === "unknown")
              ? "unknown"
              : "offline";
        services[kind] = {
          state,
          endpoints,
          reason: !endpoints.length
            ? configurationError
              ? "Mounted workload definitions could not be read."
              : `No direct ${kind} runtime endpoint is configured.`
            : state === "healthy"
              ? "A direct runtime is healthy."
              : state === "waiting"
                ? "Waiting for the selected runtime."
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
          ? "Studio runtime control is not configured. Existing AI Control retains ownership; active workload and GPU placement are not observed."
          : controller.automaticLifecycle
            ? "Studio automatic lifecycle control is enabled."
            : "Studio automatic lifecycle control is disabled; existing runtime ownership is unchanged.",
      },
    };
  };
}
