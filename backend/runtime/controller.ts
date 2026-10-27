import { createHash, randomUUID } from "node:crypto";
import type { ServiceKind } from "../../shared/services.ts";
import type {
  RuntimeOperation,
  RuntimePreview,
  RuntimeStatus,
  WorkloadPhase,
} from "../../shared/runtime.ts";
import type { DeploymentState } from "./kubernetes.ts";

/** One Kubernetes deployment Studio may scale between 0 and 1 replicas. */
export interface Workload {
  id: string;
  label: string;
  kind: ServiceKind;
  namespace: string;
  deployment: string;
  /** The node pool whose GPUs it claims, and how many. */
  pool: string;
  gpus: number;
  url: string;
  apiKeyEnv?: string;
  /** A media workload's worker id and what it runs (workers.js), for workers derived from workloads. */
  worker?: string;
  capabilities?: string[];
}

interface RuntimeEngine {
  state(workload: Workload): Promise<DeploymentState>;
  scale(workload: Workload, replicas: number): Promise<void>;
}

export class RuntimeUnavailable extends Error {
  status = 503;
}
class RuntimeConflict extends Error {
  status = 409;
}
export class RuntimeRequestError extends Error {
  status = 400;
}

export interface RuntimeRecord {
  /** The placement last applied in Studio; a deployment stopped outside Studio is drift from it. */
  desired?: string[];
  operations: RuntimeOperation[];
}
export interface RuntimeStore {
  read(): RuntimeRecord | undefined;
  write(record: RuntimeRecord): void;
}

interface RuntimeLease {
  workload: Workload;
  /** Call only after outputs have been saved, or the operation has failed/cancelled. */
  release(): void;
}
interface Plan extends RuntimePreview {
  holders: string[];
}
interface Options {
  engine: RuntimeEngine;
  workloads: Workload[];
  /** GPUs per node pool. */
  pools: Record<string, number>;
  automaticLifecycle?: boolean;
  store?: RuntimeStore;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  timeouts?: { drain: number; stop: number; start: number };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const minutes = (ms: number) => plural(Math.round(ms / 60_000), "minute");
const historyLimit = 100;
const memoryStore = (): RuntimeStore => {
  let record: RuntimeRecord | undefined;
  return {
    read: () => record,
    write: (value) => (record = structuredClone(value)),
  };
};

function phase(state: DeploymentState): WorkloadPhase {
  if (state.replicas > 0) return state.ready > 0 ? "running" : "starting";
  return state.pods > 0 ? "stopping" : "stopped";
}
/** A deployment holds its GPUs while it should run or while any of its pods still exists. */
const holds = (state: DeploymentState) => state.replicas > 0 || state.pods > 0;

/**
 * Admission owns accepted operations through saving and streaming, not only generation. One
 * operation at a time changes replicas: it drains and stops the workloads leaving the GPUs, waits
 * for their pods to go, then starts the new ones and waits for them to be ready.
 */
export class RuntimeController {
  readonly workloads: Workload[];
  readonly pools: Record<string, number>;
  readonly automaticLifecycle: boolean;
  /** Settles when the running operation finishes; for tests and shutdown. */
  settled: Promise<void> = Promise.resolve();
  private active = new Map<string, number>();
  private stopping = new Set<string>();
  private current?: RuntimeOperation;
  private claimed = false;
  private record: RuntimeRecord;
  private engine: RuntimeEngine;
  private store: RuntimeStore;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private pollMs: number;
  private timeouts: { drain: number; stop: number; start: number };

