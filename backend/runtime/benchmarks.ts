import { randomBytes } from "node:crypto";

import {
  type BenchmarkModel,
  type BenchmarkRun,
  type BenchmarkStatus,
  type BenchmarkSuite,
  type BenchmarkSummary,
  type RuntimePodLog,
  activeBenchmark,
} from "../../shared/runtime.ts";
import { upsamplerModels } from "../assistant-presets.js";
import { RadianceClient, radianceWorkMs, videoFailure } from "../providers/radiance.ts";
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

export interface BenchmarkMediaModel extends BenchmarkModel {
  kind: "image" | "video";
  /** The underlying Radiance model id served by `/v1/models`. */
  radianceModel: string;
  width?: number;
  height?: number;
  steps?: number;
  frames?: number;
  fps?: number;
  duration?: number;
  cfg?: number;
}

interface BenchmarkQueueBridge {
  busy(workloadId: string): boolean;
  wake(): void;
}

/** Starts the line the Job prints its summary on, last, after the benchmark's own output. */
const marker = "STUDIO-BENCHMARK ";
const historyLimit = 50;
/** The pods the Job runs, which the models' network policy admits. */
const podLabel = "betterbench";
const knownSuites = new Set<BenchmarkSuite>(["betterbench", "qualitybench", "radiance-media"]);
const smokePrompt = "A red ceramic mug on a wooden table in soft morning daylight";
const smokeNegative = "";

/**
 * BetterBench's quick run against the endpoint and model it is given, then its report's headline
 * figures (the HTML report's tiles) on one JSON line after `marker`, computed by its own report code.
 */
const betterBenchScript = `import json, sys
from betterbench.cli import main
from betterbench.report import combined_score, concurrency_rows, prefill_rows
main(["run", "--endpoint", sys.argv[1], "--model", sys.argv[2], "--quick", "--no-html", "--out", "/data/results.json"])
results = json.load(open("/data/results.json"))
combined = combined_score(results) or {}
levels = concurrency_rows(results)
depths = [row for row in prefill_rows(results) if not row["skipped"]]
print(${JSON.stringify(marker)} + json.dumps({
    "suite": "betterbench",
    "version": results["betterbench_version"],
    "decode": combined.get("decode"),
    "ttftMs": combined.get("ttft_p50"),
    "aggregate": {"level": levels[-1]["level"], "tps": levels[-1]["aggregate_tps"]} if levels else None,
    "prefill": {"depth": depths[-1]["target_depth"], "tps": depths[-1]["pp_med"]} if depths else None,
}))
`;

/**
 * QualityBench (https://github.com/launch80/QualityBench) runner against an OpenAI-compatible
 * endpoint. Supports QualityBench's CLI and extracts overall and per-task accuracy figures onto
 * the final `STUDIO-BENCHMARK` JSON line.
 */
