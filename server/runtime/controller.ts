export interface Workload {
  id: string;
  container: string;
  devices: string[];
  kind: "media" | "text";
  url: string;
}

export interface RuntimeEngine {
  running(container: string): Promise<boolean>;
  start(container: string): Promise<void>;
  stop(container: string): Promise<void>;
  ready?(workload: Workload): Promise<boolean>;
}

export class RuntimeUnavailable extends Error {
  status = 503;
}

export interface RuntimeLease {
  workload: Workload;
  /** Call only after outputs have been saved, or the operation has failed/cancelled. */
  release(): void;
}

/** Admission owns accepted operations through saving and streaming, not only generation. */
export class RuntimeController {
  readonly workloads: Workload[];
  readonly automaticLifecycle: boolean;
  private active = new Map<string, number>();
  private startingDevices = new Set<string>();
  private engine: RuntimeEngine;

  constructor(engine: RuntimeEngine, workloads: Workload[], automaticLifecycle = false) {
    this.engine = engine;
    this.workloads = workloads;
    this.automaticLifecycle = automaticLifecycle;
  }

  status() {
    return this.workloads.map((workload) => ({
      id: workload.id,
      kind: workload.kind,
      devices: workload.devices,
      acceptedOperations: this.active.get(workload.id) ?? 0,
    }));
  }

  async acquire(id: string): Promise<RuntimeLease> {
    const workload = this.workloads.find((item) => item.id === id);
    if (!workload) throw new RuntimeUnavailable("The selected workload is not configured.");
    if (workload.devices.some((device) => this.startingDevices.has(device)))
      throw new RuntimeUnavailable("A worker is starting on the selected GPUs.");
    for (const device of workload.devices) this.startingDevices.add(device);
    try {
      const conflicts = this.workloads.filter(
        (other) =>
          other.id !== id && other.devices.some((device) => workload.devices.includes(device)),
      );
      if (conflicts.some((other) => this.active.has(other.id))) {
        throw new RuntimeUnavailable(
          "Waiting for accepted work and saved outputs on the selected GPUs.",
        );
      }
      const requestedRunning = await this.engine.running(workload.container);
      const runningConflicts: Workload[] = [];
      for (const other of conflicts) {
        if (await this.engine.running(other.container)) runningConflicts.push(other);
      }
      if (requestedRunning && runningConflicts.length)
        throw new RuntimeUnavailable(
          "Conflicting workers are running on the selected GPUs; inspect their placement before continuing.",
        );
      if (!requestedRunning) {
        if (!this.automaticLifecycle)
          throw new RuntimeUnavailable(
            "The selected worker is offline; automatic lifecycle control is disabled.",
          );
        for (const other of runningConflicts) await this.engine.stop(other.container);
        await this.engine.start(workload.container);
        if (!(await this.engine.running(workload.container)))
          throw new RuntimeUnavailable("The selected worker failed to start.");
      }
      if (this.engine.ready && !(await this.engine.ready(workload)))
        throw new RuntimeUnavailable("The selected worker is starting or is not responding.");
    } finally {
      for (const device of workload.devices) this.startingDevices.delete(device);
    }
    return this.retain(id);
  }

  /** Restore this process's persisted accepted operations before admitting new traffic. */
  retain(id: string): RuntimeLease {
    const workload = this.workloads.find((item) => item.id === id);
    if (!workload) throw new RuntimeUnavailable("The recorded workload is no longer configured.");
    this.active.set(id, (this.active.get(id) ?? 0) + 1);
    let released = false;
    return {
      workload,
      release: () => {
        if (released) return;
        released = true;
        const remaining = (this.active.get(id) ?? 1) - 1;
        if (remaining) this.active.set(id, remaining);
        else this.active.delete(id);
      },
    };
  }
}

/** Only configured, existing containers are controlled; Studio never discovers/adopts workloads. */
export class DockerEngine implements RuntimeEngine {
  private endpoint: string;
  private fetchImpl: typeof fetch;

  constructor(endpoint: string, fetchImpl = fetch) {
    this.endpoint = endpoint.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
  }

  private async request(container: string, action: string, method = "GET") {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.endpoint}/containers/${encodeURIComponent(container)}/${action}`,
        {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(90_000),
        },
      );
    } catch {
      throw new RuntimeUnavailable("The configured Docker Engine is unavailable.");
    }
    if (!response.ok && response.status !== 304)
      throw new RuntimeUnavailable("Docker could not complete the worker operation.");
    return response;
  }

  async running(container: string) {
    const response = await this.request(container, "json");
    const data = (await response.json()) as { State: { Running: boolean } };
    return data.State.Running;
  }

  async start(container: string) {
    await this.request(container, "start", "POST");
  }
  async stop(container: string) {
    await this.request(container, "stop?t=60", "POST");
  }
}
