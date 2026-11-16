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
  pool: string;
  gpus: number;
  phase: WorkloadPhase;
  replicas: number;
  ready: number;
  reason?: string;
  acceptedOperations: number;
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
  pools: { id: string; capacity: number; used: number }[];
  operation?: RuntimeOperation;
  history: RuntimeOperation[];
  workloads: RuntimeWorkload[];
}

/** BetterBench's headline figures for one run, as its report's tiles give them. */
export interface BenchmarkSummary {
  version: string;
  /** Single-stream decode tokens per second, weighted across categories. */
  decode: number | null;
  /** Single-stream time to first token, weighted median, in milliseconds. */
  ttftMs: number | null;
  /** Throughput at the highest concurrency level. */
  aggregate: { level: number; tps: number } | null;
  /** Median prompt processing at the deepest prompt measured. */
  prefill: { depth: number; tps: number } | null;
}

/** One BetterBench run against a local text workload (`/api/runtime/benchmarks`). */
export interface BenchmarkRun {
  id: string;
  workload: string;
  label: string;
  /** The name the model's server reports, which the run measured. */
  model: string;
  status: "running" | "completed" | "failed" | "stopped";
  requestedBy: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  summary?: BenchmarkSummary;
}

/** `configured` is false without a benchmark image; runs are newest first. */
export interface BenchmarkStatus {
  configured: boolean;
  runs: BenchmarkRun[];
}