  constructor({
    engine,
    workloads,
    pools,
    automaticLifecycle = false,
    store = memoryStore(),
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    pollMs = 2000,
    timeouts = { drain: 30 * 60_000, stop: 5 * 60_000, start: 20 * 60_000 },
  }: Options) {
    this.engine = engine;
    this.workloads = workloads;
    this.pools = pools;
    this.automaticLifecycle = automaticLifecycle;
    this.store = store;
    this.now = now;
    this.sleep = sleep;
    this.pollMs = pollMs;
    this.timeouts = timeouts;
    this.record = store.read() ?? { operations: [] };
    // An operation cannot survive a restart; say so in its record rather than leave it running.
    let interrupted = false;
    for (const operation of this.record.operations)
      if (operation.status === "running") {
        Object.assign(operation, {
          status: "interrupted",
          finishedAt: this.timestamp(),
          error: "Studio restarted during this change.",
          progress: "Interrupted by a Studio restart.",
        });
        interrupted = true;
      }
    if (interrupted) this.save();
  }

  private timestamp() {
    return new Date(this.now()).toISOString();
  }
  private save() {
    this.store.write(this.record);
  }
  private workload(id: string) {
    const workload = this.workloads.find((item) => item.id === id);
    if (!workload) throw new RuntimeRequestError(`${id} is not a configured workload.`);
    return workload;
  }

  /** Accepted operations per workload; synchronous, for admission-aware callers. */
  status() {
    return this.workloads.map((workload) => ({
      id: workload.id,
      kind: workload.kind,
      acceptedOperations: this.active.get(workload.id) ?? 0,
    }));
  }

  /** The workloads of a kind the cluster has scaled up (replicas > 0), ready or not. */
  async running(kind: ServiceKind) {
    const workloads = this.workloads.filter((workload) => workload.kind === kind);
    const states = await Promise.all(workloads.map((workload) => this.engine.state(workload)));
    return workloads.filter((_, index) => states[index].replicas > 0);
  }

  private async states() {
    const states = new Map<string, DeploymentState>();
    await Promise.all(
      this.workloads.map(async (workload) => {
        states.set(workload.id, await this.engine.state(workload));
      }),
    );
    return states;
  }

  async observe(): Promise<RuntimeStatus> {
    const observed = await Promise.all(
      this.workloads.map((workload) =>
        this.engine.state(workload).then(
          (state) => ({ workload, state }),
          (error: Error) => ({ workload, error: error.message }),
        ),
      ),
    );
    const used: Record<string, number> = {};
    for (const entry of observed)
      if ("state" in entry && holds(entry.state))
        used[entry.workload.pool] = (used[entry.workload.pool] ?? 0) + entry.workload.gpus;
    const desired = this.record.desired;
    return {
      automaticLifecycle: this.automaticLifecycle,
      pools: Object.entries(this.pools).map(([id, capacity]) => ({
        id,
        capacity,
        used: used[id] ?? 0,
      })),
      ...(desired ? { desired } : {}),
      ...(this.current ? { operation: structuredClone(this.current) } : {}),
      history: structuredClone(this.record.operations.slice(0, 20)),
      workloads: observed.map((entry) => {
        const { workload } = entry;
        const base = {
          id: workload.id,
          label: workload.label,
          kind: workload.kind,
          pool: workload.pool,
          gpus: workload.gpus,
          acceptedOperations: this.active.get(workload.id) ?? 0,
        };
        if (!("state" in entry))
          return {
            ...base,
            phase: "unknown" as const,
            replicas: 0,
            ready: 0,
            reason: entry.error,
          };
        const { state } = entry;
        // Flux upgrades reset the GPU releases to zero replicas; show that as drift from Studio's placement.
        const stoppedOutside =
          !this.current && Boolean(desired?.includes(workload.id)) && !holds(state);
        return {
          ...base,
          phase: phase(state),
          replicas: state.replicas,
          ready: state.ready,
          ...(stoppedOutside
            ? {
                reason: "Stopped outside Studio; its last placement had it running.",
              }
            : state.reason
              ? { reason: state.reason }
              : {}),
        };
      }),
    };
  }

  private validate(requested: string[]) {
    const target = [...new Set(requested)];
    for (const id of target) this.workload(id);
    for (const [pool, capacity] of Object.entries(this.pools)) {
      const needed = this.usage(target, pool);
      if (needed > capacity)
        throw new RuntimeRequestError(
          `The ${pool} pool has ${plural(capacity, "GPU")}; this placement needs ${needed}.`,
        );
    }
    return target;
  }

