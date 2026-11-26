import type { QueueProgress, QueueStatus } from "./queue.ts";
import type { ServiceKind } from "./services.ts";

/**
 * `parked`: deliberately scaled to zero, by Studio or an administrator. `down`: scaled to zero
 * although Studio's last placement had it running, such as after a Flux upgrade reset it.
 */
export type WorkloadPhase = "running" | "starting" | "stopping" | "parked" | "down" | "unknown";

interface RuntimeWorkload {
  id: string;
  label: string;
  kind: ServiceKind;
  /** It serves local text while it runs. */
  text?: true;
  pool: string;
  gpus: number;
  phase: WorkloadPhase;
  replicas: number;
  ready: number;
  dashboardUrl?: string;
  reason?: string;
  acceptedOperations: number;
  /** It runs Radiance, which an administrator can restart without waiting for its work. */
  radiance?: true;
  /** Accepted jobs followed by a preview of the waiting queue. */
  jobs?: RuntimeJob[];
  /** How many jobs routed to it wait to start. */
  queued?: number;
}

/** Work running or waiting on a GPU workload. */
export interface RuntimeJob {
  id: string;
  /** The start of its prompt. */
  title: string;
  status: QueueStatus;
  /** When the job was admitted, or created if still waiting. */
  since: string;
  reason?: string;
  queuePosition?: number;
  progress?: QueueProgress;
  /** Its cancellation was asked; it ends once its worker confirms or restarts. */
  cancelling?: true;
}

export interface RuntimeQueueStatus {
  workloads: Record<string, { jobs: RuntimeJob[]; queued: number }>;
}

/** What Cancel Queue ended at once, and what stays running until its worker confirms or restarts. */
export interface RuntimeQueueCancel {
  cancelled: number;
  cancelling: number;
}

/** A complete placement: `target` runs afterwards and everything else stops. */
export interface RuntimePreview {
  target: string[];
  stop: string[];
  start: string[];
  keep: string[];
  signature: string;
}

export interface RuntimeOperation {
  id: string;
  type: "apply" | "restart";
  status: "running" | "completed" | "failed" | "interrupted";
  requestedBy: string;
  startedAt: string;
  finishedAt?: string;
  /** Workloads holding GPUs before and after the change. */
  before: string[];
  after?: string[];
  target: string[];
  stop: string[];
  start: string[];
  progress: string;
  steps: { at: string; message: string }[];
  error?: string;
}

/** The tail of one pod's container log (`GET /api/runtime/workloads/:id/logs`), oldest line first. */
export interface RuntimePodLog {
  name: string;
  container: string;
  /** The pod's Kubernetes phase, or Terminating. */
  phase: string;
  restarts: number;
  /** The lines are the previous container's: it restarted and the current one has logged nothing. */
  previous?: boolean;
  /** Each starts with its RFC 3339 timestamp. */
  lines: string[];
}

export interface RuntimeStatus {
  /** The administrator’s placement, including while an automatic swap runs other workloads. */
  placement?: string[];
  /** Whether waiting ComfyUI work swaps in for Radiance, or a placement by hand paused that. */
  swaps?: "automatic" | "paused";
  pools: { id: string; capacity: number; used: number }[];
  operation?: RuntimeOperation;
  history: RuntimeOperation[];
  workloads: RuntimeWorkload[];
}

/** Which test/benchmark suite a run executes. */
export type BenchmarkSuite = "betterbench" | "qualitybench" | "radiance-media";

/** Headline figures for one benchmark or Radiance test run. */
export interface BenchmarkSummary {
  suite?: BenchmarkSuite;
  version: string;
  /** BetterBench: single-stream decode tokens per second, weighted across categories. */
  decode?: number | null;
  /** BetterBench: single-stream time to first token, weighted median, in milliseconds. */
  ttftMs?: number | null;
  /** BetterBench: throughput at the highest concurrency level. */
  aggregate?: { level: number; tps: number } | null;
  /** BetterBench: median prompt processing at the deepest prompt measured. */
  prefill?: { depth: number; tps: number } | null;
  /** QualityBench: overall accuracy score (0–100). */
  score?: number | null;
  /** QualityBench: per-task accuracy scores (0–100). */
  tasks?: { name: string; score: number }[];
  /** Radiance media test: whether an image or video model ran. */
  kind?: "image" | "video";
  /** Radiance media test: cold model load duration in milliseconds, or 0 when already resident. */
  loadMs?: number | null;
  /** Radiance media test: generation duration in milliseconds. */
  generateMs?: number | null;
  /** Radiance media test: generated output size in bytes. */
  bytes?: number | null;
}

/** One benchmark or Radiance test run against a workload (`/api/runtime/benchmarks`). */
export interface BenchmarkRun {
  id: string;
  /** Defaults to "betterbench" for runs recorded before multiple suites existed. */
  suite?: BenchmarkSuite;
  workload: string;
  label: string;
  /** The model id the run measured. */
  model: string;
  /** Human-readable model label when different from `model`. */
  modelLabel?: string;
  status: "queued" | "running" | "stopping" | "completed" | "failed" | "stopped";
  requestedBy: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  summary?: BenchmarkSummary;
}

export const activeBenchmark = (run: BenchmarkRun) =>
  run.status === "queued" || run.status === "running" || run.status === "stopping";

export interface BenchmarkModel {
  id: string;
  label: string;
  kind?: "text" | "image" | "video";
}

/** `configured` is true when at least one suite is available; runs are newest first. */
export interface BenchmarkStatus {
  configured: boolean;
  /** Available suites for this deployment; defaults to ["betterbench"] when omitted. */
  suites?: BenchmarkSuite[];
  runs: BenchmarkRun[];
}
