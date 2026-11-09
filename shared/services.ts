export type ServiceKind = "image" | "video" | "text";
/** `parked`: its workloads were stopped on purpose (runtime `parked`), unlike `offline`, which should run. */
export type ServiceHealth = "healthy" | "offline" | "parked" | "unknown" | "waiting";

export interface ServiceEndpoint {
  id: string;
  label: string;
  state: ServiceHealth;
  reason: string;
  checkedAt?: string;
  /** Direct health address, included only for administrators. */
  endpoint?: string;
  device?: string;
  version?: string;
  memoryTotal?: number;
  memoryFree?: number;
  /** The Studio workloads serving it, in start order; does not establish which model is loaded. */
  workloads?: string[];
}

/** One media worker, for administrators: its health, what it runs and what waits for it. */
export interface WorkerStatus {
  id: string;
  label: string;
  capabilities: string[];
  state: ServiceHealth;
  reason: string;
  /** The queue job running there. */
  currentJob?: string;
  /** Jobs in Studio's queue waiting for it. */
  queued: number;
  /** The profile it last ran, until it stops, restarts or goes offline. */
  loadedModel?: string;
  memoryTotal?: number;
  memoryFree?: number;
  /** When its running and waiting work should be done (epoch ms), once that is known. */
  freeAt?: number;
}

export interface ServiceStatus {
  state: ServiceHealth;
  reason: string;
  endpoints: ServiceEndpoint[];
}

export interface ServicesStatus {
  services: Partial<Record<ServiceKind, ServiceStatus>>;
  /** Each media worker, for administrators only. */
  workers?: WorkerStatus[];
  runtime: {
    configured: boolean;
    automaticLifecycle: boolean;
    reason: string;
  };
}