  private plan(target: string[], states: Map<string, DeploymentState>): Plan {
    const holders = this.workloads
      .filter((workload) => holds(states.get(workload.id)!))
      .map((workload) => workload.id);
    const signature = createHash("sha256")
      .update(JSON.stringify([[...target].sort(), holders]))
      .digest("hex")
      .slice(0, 16);
    return {
      target,
      holders,
      stop: holders.filter((id) => !target.includes(id)),
      start: target.filter((id) => states.get(id)!.replicas === 0),
      keep: target.filter((id) => states.get(id)!.replicas > 0),
      signature,
    };
  }

  /** What applying this complete placement would stop and start; workloads left out stop. */
  async preview(requested: string[]): Promise<RuntimePreview> {
    const { holders: _holders, ...preview } = this.plan(
      this.validate(requested),
      await this.states(),
    );
    return preview;
  }

  private claim() {
    if (this.current)
      throw new RuntimeConflict(`Another runtime change is running: ${this.current.progress}`);
    if (this.claimed) throw new RuntimeConflict("Another runtime change is being prepared.");
    this.claimed = true;
  }

  /** Apply a previewed placement; the signature proves nothing changed since the preview. */
  async apply(requested: string[], signature: string, requestedBy: string) {
    this.claim();
    try {
      const target = this.validate(requested);
      const plan = this.plan(target, await this.states());
      if (plan.signature !== signature)
        throw new RuntimeConflict("The workloads changed since this preview; preview again.");
      return this.begin("apply", plan, requestedBy);
    } finally {
      this.claimed = false;
    }
  }

  /** Stop a running workload and start it again in place: scale to 0, wait for its pod to go, scale to 1. */
  async restart(id: string, requestedBy: string) {
    const workload = this.workload(id);
    this.claim();
    try {
      const states = await this.states();
      if (states.get(id)!.replicas === 0)
        throw new RuntimeConflict(
          `${workload.label} is not running; only a running workload can be restarted.`,
        );
      const plan = this.plan(
        this.workloads.filter((item) => states.get(item.id)!.replicas > 0).map((item) => item.id),
        states,
      );
      return this.begin("restart", { ...plan, stop: [id], start: [id] }, requestedBy);
    } finally {
      this.claimed = false;
    }
  }

  private begin(type: RuntimeOperation["type"], plan: Plan, requestedBy: string) {
    const operation: RuntimeOperation = {
      id: randomUUID().replaceAll("-", ""),
      type,
      status: "running",
      requestedBy,
      startedAt: this.timestamp(),
      before: plan.holders,
      target: plan.target,
      stop: plan.stop,
      start: plan.start,
      progress: "Starting the change.",
      steps: [],
    };
    this.record.operations.unshift(operation);
    this.record.operations.length = Math.min(this.record.operations.length, historyLimit);
    if (type === "apply") this.record.desired = plan.target;
    this.save();
    this.current = operation;
    for (const id of plan.stop) this.stopping.add(id);
    this.settled = this.run(operation, plan);
    return structuredClone(operation);
  }

  private step(operation: RuntimeOperation, message: string) {
    if (operation.progress === message) return;
    operation.progress = message;
    operation.steps.push({ at: this.timestamp(), message });
    this.save();
  }

  /** Poll until `check` reports nothing to wait for, recording each new reason as progress. */
  private async until(
    operation: RuntimeOperation,
    limit: number,
    check: () => Promise<string | undefined>,
    consequence = "",
  ) {
    const deadline = this.now() + limit;
    for (;;) {
      const waiting = await check();
      if (waiting === undefined) return;
      if (this.now() >= deadline)
        throw new Error(`${waiting} Gave up after ${minutes(limit)}${consequence}.`);
      this.step(operation, waiting);
      await this.sleep(this.pollMs);
    }
  }

