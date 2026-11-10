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

/**
 * A previewed swap for waiting media work (`POST /api/queue/:id/swap`): its placement, with each
 * workload's name for accounts that can't read Settings › Workers.
 */
export interface RuntimeSwap extends RuntimePreview {
  labels: Record<string, string>;
  /** The stopping text workload Run When Idle may start again once Studio is idle. */
  runWhenIdle?: string;
}

/** Why media work waits while running text holds the GPUs it needs; it marks the work as swappable. */
export const textHoldsGpus = (names: string[]) =>
  `Waiting for a GPU: ${names.join(", ")} ${names.length === 1 ? "is running; stop it" : "are running; stop them"} in Settings › Workers.`;
export const waitsOnText = (reason?: string) =>
  /^Waiting for a GPU: .+ (is running; stop it|are running; stop them) in Settings › Workers\.$/.test(
    reason ?? "",
  );

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

/**
 * Automatic control starts media workloads for queued work and settles idle pools. It stops no text
 * workload and starts only a text workload chosen as `idleWorkload`.
 */
export interface RuntimeSettings {
  automatic: boolean;
  /** Minutes without queued or running work before a pool is idle; 0 never. */
  parkIdleMinutes: number;
  /** The workload to start once its pool is idle, parking its idle media; absent (or "" when set) is None. */
  idleWorkload?: string;
  /** Ordinary accounts may swap a text workload out for their waiting media work, as administrators can. */
  everyoneSwaps?: boolean;
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
  settings: RuntimeSettings;
  pools: { id: string; capacity: number; used: number }[];
  operation?: RuntimeOperation;
  history: RuntimeOperation[];
  workloads: RuntimeWorkload[];
}
