import type { IncomingMessage, ServerResponse } from "node:http";
import type { KubernetesRequest } from "../runtime/kubernetes.ts";

interface Pod {
  name: string;
  ready: boolean;
  deleting: boolean;
}
interface Deployment {
  namespace: string;
  name: string;
  replicas: number;
  pods: Pod[];
  /** An unschedulable reason that keeps new pods Pending, as a missing GPU does. */
  unschedulable?: string;
}

/**
 * A fake Kubernetes API for the deployments and pods Studio reads and the scale subresource it
 * patches. Time moves in ticks: a tick removes terminating pods, readies pending ones and creates
 * pods for missing replicas. `log` records every scale and every pod that went away, in order.
 */
export function fakeKubernetes(
  initial: { namespace: string; name: string; replicas?: number }[],
  { tickOnRead = false, onChange = (_name: string, _ready: boolean) => {} } = {},
) {
  const deployments = new Map<string, Deployment>();
  const log: string[] = [];
  const denied = new Set<string>();
  let counter = 0;
  const pod = (deployment: Deployment, ready: boolean): Pod => ({
    name: `${deployment.name}-${++counter}`,
    ready,
    deleting: false,
  });
  for (const { namespace, name, replicas = 0 } of initial) {
    const deployment: Deployment = { namespace, name, replicas, pods: [] };
    for (let index = 0; index < replicas; index++) deployment.pods.push(pod(deployment, true));
    deployments.set(`${namespace}/${name}`, deployment);
  }
  const ready = (deployment: Deployment) =>
    deployment.pods.filter((item) => item.ready && !item.deleting).length;
  function tick() {
    for (const deployment of deployments.values()) {
      const before = ready(deployment) > 0;
      for (const _ of deployment.pods.filter((entry) => entry.deleting))
        log.push(`gone ${deployment.namespace}/${deployment.name}`);
      deployment.pods = deployment.pods.filter((entry) => !entry.deleting);
      if (!deployment.unschedulable) for (const item of deployment.pods) item.ready = true;
      while (deployment.pods.length < deployment.replicas)
        deployment.pods.push(pod(deployment, false));
      if (before !== ready(deployment) > 0) onChange(deployment.name, ready(deployment) > 0);
    }
  }
  const request: KubernetesRequest = async (method, path, body) => {
    const url = new URL(path, "http://kubernetes.invalid");
    const pods = /^\/api\/v1\/namespaces\/([^/]+)\/pods$/.exec(url.pathname);
    const match = /^\/apis\/apps\/v1\/namespaces\/([^/]+)\/deployments\/([^/]+)(\/scale)?$/.exec(
      url.pathname,
    );
    const namespace = (pods || match)?.[1];
    if (!namespace) return { status: 404, body: {} };
    if (denied.has(namespace)) return { status: 403, body: { message: "forbidden" } };
    if (pods) {
      const selected = url.searchParams.get("labelSelector")?.replace(/^app=/, "");
      const deployment = deployments.get(`${namespace}/${selected}`);
      return {
        status: 200,
        body: {
          items: (deployment?.pods ?? []).map((item) => ({
            metadata: {
              name: item.name,
              ...(item.deleting ? { deletionTimestamp: "2026-10-27T00:00:00Z" } : {}),
            },
            status: item.ready
              ? { phase: "Running" }
              : deployment?.unschedulable
                ? {
                    phase: "Pending",
                    conditions: [
                      {
                        type: "PodScheduled",
                        status: "False",
                        reason: "Unschedulable",
                        message: deployment.unschedulable,
                      },
                    ],
                  }
                : { phase: "Pending" },
          })),
        },
      };
    }
    const [, , name, scale] = match!;
    const deployment = deployments.get(`${namespace}/${name}`);
    if (!deployment) return { status: 404, body: {} };
    if (method === "PATCH" && scale) {
      const replicas = (body as { spec: { replicas: number } }).spec.replicas;
      log.push(`scale ${namespace}/${name} ${replicas}`);
      deployment.replicas = replicas;
      for (const item of deployment.pods.slice(replicas)) item.deleting = true;
      return { status: 200, body: { spec: { replicas } } };
    }
    if (tickOnRead) tick();
    return {
      status: 200,
      body: {
        spec: { replicas: deployment.replicas, selector: { matchLabels: { app: name } } },
        status: { readyReplicas: ready(deployment) },
      },
    };
  };
  /** The same API over HTTP, for a Studio process given STUDIO_KUBERNETES_URL. */
  async function handle(incoming: IncomingMessage, response: ServerResponse) {
    let text = "";
    for await (const chunk of incoming) text += chunk;
    const answer = await request(
      incoming.method as "GET" | "PATCH",
      incoming.url ?? "/",
      text ? JSON.parse(text) : undefined,
    );
    response.writeHead(answer.status, { "content-type": "application/json" });
    response.end(JSON.stringify(answer.body));
  }
  return { request, handle, tick, log, deployments, denied };
}
