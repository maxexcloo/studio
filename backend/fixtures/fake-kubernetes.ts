import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { KubernetesRequest } from "../runtime/kubernetes.ts";

/** The address Studio derives for a fake workload's Service: its name, namespace and `url`'s port. */
export const serviceUrl = (namespace: string, name: string, url: string) =>
  `http://${name}.${namespace}.svc.cluster.local:${new URL(url).port}`;
/** Node options for a forked Studio that resolve those addresses to this machine (cluster-dns.ts). */
export const clusterDns = ["--import", fileURLToPath(new URL("./cluster-dns.ts", import.meta.url))];

interface Pod {
  name: string;
  ready: boolean;
  deleting: boolean;
  /** Container restarts; a restarted pod's log is its previous container's until it logs again. */
  restarts: number;
}
/** A workload Studio discovers: its kind label, pool, GPU count, Service address and annotations. */
interface Discovered {
  kind: string;
  pool: string;
  gpus: number;
  url: string;
  annotations?: Record<string, string>;
}
interface Deployment {
  namespace: string;
  name: string;
  replicas: number;
  pods: Pod[];
  workload?: Discovered;
  /** An unschedulable reason that keeps new pods Pending, as a missing GPU does. */
  unschedulable?: string;
}

/**
 * A fake Kubernetes API for the deployments and pods Studio reads and the scale subresource it
 * patches. Deployments given a `workload` are listed for discovery with a Service on its `url`'s
 * port (serviceUrl) and a `gpu-<count>` claim template. Time moves in ticks: a tick removes terminating pods, readies pending ones and creates
 * pods for missing replicas. `log` records every scale and every pod that went away, in order.
 * A ready pod's container logs `started` and `ready`; one given restarts has logged nothing since
 * and its previous container `crashed`. `denied` namespaces refuse everything and `logsDenied`
 * ones only pod logs, as a role without `pods/log` does.
 */
export function fakeKubernetes(
  initial: { namespace: string; name: string; replicas?: number; workload?: Discovered }[],
  { tickOnRead = false, onChange = (_name: string, _ready: boolean) => {} } = {},
) {
  const deployments = new Map<string, Deployment>();
  const log: string[] = [];
  const denied = new Set<string>();
  const logsDenied = new Set<string>();
  let counter = 0;
  const pod = (deployment: Deployment, ready: boolean): Pod => ({
    name: `${deployment.name}-${++counter}`,
    ready,
    deleting: false,
    restarts: 0,
  });
  for (const { namespace, name, replicas = 0, workload } of initial) {
    const deployment: Deployment = { namespace, name, replicas, pods: [], workload };
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
    const listed = discovery(url.pathname);
    if (listed) return listed;
    const podLog = /^\/api\/v1\/namespaces\/([^/]+)\/pods\/([^/]+)\/log$/.exec(url.pathname);
    if (podLog) {
      const [, namespace, name] = podLog;
      if (denied.has(namespace) || logsDenied.has(namespace))
        return { status: 403, body: { message: "forbidden" } };
      const item = [...deployments.values()]
        .filter((deployment) => deployment.namespace === namespace)
        .flatMap((deployment) => deployment.pods)
        .find((entry) => entry.name === name);
      if (!item) return { status: 404, body: {} };
      const previous = url.searchParams.get("previous") === "true";
      if (previous ? !item.restarts : !item.ready)
        return { status: 400, body: { message: "container is waiting to start" } };
      const lines = previous
        ? [`2026-10-27T00:00:00.000000000Z ${name} crashed`]
        : item.restarts
          ? []
          : [
              `2026-10-27T00:00:00.000000000Z ${name} started`,
              `2026-10-27T00:00:01.000000000Z ${name} ready`,
            ];
      const tail = lines.slice(-Number(url.searchParams.get("tailLines")));
      return { status: 200, body: tail.map((line) => `${line}\n`).join("") };
    }
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
            spec: { containers: [{ name: "main" }, { name: "sidecar" }] },
            status: item.ready
              ? {
                  phase: "Running",
                  containerStatuses: [{ name: "main", restartCount: item.restarts }],
                }
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
  /** The discovery lists: labelled deployments, their Services and claim templates. */
  function discovery(pathname: string) {
    const match =
      /^\/apis?\/(?:apps\/v1|v1|resource\.k8s\.io\/v1)\/namespaces\/([^/]+)\/(deployments|services|resourceclaimtemplates)$/.exec(
        pathname,
      );
    if (!match) return;
    const [, namespace, resource] = match;
    if (denied.has(namespace)) return { status: 403, body: { message: "forbidden" } };
    const listed = [...deployments.values()].filter(
      (item) => item.namespace === namespace && item.workload,
    );
    const items = listed.map(({ name, workload }) => {
      const { kind, pool, gpus, url, annotations } = workload!;
      return {
        deployments: {
          metadata: { name, labels: { "studio.excloo.dev/kind": kind }, annotations },
          spec: {
            template: {
              metadata: { labels: { app: name } },
              spec: {
                nodeSelector: { "node.example/pool": pool },
                resourceClaims: [{ name: "gpu", resourceClaimTemplateName: `gpu-${gpus}` }],
              },
            },
          },
        },
        services: {
          metadata: { name },
          spec: {
            selector: { app: name },
            ports: [{ port: Number(new URL(url).port) }],
          },
        },
        resourceclaimtemplates: {
          metadata: { name: `gpu-${gpus}` },
          spec: { spec: { devices: { requests: [{ name: "gpu", exactly: { count: gpus } }] } } },
        },
      }[resource];
    });
    return { status: 200, body: { items } };
  }
  /** The same API over HTTP, for a Studio process given STUDIO_KUBERNETES_URL. */
  async function handle(incoming: IncomingMessage, response: ServerResponse) {
    let text = "";
    for await (const chunk of incoming) text += chunk;
    const answer = await request(
      incoming.method as "GET" | "PATCH",
      incoming.url ?? "/",
      text ? JSON.parse(text) : undefined,
    );
    const plain = typeof answer.body === "string";
    response.writeHead(answer.status, {
      "content-type": plain ? "text/plain" : "application/json",
    });
    response.end(plain ? answer.body : JSON.stringify(answer.body));
  }
  return { request, handle, tick, log, deployments, denied, logsDenied };
}
