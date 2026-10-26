export type ServiceKind = "image" | "video" | "text";
export type ServiceHealth = "healthy" | "offline" | "unknown" | "waiting";

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
  /** Catalogue identity; does not establish which model is currently loaded. */
  workloadId?: string;
  /** Only present when the direct health response identifies its loaded model. */
  loadedModel?: string;
}

export interface ServiceStatus {
  state: ServiceHealth;
  reason: string;
  endpoints: ServiceEndpoint[];
}

export interface ServicesStatus {
  services: Partial<Record<ServiceKind, ServiceStatus>>;
  runtime: {
    configured: boolean;
    automaticLifecycle: boolean;
    reason: string;
  };
}
