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

export interface RuntimeStatus {
  automaticLifecycle: boolean;
  pools: { id: string; capacity: number; used: number }[];
  desired?: string[];
  operation?: RuntimeOperation;
  history: RuntimeOperation[];
  workloads: RuntimeWorkload[];
}
