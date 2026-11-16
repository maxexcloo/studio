import { randomBytes } from "node:crypto";

import type {
  BenchmarkRun,
  BenchmarkStatus,
  BenchmarkSummary,
  RuntimePodLog,
} from "../../shared/runtime.ts";
import {
  RuntimeConflict,
  RuntimeRequestError,
  RuntimeUnavailable,
  type Workload,
  memoryStore,
} from "./controller.ts";
import type { KubernetesRequest } from "./kubernetes.ts";

type Environment = Record<string, string | undefined>;
interface BenchmarkStore {
  read(): BenchmarkRun[] | undefined;
  write(runs: BenchmarkRun[]): void;
}

/** Starts the line the Job prints its summary on, last, after BetterBench's own output. */
const marker = "STUDIO-BENCHMARK ";
const historyLimit = 50;
/** The pods the Job runs, which the models' network policy admits. */
const podLabel = "betterbench";

/**
 * BetterBench's quick run against the endpoint and model it is given, then its report's headline
 * figures (the HTML report's tiles) on one JSON line after `marker`, computed by its own report code.
 */
const script = `import json, sys
from betterbench.cli import main
from betterbench.report import combined_score, concurrency_rows, prefill_rows
main(["run", "--endpoint", sys.argv[1], "--model", sys.argv[2], "--quick", "--no-html", "--out", "/data/results.json"])
results = json.load(open("/data/results.json"))
combined = combined_score(results) or {}
levels = concurrency_rows(results)
depths = [row for row in prefill_rows(results) if not row["skipped"]]
print(${JSON.stringify(marker)} + json.dumps({
    "version": results["betterbench_version"],
    "decode": combined.get("decode"),
    "ttftMs": combined.get("ttft_p50"),
    "aggregate": {"level": levels[-1]["level"], "tps": levels[-1]["aggregate_tps"]} if levels else None,
    "prefill": {"depth": depths[-1]["target_depth"], "tps": depths[-1]["pp_med"]} if depths else None,
}))
`;

/**
 * The Job that benchmarks one text workload from inside its namespace. The endpoint key comes from
 * the namespace's `secret` (its `API_KEY`, as the models read it), so Studio never handles it.
 */
export function benchmarkJob({
  name,
  workload,
  model,
  image,
  secret,
}: {
  name: string;
  workload: Workload;
  model: string;
  image: string;
  secret: string;
}) {
  const labels = { "app.kubernetes.io/name": podLabel, "studio.excloo.dev/benchmark": workload.id };
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name, namespace: workload.namespace, labels },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: 2 * 60 * 60,
      ttlSecondsAfterFinished: 24 * 60 * 60,
      template: {
        metadata: { labels },
        spec: {
          restartPolicy: "Never",
          automountServiceAccountToken: false,
          securityContext: {
            // The image's user by number, as runAsNonRoot can't check a named one.
            runAsUser: 1000,
            runAsNonRoot: true,
            seccompProfile: { type: "RuntimeDefault" },
          },
          containers: [
            {
              name: podLabel,
              image,
              command: ["python", "-c", script, `${workload.url}/v1`, model],
              env: [
                {
                  name: "BETTERBENCH_API_KEY",
                  valueFrom: { secretKeyRef: { name: secret, key: "API_KEY" } },
                },
              ],
              resources: { requests: { cpu: "100m", memory: "256Mi" }, limits: { memory: "1Gi" } },
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { drop: ["ALL"] },
              },
            },
          ],
        },
      },
    },
  };
}

const figure = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** The summary the Job printed last, or undefined when its log has none. */
export function parseBenchmarkLog(text: string): BenchmarkSummary | undefined {
  const line = text
    .split("\n")
    .reverse()
    .find((item) => item.startsWith(marker));
  if (!line) return undefined;
  let raw: Record<string, any>;
  try {
    raw = JSON.parse(line.slice(marker.length));
  } catch {
    return undefined;
  }
  return {
    version: String(raw.version ?? ""),
    decode: figure(raw.decode),
    ttftMs: figure(raw.ttftMs),
    aggregate:
      raw.aggregate && figure(raw.aggregate.tps) !== null
        ? { level: Number(raw.aggregate.level), tps: raw.aggregate.tps }
        : null,
    prefill:
      raw.prefill && figure(raw.prefill.tps) !== null
        ? { depth: Number(raw.prefill.depth), tps: raw.prefill.tps }
        : null,
  };
}

const brief = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 240);

/**
 * Benchmarks Studio's local text workloads one at a time with a BetterBench Job, which runs beside
 * the model's ordinary work, and keeps the past runs. Without STUDIO_BENCHMARK_IMAGE there are none.
 */