const qualityBenchScript = `import glob, json, os, shutil, subprocess, sys
endpoint, model = sys.argv[1], sys.argv[2]
out_dir = "/data/qualitybench"
os.makedirs(out_dir, exist_ok=True)
out_file = os.path.join(out_dir, "results.json")
exe = shutil.which("qualitybench") or shutil.which("l80-qualitybench")
base_cmd = [exe] if exe else [sys.executable, "-m", "qualitybench"]
help_out = subprocess.run(base_cmd + ["run", "--help"], capture_output=True, text=True)
use_run = help_out.returncode == 0
help_text = help_out.stdout + help_out.stderr
if not use_run:
    help_out = subprocess.run(base_cmd + ["--help"], capture_output=True, text=True)
    help_text = help_out.stdout + help_out.stderr
cmd = list(base_cmd) + (["run"] if use_run else [])
if "--endpoint" in help_text:
    cmd += ["--endpoint", endpoint]
elif "--base-url" in help_text:
    cmd += ["--base-url", endpoint]
elif "--url" in help_text:
    cmd += ["--url", endpoint]
cmd += ["--model", model]
if "--quick" in help_text:
    cmd += ["--quick"]
if "--no-html" in help_text:
    cmd += ["--no-html"]
if "--out" in help_text:
    cmd += ["--out", out_file]
elif "--output" in help_text:
    cmd += ["--output", out_file]
elif "--output-dir" in help_text:
    cmd += ["--output-dir", out_dir]
env = dict(os.environ)
key = env.get("QUALITYBENCH_API_KEY") or env.get("OPENAI_API_KEY") or ""
env.setdefault("OPENAI_API_KEY", key)
env.setdefault("OPENAI_BASE_URL", endpoint)
proc = subprocess.run(cmd, env=env)
if proc.returncode != 0:
    sys.exit(proc.returncode)
candidates = [out_file] + sorted(glob.glob(os.path.join(out_dir, "**", "*.json"), recursive=True))
data = None
for path in candidates:
    if os.path.isfile(path):
        try:
            parsed = json.load(open(path))
            if isinstance(parsed, dict):
                data = parsed
                break
        except Exception:
            pass
if not isinstance(data, dict):
    sys.exit("QualityBench wrote no JSON results.")
def pct(val):
    if not isinstance(val, (int, float)):
        return None
    return round(val * 100.0, 2) if 0.0 <= val <= 1.0 else round(float(val), 2)
tasks = []
raw_tasks = data.get("tasks") or data.get("benchmarks") or data.get("results") or {}
if isinstance(raw_tasks, dict):
    for name, info in raw_tasks.items():
        if isinstance(info, dict):
            val = next((info.get(k) for k in ("score", "accuracy", "pass_rate", "pass@1", "overall") if isinstance(info.get(k), (int, float))), None)
            if val is not None:
                tasks.append({"name": str(name), "score": pct(val)})
        elif isinstance(info, (int, float)):
            tasks.append({"name": str(name), "score": pct(info)})
elif isinstance(raw_tasks, list):
    for item in raw_tasks:
        if isinstance(item, dict) and item.get("name"):
            val = next((item.get(k) for k in ("score", "accuracy", "pass_rate", "pass@1") if isinstance(item.get(k), (int, float))), None)
            if val is not None:
                tasks.append({"name": str(item["name"]), "score": pct(val)})
overall = next((data.get(k) for k in ("overall_score", "score", "accuracy", "overall") if isinstance(data.get(k), (int, float))), None)
if overall is None and isinstance(data.get("summary"), dict):
    overall = next((data["summary"].get(k) for k in ("overall_score", "score", "accuracy", "overall") if isinstance(data["summary"].get(k), (int, float))), None)
score = pct(overall) if overall is not None else (round(sum(t["score"] for t in tasks) / len(tasks), 2) if tasks else None)
version = str(data.get("qualitybench_version") or data.get("version") or data.get("schema_version") or "")
print(${JSON.stringify(marker)} + json.dumps({
    "suite": "qualitybench",
    "version": version,
    "score": score,
    "tasks": tasks[:12],
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
  suite = "betterbench",
}: {
  name: string;
  workload: Workload;
  model: string;
  image: string;
  secret: string;
  suite?: "betterbench" | "qualitybench";
}) {
  const labels = {
    "app.kubernetes.io/name": podLabel,
    "studio.excloo.dev/benchmark": workload.id,
    ...(suite !== "betterbench" ? { "studio.excloo.dev/benchmark-suite": suite } : {}),
  };
  const isQuality = suite === "qualitybench";
  const env = isQuality
    ? [
        {
          name: "QUALITYBENCH_API_KEY",
          valueFrom: { secretKeyRef: { name: secret, key: "API_KEY" } },
        },
        {
          name: "OPENAI_API_KEY",
          valueFrom: { secretKeyRef: { name: secret, key: "API_KEY" } },
        },
      ]
    : [
        {
          name: "BETTERBENCH_API_KEY",
          valueFrom: { secretKeyRef: { name: secret, key: "API_KEY" } },
        },
      ];
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name, namespace: workload.namespace, labels },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: (isQuality ? 4 : 2) * 60 * 60,
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
              command: [
                "python",
                "-c",
                isQuality ? qualityBenchScript : betterBenchScript,
                `${workload.url}/v1`,
                model,
              ],
              env,
              resources: {
                requests: { cpu: "100m", memory: "256Mi" },
                limits: { memory: isQuality ? "2Gi" : "1Gi" },
              },
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
  if (raw.suite === "qualitybench") {
    const tasks = Array.isArray(raw.tasks)
      ? raw.tasks
          .filter(
            (item: any) => item && typeof item.name === "string" && figure(item.score) !== null,
          )
          .map((item: any) => ({ name: item.name, score: figure(item.score)! }))
      : [];
    return {
      suite: "qualitybench",
      version: String(raw.version ?? ""),
      score: figure(raw.score),
      ...(tasks.length ? { tasks } : {}),
    };
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
const isUpsampler = (id: string) => {
  const bare = id.replace(/^local\//, "");
  return upsamplerModels().some((model) => model === id || model.replace(/^local\//, "") === bare);
};

/**
 * Benchmarks and tests Studio's workloads one at a time: BetterBench (text speed), QualityBench
 * (text quality), and Radiance Media Test (image/video smoke & speed). Studio holds new queue jobs
 * on the benchmarked workload while a run is active so work and benchmarks don't starve each other.
 */
export class Benchmarks {
  readonly configured: boolean;
  readonly suites: BenchmarkSuite[];
  private runs: BenchmarkRun[];
  /** Holds the batch's place while its models are checked, before the runs exist. */
  private starting = false;
  private startingWorkload = "";
  private transition = Promise.resolve();
  private checking?: Promise<void>;
  private polling?: NodeJS.Timeout;
  /** In-process Radiance media tests: their abort controllers and timestamped logs. */
  private mediaRuns = new Map<string, AbortController>();
  private mediaLogs = new Map<string, string[]>();
  private queue?: BenchmarkQueueBridge;
  private options: {
    request: KubernetesRequest;
    workloads: Workload[];
    environment: Environment;
    store?: BenchmarkStore;
    fetchImpl?: typeof fetch;
    textModels?: () => Promise<BenchmarkModel[]>;
    mediaModels?: () => Promise<BenchmarkMediaModel[]>;
    now?: () => number;
    pollMs?: number;
  };

  constructor(options: Benchmarks["options"]) {
    this.options = options;
    const { environment } = options;
    const hasBetterBench = Boolean(environment.STUDIO_BENCHMARK_IMAGE);
    const hasQualityBench = Boolean(environment.STUDIO_QUALITYBENCH_IMAGE);
    if ((hasBetterBench || hasQualityBench) && !environment.STUDIO_BENCHMARK_SECRET)
      throw new Error(
        "STUDIO_BENCHMARK_SECRET is required with STUDIO_BENCHMARK_IMAGE or STUDIO_QUALITYBENCH_IMAGE.",
      );
    const hasRadianceMedia = options.workloads.some((workload) => workload.backend === "radiance");
    this.suites = [
      ...(hasBetterBench ? (["betterbench"] as const) : []),
      ...(hasQualityBench ? (["qualitybench"] as const) : []),
      ...(hasRadianceMedia && options.mediaModels ? (["radiance-media"] as const) : []),
    ];
    this.configured = this.suites.length > 0;
    this.options.store ??= memoryStore<BenchmarkRun[]>();
    this.runs = this.options.store.read() ?? [];
    // An in-process Radiance media test cannot survive a Studio restart; mark it interrupted.
    let changed = false;
    for (const run of this.runs) {
      if (run.suite === "radiance-media" && run.status === "running") {
        run.status = "failed";
        run.error = "Interrupted by Studio restart.";
        run.finishedAt = this.now;
        changed = true;
      }
    }
    if (changed) this.save();
    if (this.runs.some(activeBenchmark)) this.follow();
  }

  /** Connects the generation queue so benchmarks wait for in-flight work and hold new work. */
  useQueue(bridge: BenchmarkQueueBridge) {
    this.queue = bridge;
  }

  /** Whether a benchmark or test is currently holding `workloadId` (waiting, running or stopping). */
  holding(workloadId: string) {
    return (
      (this.starting && this.startingWorkload === workloadId) ||
      this.runs.some((run) => run.workload === workloadId && activeBenchmark(run))
    );
  }

  list(): BenchmarkStatus {
    return { configured: this.configured, suites: this.suites, runs: this.runs };
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

  private parseSuite(value?: string): BenchmarkSuite {
    if (!value) return "betterbench";
    if (!knownSuites.has(value as BenchmarkSuite))
      throw new RuntimeRequestError("Choose BetterBench, QualityBench, or Radiance Test.");
    return value as BenchmarkSuite;
  }

  private workload(id: string, suite: BenchmarkSuite = "betterbench") {
    if (!this.suites.includes(suite)) {
      if (suite === "qualitybench")
        throw new RuntimeRequestError("QualityBench needs STUDIO_QUALITYBENCH_IMAGE.");
      if (suite === "radiance-media")
        throw new RuntimeRequestError("Radiance tests need a Radiance workload.");
      throw new RuntimeRequestError("Benchmarks need STUDIO_BENCHMARK_IMAGE.");
    }
    if (suite === "radiance-media") {
      const workload = this.options.workloads.find(
        (item) => item.id === id && item.backend === "radiance",
      );
      if (!workload) throw new RuntimeRequestError("Radiance tests run on a Radiance workload.");
      return workload;
    }
    const workload = this.options.workloads.find((item) => item.id === id && servesText(item));
    if (!workload) throw new RuntimeRequestError("workload must be a workload serving local text.");
    return workload;
  }

  async models(id: string, suite?: string): Promise<BenchmarkModel[]> {
    const chosen = this.parseSuite(suite);
    const workload = this.workload(id, chosen);
    if (chosen === "radiance-media") {
      const models = await this.servedMediaModels(workload);
      return models.map(({ id, label, kind }) => ({ id, label, kind }));
    }
    return this.servedModels(workload);
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
      // Cold models do not report capabilities. The gateway's local catalogue classifies text;
      // exclude specialised prompt upsamplers (such as local/flux-pup), which are not chat LLMs.
      const available = new Set(
        served.filter(({ state }) => state !== "failed").map(({ id }) => id),
      );
      return text
        .filter(
          ({ id }) => id.startsWith("local/") && !isUpsampler(id) && available.has(id.slice(6)),
        )
        .map(({ id, label }) => ({
          id: id.slice(6),
          label: label === id ? id.slice(6) : label,
          kind: "text" as const,
        }));
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
        return isUpsampler(model) ? [] : [{ id: model, label: model, kind: "text" }];
      }
    } catch {}
    throw stopped();
  }

  private async servedMediaModels(workload: Workload): Promise<BenchmarkMediaModel[]> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const key = this.options.environment.STUDIO_RADIANCE_KEY;
    const signal = AbortSignal.timeout(5000);
    const stopped = () => new RuntimeConflict(`${workload.label} isn't answering: start it first.`);
    const [served, media] = await Promise.all([
      new RadianceClient(workload.url, fetchImpl, key || "").models(signal).catch(() => {
        throw stopped();
      }),
      this.options.mediaModels?.() ?? [],
    ]);
    const available = new Set(served.filter(({ state }) => state !== "failed").map(({ id }) => id));
    return media.filter((item) => available.has(item.radianceModel));
  }

  async start(id: string, requestedBy: string, models: string[], suite?: string) {
    const chosen = this.parseSuite(suite);
    const workload = this.workload(id, chosen);
    if (this.starting || this.runs.some(activeBenchmark))
      throw new RuntimeConflict("A benchmark is already running.");
    this.starting = true;
    this.startingWorkload = workload.id;
    try {
      const inventory =
        chosen === "radiance-media"
          ? await this.servedMediaModels(workload)
          : await this.servedModels(workload);
      const byId = new Map(inventory.map((item) => [item.id, item]));
      const selected = [...new Set(models)];
      if (!selected.length || selected.some((model) => !byId.has(model)))
        throw new RuntimeRequestError(
          chosen === "radiance-media"
            ? "Choose available Radiance models."
            : "Choose available text models.",
        );
      const runs = selected.map<BenchmarkRun>((model) => {
        const info = byId.get(model)!;
        return {
          id: randomBytes(8).toString("hex"),
          ...(chosen !== "betterbench" ? { suite: chosen } : {}),
          workload: workload.id,
          label: workload.label,
          model,
          ...(info.label && info.label !== model ? { modelLabel: info.label } : {}),
          status: "queued",
          requestedBy,
        };
      });
      return await this.serialise(async () => {
        this.runs.unshift(...runs);
        this.save();
        // Wait for any already-accepted generation work on this workload to finish before starting.
        if (!this.queue?.busy(workload.id)) {
          const launched = await this.launch(runs[0], workload).catch((error) => {
            this.runs = this.runs.slice(runs.length);
            this.save();
            throw error;
          });
          if (launched) this.save();
        }
        this.follow();
        return runs;
      });
    } finally {
      this.starting = false;
      this.startingWorkload = "";
    }
  }

  private async launch(run: BenchmarkRun, workload: Workload) {
    const suite = run.suite ?? "betterbench";
    if (suite === "radiance-media") {
      run.status = "running";
      run.startedAt = this.now;
      this.runRadianceMedia(run, workload);
      return true;
    }
    const job = this.jobFor(run)!;
    const image =
      suite === "qualitybench"
        ? this.options.environment.STUDIO_QUALITYBENCH_IMAGE!
        : this.options.environment.STUDIO_BENCHMARK_IMAGE!;
    const response = await this.options
      .request(
        "POST",
        `/apis/batch/v1/namespaces/${job.namespace}/jobs`,
        benchmarkJob({
          name: job.name,
          workload,
          model: run.model,
          image,
          secret: this.options.environment.STUDIO_BENCHMARK_SECRET!,
          suite,
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

  private appendMediaLog(runId: string, message: string) {
    const lines = this.mediaLogs.get(runId) ?? [];
    lines.push(`${this.now} ${message}`);
    this.mediaLogs.set(runId, lines.slice(-200));
  }

  private runRadianceMedia(run: BenchmarkRun, workload: Workload) {
    const controller = new AbortController();
    this.mediaRuns.set(run.id, controller);
    this.mediaLogs.set(run.id, []);
    const log = (message: string) => this.appendMediaLog(run.id, message);
    const clock = this.options.now ?? Date.now;
    const client = new RadianceClient(
      workload.url,
      this.options.fetchImpl ?? fetch,
      this.options.environment.STUDIO_RADIANCE_KEY || "",
    );
    void (async () => {
      try {
        const media = await this.servedMediaModels(workload);
        const spec = media.find((item) => item.id === run.model);
        if (!spec) throw new Error(`Radiance model ${run.model} is no longer available.`);
        const models = await client.models(controller.signal);
        const initial = models.find((item) => item.id === spec.radianceModel)?.state || "unknown";
        log(
          `Testing ${spec.label} (${spec.radianceModel}, ${spec.kind}, initial state: ${initial})`,
        );
        const started = clock();
        if (spec.kind === "image") {
          const width = spec.width || 1024;
          const height = spec.height || 1024;
          const steps = spec.steps || 8;
          log(`Requesting ${width}×${height} image (${steps} steps)`);
          const images = await client.images(
            "/v1/images/generations",
            {
              model: spec.radianceModel,
              prompt: smokePrompt,
              ...(smokeNegative ? { negative_prompt: smokeNegative } : {}),
              width,
              height,
              steps,
              ...(spec.cfg !== undefined ? { cfg: spec.cfg } : {}),
              seed: 42,
              n: 1,
            },
            AbortSignal.any([controller.signal, AbortSignal.timeout(radianceWorkMs)]),
          );
          const elapsed = Math.max(0, clock() - started);
          const bytes = images[0].byteLength;
          log(`Completed in ${(elapsed / 1000).toFixed(1)} s (${bytes} bytes)`);
          await this.serialise(async () => {
            if (run.status === "stopping" || run.status === "stopped") return;
            this.finish(run, {
              status: "completed",
              summary: {
                suite: "radiance-media",
                version: "1",
                kind: "image",
                loadMs: initial === "resident" ? 0 : null,
                generateMs: elapsed,
                bytes,
              },
            });
          });
        } else {
          const body: Record<string, unknown> = {
            model: spec.radianceModel,
            prompt: smokePrompt,
            seed: 42,
            ...(spec.width ? { width: spec.width } : {}),
            ...(spec.height ? { height: spec.height } : {}),
            ...(spec.steps ? { steps: spec.steps } : {}),
            ...(spec.frames ? { frames: spec.frames } : {}),
            ...(spec.fps ? { fps: spec.fps } : {}),
            ...(spec.duration ? { seconds: spec.duration } : {}),
          };
          log("Submitting video test to Radiance");
          const created = await client.createVideo(
            body,
            AbortSignal.any([controller.signal, AbortSignal.timeout(radianceWorkMs)]),
          );
          const acceptedAt = clock();
          const loadMs = initial === "resident" ? 0 : Math.max(0, acceptedAt - started);
          log(
            `Video job ${created.id} accepted after ${(loadMs / 1000).toFixed(1)} s (status: ${created.status})`,
          );
          let current = created;
          try {
            while (!["completed", "succeeded", "done"].includes(current.status)) {
              const failed = videoFailure(current);
              if (failed) throw new Error(failed);
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(resolve, 2000);
                controller.signal.addEventListener(
                  "abort",
                  () => {
                    clearTimeout(timer);
                    reject(new Error("Stopped."));
                  },
                  { once: true },
                );
              });
              current = await client.video(created.id, controller.signal);
            }
            const bytes = (await client.videoContent(created.id, controller.signal)).byteLength;
            const generateMs = Math.max(0, clock() - acceptedAt);
            log(
              `Completed video in ${(generateMs / 1000).toFixed(1)} s (${bytes} bytes, load ${(loadMs / 1000).toFixed(1)} s)`,
            );
            await this.serialise(async () => {
              if (run.status === "stopping" || run.status === "stopped") return;
              this.finish(run, {
                status: "completed",
                summary: {
                  suite: "radiance-media",
                  version: "1",
                  kind: "video",
                  loadMs,
                  generateMs,
                  bytes,
                },
              });
            });
          } finally {
            await client.deleteVideo(created.id).catch(() => undefined);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Ended: ${message}`);
        await this.serialise(async () => {
          if (controller.signal.aborted || run.status === "stopping") {
            this.finish(run, { status: "stopped" });
          } else {
            this.finish(run, { status: "failed", error: brief(message) });
          }
        });
      } finally {
        this.mediaRuns.delete(run.id);
        void this.poll().catch(() => {});
      }
    })();
  }

  stop(id: string) {
    return this.serialise(async () => {
      const run = this.runs.find((item) => item.id === id);
      if (!run) throw new RuntimeRequestError("No benchmark has that id.");
      if (run.status === "running" && run.suite !== "radiance-media") await this.checkJob(run);
      if (!activeBenchmark(run) || run.status === "stopping") return run;
      if (run.suite === "radiance-media") {
        const active = this.mediaRuns.get(run.id);
        if (active) {
          run.status = "stopping";
          this.save();
          active.abort();
        } else {
          this.finish(run, { status: "stopped" });
        }
        return run;
      }
      run.status = "stopping";
      this.save();
      await this.stopJob(run);
      return run;
    });
  }

  private async stopJob(run: BenchmarkRun) {
    const job = this.jobFor(run);
    if (!job) return this.finish(run, { status: "stopped" });
    const { name, namespace } = job;
    const response = await this.options
      .request(
        "DELETE",
        `/apis/batch/v1/namespaces/${namespace}/jobs/${name}?propagationPolicy=Foreground`,
      )
      .catch(() => undefined);
    if (!response || response.status >= 500 || response.status === 429) return;
    if (response.status === 404) {
      if (await this.jobPodsGone(namespace, name)) this.finish(run, { status: "stopped" });
      return;
    }
    if (response.status < 200 || response.status >= 300) {
      run.status = run.startedAt ? "running" : "queued";
      this.save();
      throw new RuntimeUnavailable(`Kubernetes returned HTTP ${response.status} for the Job.`);
    }
  }

  private finish(run: BenchmarkRun, outcome: Partial<BenchmarkRun>) {
    Object.assign(run, outcome, { finishedAt: this.now });
    this.save();
    if (!this.holding(run.workload)) this.queue?.wake();
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
      const stopping = this.runs.find((run) => run.status === "stopping");
      if (stopping) {
        if (stopping.suite !== "radiance-media") await this.stopJob(stopping);
        if (this.runs.some((run) => run.status === "stopping")) return;
      }
      const running = this.runs.find((run) => run.status === "running");
      if (running) {
        if (running.suite !== "radiance-media") await this.checkJob(running);
        if (running.status === "running") return;
      }
      const index = this.runs.findIndex((run) => run.status === "queued");
      if (index < 0) {
        clearInterval(this.polling);
        this.polling = undefined;
        return;
      }
      const next = this.runs[index];
      // Wait for already-accepted generation work on this workload before launching the next test.
      if (this.queue?.busy(next.workload)) return;
      try {
        const workload = this.workload(next.workload, next.suite ?? "betterbench");
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
    if (state.status === 404) {
      if (await this.jobPodsGone(namespace, name))
        this.finish(run, { status: "failed", error: "Its Job no longer exists." });
      return;
    }
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
          `${run.suite === "qualitybench" ? "QualityBench" : "BetterBench"} gave no result.`,
      ),
    });
  }

  /** The last `lines` of the run's Job pod (or in-process Radiance test log). */
  async logs(id: string, lines: number): Promise<{ pods: RuntimePodLog[] }> {
    const run = this.runs.find((item) => item.id === id);
    if (!run) throw new RuntimeConflict("That benchmark is gone.");
    if (run.suite === "radiance-media") {
      const recorded = this.mediaLogs.get(run.id) ?? [];
      return {
        pods: recorded.length
          ? [
              {
                name: `radiance-test-${run.id}`,
                container: "studio",
                phase: run.status === "running" ? "Running" : "Succeeded",
                restarts: 0,
                lines: recorded.slice(-lines),
              },
            ]
          : [],
      };
    }
    const workload = this.options.workloads.find((item) => item.id === run.workload);
    if (!workload) return { pods: [] };
    const engine = new KubernetesEngine(this.options.request);
    return { pods: await engine.jobLogs(workload.namespace, this.jobFor(run)!.name, lines) };
  }

  private jobPods(namespace: string, job: string) {
    return this.call(
      "GET",
      `/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(`batch.kubernetes.io/job-name=${job}`)}`,
    );
  }

  private async jobPodsGone(namespace: string, job: string) {
    // A pod can briefly outlive its Job even during foreground deletion.
    const { status, body } = await this.jobPods(namespace, job);
    return (
      status === 404 ||
      (status === 200 && (body as { items?: unknown[] } | null)?.items?.length === 0)
    );
  }

  /** The Job's pod log tail, whose last line is the summary, and whether it ran out of memory. */
  private async log(namespace: string, job: string) {
    const pods = await this.jobPods(namespace, job);
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