  private async run(operation: RuntimeOperation, plan: Plan) {
    const label = (id: string) => this.workload(id).label;
    try {
      // New work for a leaving workload waits (acquire refuses it); accepted work finishes and saves first.
      await this.until(
        operation,
        this.timeouts.drain,
        async () => {
          const busy = plan.stop.filter((id) => this.active.get(id));
          if (!busy.length) return;
          const count = busy.reduce((sum, id) => sum + (this.active.get(id) ?? 0), 0);
          return `Waiting for ${plural(count, "accepted operation")} on ${busy.map(label).join(", ")} to finish.`;
        },
        "; nothing was stopped",
      );
      for (const id of plan.stop) {
        this.step(operation, `Stopping ${label(id)}.`);
        await this.engine.scale(this.workload(id), 0);
      }
      // A GPU claim is released only when the pod is gone, so nothing starts before that.
      const leaving = [...new Set([...plan.stop, ...plan.start])];
      await this.until(operation, this.timeouts.stop, async () => {
        const states = await this.states();
        const lingering = leaving.filter(
          (id) => states.get(id)!.replicas === 0 && states.get(id)!.pods > 0,
        );
        if (lingering.length)
          return `Waiting for ${lingering.map(label).join(", ")} to release ${lingering.length === 1 ? "its GPU" : "their GPUs"}.`;
      });
      for (const id of plan.start) {
        this.step(operation, `Starting ${label(id)}.`);
        await this.engine.scale(this.workload(id), 1);
      }
      this.stopping.clear();
      await this.until(operation, this.timeouts.start, async () => {
        const states = await this.states();
        const pending = plan.start.filter((id) => states.get(id)!.ready === 0);
        if (pending.length)
          return pending
            .map((id) => `Waiting for ${label(id)}: ${states.get(id)!.reason ?? "Starting."}`)
            .join(" ");
      });
      Object.assign(operation, { status: "completed", progress: "Done." });
    } catch (error) {
      Object.assign(operation, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        progress: "Failed.",
      });
    } finally {
      this.stopping.clear();
      operation.finishedAt = this.timestamp();
      operation.after = await this.states().then(
        (states) =>
          this.workloads.filter((item) => holds(states.get(item.id)!)).map((item) => item.id),
        () => undefined,
      );
      if (operation.after === undefined) delete operation.after;
      this.current = undefined;
      this.save();
    }
  }

  /**
   * Admit work on the first ready candidate. Several deployments can serve one worker address (a
   * one- and a two-GPU video deployment behind one Service); the first is the one to start.
   */
  async acquire(candidates: string | string[]): Promise<RuntimeLease> {
    const choices = this.workloads.filter((item) => [candidates].flat().includes(item.id));
    if (!choices.length) throw new RuntimeUnavailable("The selected workload is not configured.");
    const states = await Promise.all(choices.map((workload) => this.engine.state(workload)));
    // Checked after reading state, so an operation that began meanwhile still blocks admission.
    const ready = choices.find(
      (workload, index) =>
        states[index].replicas > 0 && states[index].ready > 0 && !this.stopping.has(workload.id),
    );
    if (ready) return this.retain(ready.id);
    const leaving = choices.find((workload) => this.stopping.has(workload.id));
    if (leaving)
      throw new RuntimeUnavailable(
        `Waiting for the runtime change to finish before using ${leaving.label}.`,
      );
    const index = states.findIndex((state) => state.replicas > 0);
    if (index >= 0) {
      const reason = states[index].reason;
      throw new RuntimeUnavailable(
        `Waiting for ${choices[index].label} to start.${reason && !["Loading.", "Starting."].includes(reason) ? ` ${reason}` : ""}`,
      );
    }
    if (!this.automaticLifecycle)
      throw new RuntimeUnavailable(
        "The selected worker is offline; automatic lifecycle control is disabled.",
      );
    const [workload] = choices;
    if (workload.kind === "text")
      throw new RuntimeUnavailable(
        `${workload.label} is stopped; automatic control never starts text workloads. Start it in Settings › Workers.`,
      );
    if (this.current || this.claimed)
      throw new RuntimeUnavailable(
        `Waiting for ${workload.label} to start after the current runtime change.`,
      );
    await this.switchTo(workload);
    throw new RuntimeUnavailable(`Waiting for ${workload.label} to start.`);
  }

