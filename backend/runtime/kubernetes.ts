import { existsSync, readFileSync } from "node:fs";
import https from "node:https";
import { RuntimeUnavailable } from "./controller.ts";

export interface Deployment {
  namespace: string;
  deployment: string;
}
/** What the cluster reports for one deployment and the pods its selector matches. */
export interface DeploymentState {
  replicas: number;
  ready: number;
  /** Pods that still exist, terminating ones included: they hold their GPU claims until gone. */
  pods: number;
  /** Why a pod is not ready yet, such as an unschedulable GPU claim or an image pull failure. */
  reason?: string;
}
export type KubernetesRequest = (
  method: "GET" | "PATCH",
  path: string,
  body?: unknown,
) => Promise<{ status: number; body: unknown }>;

const serviceAccount = "/var/run/secrets/kubernetes.io/serviceaccount";

/** In-cluster access with the pod's service account; the token is reread for each call as it rotates. */
export function inClusterRequest(
  environment: Record<string, string | undefined>,
  directory = serviceAccount,
): KubernetesRequest {
  const host = environment.KUBERNETES_SERVICE_HOST;
  if (!host || !existsSync(`${directory}/token`))
    throw new Error(
      "STUDIO_KUBERNETES_WORKLOADS needs Studio's in-cluster service account token (automountServiceAccountToken) or STUDIO_KUBERNETES_URL.",
    );
  const ca = readFileSync(`${directory}/ca.crt`);
  return (method, path, body) =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const request = https.request(
        {
          host,
          port: environment.KUBERNETES_SERVICE_PORT,
          path,
          method,
          ca,
          timeout: 15_000,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${readFileSync(`${directory}/token`, "utf8").trim()}`,
            ...(payload ? { "Content-Type": "application/merge-patch+json" } : {}),
          },
        },
        (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (text += chunk));
          response.on("end", () =>
            resolve({ status: response.statusCode ?? 0, body: parse(text) }),
          );
          response.on("error", reject);
        },
      );
      request.on("timeout", () => request.destroy(new Error("timeout")));
      request.on("error", reject);
      request.end(payload);
    });
}

/** A plain HTTP API address, such as `kubectl proxy` during local development. */
export function urlRequest(base: string, fetchImpl: typeof fetch = fetch): KubernetesRequest {
  const root = base.replace(/\/+$/, "");
  return async (method, path, body) => {
    const response = await fetchImpl(`${root}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/merge-patch+json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    return { status: response.status, body: parse(await response.text()) };
  };
}

function parse(text: string) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

interface Pod {
  metadata?: { deletionTimestamp?: string };
  status?: {
    phase?: string;
    conditions?: {
      type: string;
      status: string;
      reason?: string;
      message?: string;
    }[];
    containerStatuses?: {
      state?: { waiting?: { reason?: string; message?: string } };
    }[];
  };
}
const brief = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 240);

/** The first reason a pod is not running yet, in the words Kubernetes gives. */
function podReason(pod: Pod) {
  if (pod.metadata?.deletionTimestamp) return "Stopping.";
  const unscheduled = pod.status?.conditions?.find(
    (condition) => condition.type === "PodScheduled" && condition.status === "False",
  );
  if (unscheduled)
    return brief(
      `Waiting for a GPU: ${unscheduled.message || unscheduled.reason || "not scheduled yet"}`,
    );
  const waiting = pod.status?.containerStatuses?.find((status) => status.state?.waiting)?.state
    ?.waiting;
  if (waiting?.reason && waiting.reason !== "ContainerCreating")
    return brief(`${waiting.reason}${waiting.message ? `: ${waiting.message}` : ""}`);
  return pod.status?.phase === "Running" ? "Loading." : "Starting.";
}

/** Reads and scales only the configured deployments; Studio never discovers or adopts others. */
export class KubernetesEngine {
  private request: KubernetesRequest;

  constructor(request: KubernetesRequest) {
    this.request = request;
  }

  private async call(target: Deployment, method: "GET" | "PATCH", path: string, body?: unknown) {
    let response: Awaited<ReturnType<KubernetesRequest>>;
    try {
      response = await this.request(method, path, body);
    } catch {
      throw new RuntimeUnavailable("The Kubernetes API is unavailable.");
    }
    const where = `${target.namespace}/${target.deployment}`;
    if (response.status === 401)
      throw new RuntimeUnavailable("Kubernetes refused Studio's service account token.");
    if (response.status === 403)
      throw new RuntimeUnavailable(
        `Studio's service account may not ${method === "GET" ? "read" : "scale"} ${where}; apply Studio's runtime role in ${target.namespace}.`,
      );
    if (response.status === 404)
      throw new RuntimeUnavailable(`Kubernetes has no deployment ${where}.`);
    if (response.status < 200 || response.status >= 300)
      throw new RuntimeUnavailable(`Kubernetes returned HTTP ${response.status} for ${where}.`);
    return response.body as Record<string, any>;
  }

  async state(target: Deployment): Promise<DeploymentState> {
    const namespace = encodeURIComponent(target.namespace);
    const deployment = await this.call(
      target,
      "GET",
      `/apis/apps/v1/namespaces/${namespace}/deployments/${encodeURIComponent(target.deployment)}`,
    );
    const labels = Object.entries(
      (deployment.spec?.selector?.matchLabels ?? {}) as Record<string, string>,
    );
    if (!labels.length)
      throw new RuntimeUnavailable(
        `Deployment ${target.namespace}/${target.deployment} has no label selector.`,
      );
    const selector = encodeURIComponent(labels.map(([key, value]) => `${key}=${value}`).join(","));
    const pods = ((
      await this.call(
        target,
        "GET",
        `/api/v1/namespaces/${namespace}/pods?labelSelector=${selector}`,
      )
    ).items ?? []) as Pod[];
    const replicas = Number(deployment.spec?.replicas ?? 0);
    const ready = Number(deployment.status?.readyReplicas ?? 0);
    const waiting = replicas > ready || pods.some((pod) => pod.metadata?.deletionTimestamp);
    const pod = pods.find((item) => !item.metadata?.deletionTimestamp) ?? pods[0];
    const reason = waiting && pod ? podReason(pod) : undefined;
    return {
      replicas,
      ready,
      pods: pods.length,
      ...(reason ? { reason } : {}),
    };
  }

  async scale(target: Deployment, replicas: number) {
    await this.call(
      target,
      "PATCH",
      `/apis/apps/v1/namespaces/${encodeURIComponent(target.namespace)}/deployments/${encodeURIComponent(target.deployment)}/scale`,
      { spec: { replicas } },
    );
  }
}
