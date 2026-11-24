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
  /** A media worker running a job now. */
  running?: boolean;
  /** Jobs waiting for this media worker in Studio's queue, whoever asked for them. */
  queued?: number;
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

/** A cloud account's use of its current quota window; `used` is absent while unreadable. */
export interface CloudUsage {
  label: string;
  /** Percent of the window used. */
  used?: number;
  /** When the window resets. */
  resetsAt?: string;
  reason: string;
}

export interface ServicesStatus {
  services: Partial<Record<ServiceKind, ServiceStatus>>;
  /** Each configured cloud provider account's usage. */
  cloud?: CloudUsage[];
  /** Every cloud account is near its limit, so Dream and chats run new work locally. */
  cloudHeld?: true;
  /** Each media worker, for administrators only. */
  workers?: WorkerStatus[];
  runtime: {
    configured: boolean;
    reason: string;
  };
}
