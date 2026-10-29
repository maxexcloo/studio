import type { Workload } from "./controller.ts";

type Environment = Record<string, string | undefined>;
const kinds = ["image", "video", "text"];

export function required(environment: Environment, name: string) {
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
export function kubernetesWorkloads(environment: Environment) {
  const pools = json(environment, "STUDIO_KUBERNETES_GPUS") as Record<string, number>;
  for (const [pool, count] of Object.entries(pools))
    if (!Number.isInteger(count) || count < 1)
      throw new Error(`STUDIO_KUBERNETES_GPUS: ${pool} needs a whole number of GPUs.`);
  const records = json(environment, "STUDIO_KUBERNETES_WORKLOADS") as Record<
    string,
    Partial<Workload>
  >;
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
    if (record.kind === "text" && !record.model?.includes("/"))
      throw problem("needs the Bifrost model it serves, such as local/auto");
    if (record.apiKeyEnv) required(environment, record.apiKeyEnv);
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
      ...(record.kind === "text" ? { model: record.model } : {}),
      ...(record.kind === "text" && record.vision === true ? { vision: true } : {}),
      ...(record.worker ? { worker: record.worker } : {}),
      ...(record.capabilities ? { capabilities: record.capabilities } : {}),
    };
  });
  return { pools, workloads };
}