  /** GPUs the given workloads claim in one pool. */
  private usage(ids: string[], pool: string) {
    return ids
      .map((id) => this.workload(id))
      .filter((item) => item.pool === pool)
      .reduce((sum, item) => sum + item.gpus, 0);
  }

  /** Running text workloads. Automatic control never stops them: callers outside Studio use them. */
  private runningText(states: Map<string, DeploymentState>) {
    return this.workloads
      .filter((item) => item.kind === "text" && states.get(item.id)!.replicas > 0)
      .map((item) => item.id);
  }

  /**
   * Automatic lifecycle: start a media workload, stopping media in its pool to make room, idle ones
   * first. If running text holds the GPUs it needs, nothing changes and the work waits.
   */
  private async switchTo(workload: Workload) {
    this.claim();
    try {
      const states = await this.states();
      const text = this.runningText(states);
      const blocking = text.filter((id) => this.workload(id).pool === workload.pool);
      if (
        blocking.length &&
        this.usage([...blocking, workload.id], workload.pool) > this.pools[workload.pool]
      )
        throw new RuntimeUnavailable(
          `Waiting for a GPU: ${blocking.map((id) => this.workload(id).label).join(", ")} ${blocking.length === 1 ? "is running; stop it" : "are running; stop them"} in Settings › Workers.`,
        );
      const target = this.workloads
        .filter((item) => states.get(item.id)!.replicas > 0)
        .map((item) => item.id)
        .concat(workload.id);
      const candidates = target
        .filter(
          (id) =>
            id !== workload.id && !text.includes(id) && this.workload(id).pool === workload.pool,
        )
        .sort((a, b) => (this.active.get(a) ?? 0) - (this.active.get(b) ?? 0));
      while (this.usage(target, workload.pool) > this.pools[workload.pool] && candidates.length)
        target.splice(target.indexOf(candidates.shift()!), 1);
      const plan = this.plan(this.validate(target), states);
      this.begin("apply", plan, "automatic");
    } finally {
      this.claimed = false;
    }
  }

  /**
   * Automatic lifecycle: restore Studio's last placement after something else stopped a workload.
   * Running text stays; a restore that needs its GPUs is skipped until it is stopped in Studio.
   */
  async reconcile() {
    const desired = this.record.desired?.filter((id) =>
      this.workloads.some((item) => item.id === id),
    );
    if (!this.automaticLifecycle || !desired || this.current || this.claimed) return;
    this.claim();
    try {
      const states = await this.states();
      if (desired.every((id) => holds(states.get(id)!))) return;
      const target = [...new Set([...desired, ...this.runningText(states)])];
      if (
        Object.entries(this.pools).some(([pool, capacity]) => this.usage(target, pool) > capacity)
      )
        return;
      this.begin("apply", this.plan(target, states), "automatic: restoring the last placement");
    } finally {
      this.claimed = false;
    }
  }

  operation(id: string) {
    const operation = this.record.operations.find((item) => item.id === id);
    if (!operation) throw new RuntimeRequestError("No runtime operation has that id.");
    return structuredClone(operation);
  }

  /**
   * Restore this process's persisted accepted operations before admitting new traffic. Without
   * knowing which candidate served the work, every candidate is held.
   */
  retain(candidates: string | string[]): RuntimeLease {
    const held = this.workloads.filter((item) => [candidates].flat().includes(item.id));
    if (!held.length)
      throw new RuntimeUnavailable("The recorded workload is no longer configured.");
    for (const { id } of held) this.active.set(id, (this.active.get(id) ?? 0) + 1);
    let released = false;
    return {
      workload: held[0],
      release: () => {
        if (released) return;
        released = true;
        for (const { id } of held) {
          const remaining = (this.active.get(id) ?? 1) - 1;
          if (remaining) this.active.set(id, remaining);
          else this.active.delete(id);
        }
      },
    };
  }
}
