import { randomBytes } from "node:crypto";

import {
  type BenchmarkModel,
  type BenchmarkRun,
  type BenchmarkStatus,
  type BenchmarkSummary,
  type RuntimePodLog,
  activeBenchmark,
} from "../../shared/runtime.ts";
import { RadianceClient } from "../providers/radiance.ts";
import {
  RuntimeConflict,
  RuntimeRequestError,
  RuntimeUnavailable,
  type Workload,
  memoryStore,
  servesText,
} from "./controller.ts";
import { KubernetesEngine, type KubernetesRequest } from "./kubernetes.ts";

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
 * The Job that benchmarks one workload's local text from inside its namespace. The endpoint key
 * comes from the namespace's `secret` (its `API_KEY`, as the server reads it), so Studio never
 * handles it.
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
 * Benchmarks the local text of Studio's workloads one at a time with a BetterBench Job, which runs
 * beside the model's ordinary work, and keeps the past runs. Without STUDIO_BENCHMARK_IMAGE there
 * are none.
 */
export class Benchmarks {
  readonly configured: boolean;
  private runs: BenchmarkRun[];
  /** Holds the batch's place while its models are checked, before the runs exist. */
  private starting = false;
  private transition = Promise.resolve();
  private checking?: Promise<void>;
  private polling?: NodeJS.Timeout;
  private options: {
    request: KubernetesRequest;
    workloads: Workload[];
    environment: Environment;
    store?: BenchmarkStore;
    fetchImpl?: typeof fetch;
    textModels?: () => Promise<BenchmarkModel[]>;
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
    if (this.runs.some(activeBenchmark)) this.follow();
  }

  list(): BenchmarkStatus {
    return { configured: this.configured, runs: this.runs };
  }

  private get now() {
    return new Date((this.options.now ?? Date.now)()).toISOString();
  }
  private save() {
    let past = 0;
    this.runs = this.runs.filter((run) => activeBenchmark(run) || past++ < historyLimit);
    this.options.store!.write(this.runs);
  }

  private serialise<T>(change: () => Promise<T>) {
    const result = this.transition.then(change);
    this.transition = result.then(
      () => {},
      () => {},
    );
    return result;
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

  private workload(id: string) {
    if (!this.configured) throw new RuntimeRequestError("Benchmarks need STUDIO_BENCHMARK_IMAGE.");
    const workload = this.options.workloads.find((item) => item.id === id && servesText(item));
    if (!workload) throw new RuntimeRequestError("workload must be a workload serving local text.");
    return workload;
  }

  async models(id: string) {
    return this.servedModels(this.workload(id));
  }

  private async servedModels(workload: Workload): Promise<BenchmarkModel[]> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const key = this.options.environment.STUDIO_RADIANCE_KEY;
    const signal = AbortSignal.timeout(5000);
    const stopped = () => new RuntimeConflict(`${workload.label} isn't answering: start it first.`);
    if (workload.backend === "radiance") {
      const [served, text] = await Promise.all([
        new RadianceClient(workload.url, fetchImpl, key || "").models(signal).catch(() => {
          throw stopped();
        }),
        this.options.textModels?.() ?? [],
      ]);
      // Cold models do not report capabilities. The gateway's local catalogue classifies text.
      const available = new Set(
        served.filter(({ state }) => state !== "failed").map(({ id }) => id),
      );
      return text
        .filter(({ id }) => id.startsWith("local/") && available.has(id.slice(6)))
        .map(({ id, label }) => ({ id: id.slice(6), label: label === id ? id.slice(6) : label }));
    }
    try {
      const response = await fetchImpl(`${workload.url}/health`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        redirect: "error",
        signal,
      });
      await response.body?.cancel();
      if (response.ok) {
        const model = workload.model!.replace(/^[^/]+\//, "");
        return [{ id: model, label: model }];
      }
    } catch {}
    throw stopped();
  }