export class Benchmarks {
  readonly configured: boolean;
  private runs: BenchmarkRun[];
  /** Holds the one run's place while its model is checked, before the run exists. */
  private starting = false;
  private polling?: NodeJS.Timeout;
  private options: {
    request: KubernetesRequest;
    workloads: Workload[];
    environment: Environment;
    store?: BenchmarkStore;
    fetchImpl?: typeof fetch;
    now?: () => number;
    pollMs?: number;
  };

  constructor(options: Benchmarks["options"]) {
    this.options = options;
    const { environment } = options;
    this.configured = Boolean(environment.STUDIO_BENCHMARK_IMAGE);
    if (this.configured && !environment.STUDIO_BENCHMARK_SECRET)
      throw new Error("STUDIO_BENCHMARK_SECRET is required with STUDIO_BENCHMARK_IMAGE.");
    this.options.store ??= memoryStore<BenchmarkRun[]>();
    this.runs = this.options.store.read() ?? [];
    // A Job outlives a Studio restart: keep following the one that was running.
    if (this.runs.some((run) => run.status === "running")) this.follow();
  }

  list(): BenchmarkStatus {
    return { configured: this.configured, runs: this.runs };
  }

  private get now() {
    return new Date((this.options.now ?? Date.now)()).toISOString();
  }
  private save() {
    this.runs = this.runs.slice(0, historyLimit);
    this.options.store!.write(this.runs);
  }
  /** The run's Job, while its workload is still configured. */
  private jobFor(run: BenchmarkRun) {
    const workload = this.options.workloads.find((item) => item.id === run.workload);
    return (
      workload && {
        name: `studio-benchmark-${run.id}`,
        namespace: encodeURIComponent(workload.namespace),
      }
    );
  }

  private async call(method: "GET" | "POST" | "DELETE", path: string, body?: unknown) {
    try {
      return await this.options.request(method, path, body);
    } catch {
      throw new RuntimeUnavailable("The Kubernetes API is unavailable.");
    }
  }

