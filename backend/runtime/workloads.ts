import type { Workload } from "./controller.ts";
import type { KubernetesRequest } from "./kubernetes.ts";

type Environment = Record<string, string | undefined>;
type Item = Record<string, any>;
const kinds = ["image", "video", "text"];
/** The Deployment label that makes it a workload, and the prefix of its annotations. */
const prefix = "studio.excloo.dev/";

function required(environment: Environment, name: string) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function gpuPools(environment: Environment) {
  let pools: Record<string, number>;
  try {
    pools = JSON.parse(required(environment, "STUDIO_KUBERNETES_GPUS"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("STUDIO_KUBERNETES_GPUS is not valid JSON.");
    throw error;
  }
  for (const [pool, count] of Object.entries(pools))
    if (!Number.isInteger(count) || count < 1)
      throw new Error(`STUDIO_KUBERNETES_GPUS: ${pool} needs a whole number of GPUs.`);
  return pools;
}

async function list(request: KubernetesRequest, namespace: string, path: string) {
  const { status, body } = await request("GET", path);
  if (status !== 200)
    throw new Error(
      `Kubernetes returned HTTP ${status} for ${path}; Studio's runtime role in ${namespace} must allow listing it.`,
    );
  return ((body as Item).items ?? []) as Item[];
}

/**
 * The Deployments labelled `studio.excloo.dev/kind` in STUDIO_KUBERNETES_NAMESPACES, in namespace
 * then name order. Each states its pool (the node selector value naming a STUDIO_KUBERNETES_GPUS
 * pool), GPUs (its claim templates' exact counts) and address (the one Service selecting its pods);
 * annotations add the rest. Anything missing or ambiguous stops Studio with the deployment's name.
 */
export async function discoverWorkloads(environment: Environment, request: KubernetesRequest) {
  const pools = gpuPools(environment);
  const namespaces = required(environment, "STUDIO_KUBERNETES_NAMESPACES")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const found = await Promise.all(
    namespaces.map(async (namespace) => {
      const path = `/namespaces/${encodeURIComponent(namespace)}`;
      const [deployments, services, templates] = await Promise.all([
        list(
          request,
          namespace,
          `/apis/apps/v1${path}/deployments?labelSelector=${encodeURIComponent(`${prefix}kind`)}`,
        ),
        list(request, namespace, `/api/v1${path}/services`),
        list(request, namespace, `/apis/resource.k8s.io/v1${path}/resourceclaimtemplates`),
      ]);
      return deployments
        .map((item) => workload(environment, pools, namespace, item, services, templates))
        .sort((a, b) => a.id.localeCompare(b.id));
    }),
  );
  const workloads = found.flat();
  const ids = new Set<string>();
  for (const { id, namespace } of workloads) {
    if (ids.has(id))
      throw new Error(`Deployment ${namespace}/${id} shares its name with another workload.`);
    ids.add(id);
  }
  if (workloads.some((item) => item.kind === "text")) required(environment, "STUDIO_TEXT_KEY");
  return { pools, workloads };
}

function workload(
  environment: Environment,
  pools: Record<string, number>,
  namespace: string,
  deployment: Item,
  services: Item[],
  templates: Item[],
): Workload {
  const id: string = deployment.metadata.name;
  const problem = (detail: string) => new Error(`Deployment ${namespace}/${id} ${detail}.`);
  const kind = deployment.metadata.labels[`${prefix}kind`];
  if (!kinds.includes(kind)) throw problem(`needs ${prefix}kind image, video or text`);
  const annotation = (name: string): string | undefined =>
    deployment.metadata.annotations?.[`${prefix}${name}`];
  const pod = deployment.spec.template;
  const named = Object.values((pod.spec.nodeSelector ?? {}) as Record<string, string>).filter(
    (value) => value in pools,
  );
  if (named.length !== 1)
    throw problem("needs a node selector value naming one STUDIO_KUBERNETES_GPUS pool");
  const [pool] = named;
  let gpus = 0;
  for (const claim of pod.spec.resourceClaims ?? []) {
    const template = templates.find(
      (item) => item.metadata.name === claim.resourceClaimTemplateName,
    );
    if (!template) throw problem(`claims ${claim.name} without a resource claim template`);
    for (const device of template.spec.spec.devices?.requests ?? []) {
      if (!device.exactly || device.exactly.allocationMode === "All")
        throw problem(`claims ${claim.name} without an exact device count`);
      gpus += device.exactly.count ?? 1;
    }
  }
  if (gpus < 1 || gpus > pools[pool])
    throw problem(`claims ${gpus} GPUs; the ${pool} pool has ${pools[pool]}`);
  const labels = (pod.metadata?.labels ?? {}) as Record<string, string>;
  const selecting = services.filter((service) => {
    const selector = Object.entries((service.spec.selector ?? {}) as Record<string, string>);
    return selector.length && selector.every(([key, value]) => labels[key] === value);
  });
  if (selecting.length !== 1)
    throw problem(`needs one Service selecting its pods, not ${selecting.length}`);
  const [service] = selecting;
  if (!service.spec.ports?.length || !service.spec.clusterIP || service.spec.clusterIP === "None")
    throw problem(`needs Service ${service.metadata.name} to have a cluster IP and a port`);
  const capabilities = annotation("capabilities")
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    id,
    label: annotation("label") || id,
    kind,
    namespace,
    deployment: id,
    pool,
    gpus,
    url: `http://${service.spec.clusterIP}:${service.spec.ports[0].port}`,
    ...(kind === "text"
      ? {
          model: required(environment, "STUDIO_LOCAL_TEXT_MODEL"),
          ...(annotation("vision") === "true" ? { vision: true } : {}),
        }
      : {}),
    ...(annotation("worker") ? { worker: annotation("worker") } : {}),
    ...(capabilities?.length ? { capabilities } : {}),
  };
}