  async start(id: string, requestedBy: string, models: string[]) {
    const workload = this.workload(id);
    if (this.starting || this.runs.some(activeBenchmark))
      throw new RuntimeConflict("A benchmark is already running.");
    this.starting = true;
    try {
      const available = new Set((await this.servedModels(workload)).map(({ id }) => id));
      const selected = [...new Set(models)];
      if (!selected.length || selected.some((model) => !available.has(model)))
        throw new RuntimeRequestError("Choose available text models.");
      const runs = selected.map<BenchmarkRun>((model) => ({
        id: randomBytes(8).toString("hex"),
        workload: workload.id,
        label: workload.label,
        model,
        status: "queued",
        requestedBy,
      }));
      return await this.serialise(async () => {
        this.runs.unshift(...runs);
        this.save();
        const launched = await this.launch(runs[0], workload).catch((error) => {
          this.runs = this.runs.slice(runs.length);
          this.save();
          throw error;
        });
        if (launched) this.save();
        this.follow();
        return runs;
      });
    } finally {
      this.starting = false;
    }
  }

  private async launch(run: BenchmarkRun, workload: Workload) {
    const job = this.jobFor(run)!;
    const response = await this.options
      .request(
        "POST",
        `/apis/batch/v1/namespaces/${job.namespace}/jobs`,
        benchmarkJob({
          name: job.name,
          workload,
          model: run.model,
          image: this.options.environment.STUDIO_BENCHMARK_IMAGE!,
          secret: this.options.environment.STUDIO_BENCHMARK_SECRET!,
        }),
      )
      .catch(() => undefined);
    // An uncertain reply leaves the run queued so its named Job can be recovered on the next poll.
    if (!response || response.status >= 500 || response.status === 429) return false;
    if (response.status === 403)
      throw new RuntimeUnavailable(
        `Studio's service account may not create Jobs in ${workload.namespace}; apply its benchmark role there.`,
      );
    // The same Job may already exist if Studio restarted before saving its launch.
    if (response.status !== 409 && (response.status < 200 || response.status >= 300))
      throw new RuntimeUnavailable(`Kubernetes returned HTTP ${response.status} for the Job.`);
    run.status = "running";
    run.startedAt = this.now;
    return true;
  }

  stop(id: string) {
    return this.serialise(async () => {
      const run = this.runs.find((item) => item.id === id);
      if (!run) throw new RuntimeRequestError("No benchmark has that id.");
      if (run.status === "running") await this.checkJob(run);
      if (!activeBenchmark(run)) return run;
      const job = this.jobFor(run);
      if (job) {
        const response = await this.call(
          "DELETE",
          `/apis/batch/v1/namespaces/${job.namespace}/jobs/${job.name}?propagationPolicy=Background`,
        );
        if (response.status !== 404 && (response.status < 200 || response.status >= 300))
          throw new RuntimeUnavailable(`Kubernetes returned HTTP ${response.status} for the Job.`);
      }
      this.finish(run, { status: "stopped" });
      return run;
    });
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

  poll() {
    return (this.checking ??= this.serialise(async () => {
      const running = this.runs.find((run) => run.status === "running");
      if (running) {
        await this.checkJob(running);
        if (running.status === "running") return;
      }
      const index = this.runs.findIndex((run) => run.status === "queued");
      if (index < 0) {
        clearInterval(this.polling);
        this.polling = undefined;
        return;
      }
      const next = this.runs[index];
      try {
        const workload = this.workload(next.workload);
        if (!(await this.launch(next, workload))) return;
      } catch (error) {
        return this.finish(next, {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.runs.splice(index, 1);
      this.runs.unshift(next);
      this.save();
    }).finally(() => {
      this.checking = undefined;
    }));
  }

  private async checkJob(run: BenchmarkRun) {
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

  /** The last `lines` of the run's Job pod, as Settings › Workers shows a workload's. */
  async logs(id: string, lines: number): Promise<{ pods: RuntimePodLog[] }> {
    const run = this.runs.find((item) => item.id === id);
    if (!run) throw new RuntimeConflict("That benchmark is gone.");
    const workload = this.options.workloads.find((item) => item.id === run.workload);
    if (!workload) return { pods: [] };
    const engine = new KubernetesEngine(this.options.request);
    return { pods: await engine.jobLogs(workload.namespace, this.jobFor(run)!.name, lines) };
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