  /** The model the workload's server reports; it answers only while the workload runs. */
  private async servedModel(workload: Workload) {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    try {
      const response = await fetchImpl(`${workload.url}/v1/models`, {
        headers: { Authorization: `Bearer ${this.options.environment.STUDIO_TEXT_KEY}` },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      const id = response.ok ? (await response.json())?.data?.[0]?.id : undefined;
      if (typeof id === "string" && id) return id;
    } catch {}
    throw new RuntimeConflict(`${workload.label} isn't answering: start it first.`);
  }

  async start(id: string, requestedBy: string) {
    if (!this.configured) throw new RuntimeRequestError("Benchmarks need STUDIO_BENCHMARK_IMAGE.");
    const workload = this.options.workloads.find((item) => item.id === id && item.kind === "text");
    if (!workload) throw new RuntimeRequestError("workload must be a local text workload.");
    if (this.starting || this.runs.some((run) => run.status === "running"))
      throw new RuntimeConflict("A benchmark is already running.");
    this.starting = true;
    try {
      return await this.create(workload, requestedBy);
    } finally {
      this.starting = false;
    }
  }

  private async create(workload: Workload, requestedBy: string) {
    const model = await this.servedModel(workload);
    const run: BenchmarkRun = {
      // Short and lower-case: it names the Job.
      id: randomBytes(4).toString("hex"),
      workload: workload.id,
      label: workload.label,
      model,
      status: "running",
      requestedBy,
      startedAt: this.now,
    };
    const job = this.jobFor(run)!;
    const response = await this.call(
      "POST",
      `/apis/batch/v1/namespaces/${job.namespace}/jobs`,
      benchmarkJob({
        name: job.name,
        workload,
        model,
        image: this.options.environment.STUDIO_BENCHMARK_IMAGE!,
        secret: this.options.environment.STUDIO_BENCHMARK_SECRET!,
      }),
    );
    if (response.status === 403)
      throw new RuntimeUnavailable(
        `Studio's service account may not create Jobs in ${workload.namespace}; apply its benchmark role there.`,
      );
    if (response.status < 200 || response.status >= 300)
      throw new RuntimeUnavailable(`Kubernetes returned HTTP ${response.status} for the Job.`);
    this.runs.unshift(run);
    this.save();
    this.follow();
    return run;
  }

  /** Deletes the running Job and its pod, unless it has just ended; the run reads Stopped. */
  async stop(id: string) {
    const run = this.runs.find((item) => item.id === id);
    if (!run) throw new RuntimeRequestError("No benchmark has that id.");
    await this.poll();
    if (run.status !== "running") return run;
    const job = this.jobFor(run)!;
    const response = await this.call(
      "DELETE",
      `/apis/batch/v1/namespaces/${job.namespace}/jobs/${job.name}?propagationPolicy=Background`,
    );
    if (response.status !== 404 && (response.status < 200 || response.status >= 300))
      throw new RuntimeUnavailable(`Kubernetes returned HTTP ${response.status} for the Job.`);
    this.finish(run, { status: "stopped" });
    return run;
  }

  private finish(run: BenchmarkRun, outcome: Partial<BenchmarkRun>) {
    Object.assign(run, outcome, { finishedAt: this.now });
    this.save();
  }

  private follow() {
    if (this.polling) return;
    this.polling = setInterval(() => {
      void this.poll().catch(() => {});
    }, this.options.pollMs ?? 15_000);
    this.polling.unref();
  }

  /**
   * Checks the running Job. When it ends, reads its summary; a failure reads as Kubernetes' reason
   * (a deadline, or the container's OOMKilled) or else the log's last line.
   */
  async poll() {
    const run = this.runs.find((item) => item.status === "running");
    if (!run) {
      clearInterval(this.polling);
      this.polling = undefined;
      return;
    }
    const job = this.jobFor(run);
    if (!job) return this.finish(run, { status: "failed", error: "Its workload is gone." });
    const { name, namespace } = job;
    const state = await this.call("GET", `/apis/batch/v1/namespaces/${namespace}/jobs/${name}`);
    if (state.status === 404)
      return this.finish(run, { status: "failed", error: "Its Job no longer exists." });
    if (state.status !== 200) return;
    const status = (state.body as Record<string, any>).status ?? {};
    if (!status.succeeded && !status.failed) return;
    const { log, killed } = await this.log(namespace, name);
    const summary = status.succeeded ? parseBenchmarkLog(log) : undefined;
    if (summary) return this.finish(run, { status: "completed", summary });
    const condition = (status.conditions ?? []).find(
      (item: { type: string; reason?: string }) => item.type === "Failed",
    );
    // BackoffLimitExceeded says only that the pod failed; its log says why.
    const reason = condition?.reason !== "BackoffLimitExceeded" && condition?.message;
    this.finish(run, {
      status: "failed",
      error: brief(
        reason ||
          (killed && "It ran out of memory (OOMKilled).") ||
          log.split("\n").filter(Boolean).at(-1) ||
          "BetterBench gave no result.",
      ),
    });
  }

  /** The last `lines` of the run's Job pod, timestamped, as Settings › Workers shows a workload's. */
  async logs(id: string, lines: number): Promise<{ pods: RuntimePodLog[] }> {
    const run = this.runs.find((item) => item.id === id);
    if (!run) throw new RuntimeConflict("That benchmark is gone.");
    const job = this.jobFor(run);
    if (!job) return { pods: [] };
    const found = await this.call(
      "GET",
      `/api/v1/namespaces/${job.namespace}/pods?labelSelector=${encodeURIComponent(`batch.kubernetes.io/job-name=${job.name}`)}`,
    );
    const pods = ((found.body as Record<string, any>)?.items ?? []) as Record<string, any>[];
    return {
      pods: await Promise.all(
        pods.map(async (pod) => {
          const name = String(pod.metadata?.name ?? "");
          const status = pod.status?.containerStatuses?.[0];
          const response = await this.call(
            "GET",
            `/api/v1/namespaces/${job.namespace}/pods/${encodeURIComponent(name)}/log?${new URLSearchParams({ tailLines: String(lines), timestamps: "true" })}`,
          );
          const text =
            response.status === 200 && typeof response.body === "string" ? response.body : "";
          return {
            name,
            container: String(pod.spec?.containers?.[0]?.name ?? ""),
            phase: pod.metadata?.deletionTimestamp
              ? "Terminating"
              : (pod.status?.phase ?? "Unknown"),
            restarts: status?.restartCount ?? 0,
            lines: text.split("\n").filter(Boolean),
          };
        }),
      ),
    };
  }

  /** The Job's pod log tail, whose last line is the summary, and whether it ran out of memory. */
  private async log(namespace: string, job: string) {
    const pods = await this.call(
      "GET",
      `/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(`batch.kubernetes.io/job-name=${job}`)}`,
    );
    const pod = ((pods.body as Record<string, any>)?.items ?? [])[0];
    if (!pod) return { log: "", killed: false };
    const killed = pod.status?.containerStatuses?.[0]?.state?.terminated?.reason === "OOMKilled";
    const response = await this.call(
      "GET",
      `/api/v1/namespaces/${namespace}/pods/${encodeURIComponent(pod.metadata.name)}/log?tailLines=20`,
    );
    const log = response.status === 200 && typeof response.body === "string" ? response.body : "";
    return { log, killed };
  }
}
