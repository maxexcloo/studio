import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import {
  type RuntimeJob,
  type RuntimeOperation,
  type RuntimePodLog,
  type RuntimePreview,
  type RuntimeQueueCancel,
  type RuntimeStatus,
  type WorkloadPhase,
} from "../../shared/runtime.ts";
import type { ServiceKind } from "../../shared/services.ts";
import type { DeploymentState } from "./kubernetes.ts";

/** One Kubernetes deployment Studio may scale between 0 and 1 replicas (runtime/workloads.ts). */
export interface Workload {
  /** The deployment's name. */
  id: string;
  label: string;
  kind: ServiceKind;
  namespace: string;
  deployment: string;
  /** The node pool whose GPUs it claims, and how many. */
  pool: string;
  gpus: number;
  url: string;
  /** With the text capability: the gateway model it serves (STUDIO_LOCAL_TEXT_MODEL). */
  model?: string;
  /** With the text capability: whether its text models read images. */
  vision?: boolean;
  /** Its worker id (workers.js), for workers derived from workloads. */
  worker?: string;
  /** What it runs, else its kind: `image`, `video` and `text` (local text while it runs). */
  capabilities?: string[];
  /** Its backend (workers.js): comfyui unless it says radiance. */
  backend?: string;
}

/** Whether a workload serves local text while it runs. */
export const servesText = (workload: Workload) => workload.capabilities?.includes("text") === true;

interface RuntimeEngine {
  state(workload: Workload): Promise<DeploymentState>;
  scale(workload: Workload, replicas: number): Promise<void>;
  logs(workload: Workload, lines: number): Promise<RuntimePodLog[]>;
}

export class RuntimeUnavailable extends Error {
  status = 503;
}
export class RuntimeConflict extends Error {
  status = 409;
}
export class RuntimeRequestError extends Error {
  status = 400;
}

export interface RuntimeRecord {
  /** The placement last applied in Studio; a deployment stopped outside Studio is drift from it. */
  desired?: string[];
  /** The administrator's placement while an automatic swap for ComfyUI work replaces `desired`. */
  home?: string[];
  operations: RuntimeOperation[];
}
export interface RuntimeStore {
  read(): RuntimeRecord | undefined;
  write(record: RuntimeRecord): void;
}

/** The generation queue's work on each workload (generation-queue.js). */
export interface WorkloadQueue {
  /** A workload's accepted jobs, and how many more wait to start on it. */
  load(workload: string): { jobs: RuntimeJob[]; queued: number };
  /** Cancels every queued and running job routed to a workload. */
  cancel(workload: string): Promise<RuntimeQueueCancel>;
  /** Releases leases whose work is confirmed absent: jobs ended, gone or not yet accepted. */
  releaseStale(): void;
  /** Ends the accepted work of a workload stopped without waiting for it. */
  end(workload: string): Promise<void>;
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
  store?: RuntimeStore;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  timeouts?: { drain: number; stop: number; start: number };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const minutes = (ms: number) => plural(Math.round(ms / 60_000), "minute");
const historyLimit = 100;
/** Why work for a parked workload waits, in the words every surface uses. */
const parkedReason = (label: string) =>
  `${label} is stopped: an administrator can start it in Settings › Workers.`;
/** How long a swap for ComfyUI work outlasts its last waiting or running job. */
const swapIdleMs = 2 * 60_000;
/** Waiting work asks for its workload every second; an older ask has moved or gone. */
const wantedMs = 30_000;
const isRadiance = (workload: Workload) => workload.backend === "radiance";
const isComfy = (workload: Workload) => !isRadiance(workload);
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));
/** A store for a runtime document that lasts only as long as the process. */
export const memoryStore = <T>() => {
  let stored: T | undefined;
  return { read: () => stored, write: (value: T) => (stored = structuredClone(value)) };
};

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
  /** Settles when the running operation finishes; for tests and shutdown. */
  settled: Promise<void> = Promise.resolve();
  private active = new Map<string, number>();
  /** When waiting work last asked for each unplaced ComfyUI workload, in first-asked order. */
  private wanted = new Map<string, number>();
  /** When ComfyUI work last waited or finished; a swap outlasts it by swapIdleMs. */
  private comfyUsedAt: number;
  private stopping = new Set<string>();
  private stopListeners = new Set<(id: string) => void>();
  private current?: RuntimeOperation;
  /** Who cancelled the running change, which stops at its next check. */
  private cancelledBy?: string;
  private claimed = false;
  private queue?: WorkloadQueue;
  /** Workloads the running change stops without waiting for their accepted work. */
  private forced = new Set<string>();
  /** The running change is waiting for accepted work on the workloads it stops. */
  private draining = false;
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
    store = memoryStore<RuntimeRecord>(),
    now = Date.now,
    sleep = delay,
    pollMs = 2000,
    timeouts = { drain: 30 * 60_000, stop: 5 * 60_000, start: 20 * 60_000 },
  }: Options) {
    this.engine = engine;
    this.workloads = workloads;
    this.pools = pools;
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
        // Scaling steps are the only ones that change anything; without one, what ran still runs.
        if (
          operation.type === "apply" &&
          !operation.steps.some((step) => /^(Stopping|Starting) /.test(step.message))
        )
          this.record.desired = operation.before;
        Object.assign(operation, {
          status: "interrupted",
          finishedAt: this.timestamp(),
          error: "Studio restarted during this change.",
          progress: "Interrupted by a Studio restart.",
        });
        interrupted = true;
      }
    this.settleHome();
    if (interrupted) this.save();
    this.comfyUsedAt = this.now();
  }

  /**
   * Radiance holds the GPUs while an administrator's placement includes it, and waiting ComfyUI
   * work swaps in on demand (swapOnDemand). A placement without Radiance pauses swapping until
   * Radiance is placed again. Undefined without a Radiance workload or a placement.
   */
  get swaps(): "automatic" | "paused" | undefined {
    const placed = this.record.home ?? this.record.desired;
    if (!placed || !this.workloads.some(isRadiance)) return undefined;
    return placed.some((id) => this.workloads.some((item) => item.id === id && isRadiance(item)))
      ? "automatic"
      : "paused";
  }
  /** A swap has ended once the placement is the administrator's again. */
  private settleHome() {
    const { home, desired } = this.record;
    if (home && desired && sameSet(home, desired)) delete this.record.home;
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

  /** The tail of each of a workload's pods' logs, read only. */
  async logs(id: string, lines: number) {
    return { pods: await this.engine.logs(this.workload(id), lines) };
  }

  /** The workloads running `kind` the cluster has scaled up (replicas > 0), ready or not. */
  async running(kind: ServiceKind) {
    const workloads = this.workloads.filter((workload) =>
      (workload.capabilities ?? [workload.kind]).includes(kind),
    );
    const states = await Promise.all(workloads.map((workload) => this.engine.state(workload)));
    return workloads.filter((_, index) => states[index].replicas > 0);
  }

  /** Scaled to zero on purpose: not while Studio's last placement (outside a change) has it running. */
  private isParked(workload: Workload, state: DeploymentState) {
    return (
      state.replicas === 0 && (Boolean(this.current) || !this.record.desired?.includes(workload.id))
    );
  }
  private phase(workload: Workload, state: DeploymentState): WorkloadPhase {
    if (state.replicas > 0) return state.ready > 0 ? "running" : "starting";
    if (state.pods > 0) return "stopping";
    return this.isParked(workload, state) ? "parked" : "down";
  }

  private parkedCache?: { until: number; result: Promise<Set<string>> };
  /**
   * The workloads deliberately scaled to zero, cached for five seconds since every status read asks.
   * A deployment Studio cannot read is not parked, so its worker still shows as down.
   */
  parked(): Promise<Set<string>> {
    if (this.parkedCache && this.parkedCache.until > this.now()) return this.parkedCache.result;
    const result = Promise.all(
      this.workloads.map((workload) =>
        this.engine.state(workload).then(
          (state) => (this.isParked(workload, state) ? workload.id : ""),
          () => "",
        ),
      ),
    ).then((ids) => new Set(ids.filter(Boolean)));
    this.parkedCache = { until: this.now() + 5000, result };
    return result;
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
    const swaps = this.swaps;
    return {
      ...(swaps ? { swaps } : {}),
      pools: Object.entries(this.pools).map(([id, capacity]) => ({
        id,
        capacity,
        used: used[id] ?? 0,
      })),
      ...(this.current ? { operation: structuredClone(this.current) } : {}),
      history: structuredClone(this.record.operations.slice(0, 20)),
      workloads: observed.map((entry) => {
        const { workload } = entry;
        const load = this.queue?.load(workload.id);
        const base = {
          id: workload.id,
          label: workload.label,
          kind: workload.kind,
          ...(servesText(workload) ? { text: true as const } : {}),
          pool: workload.pool,
          gpus: workload.gpus,
          acceptedOperations: this.active.get(workload.id) ?? 0,
          ...(isRadiance(workload) ? { radiance: true as const } : {}),
          ...(load?.jobs.length ? { jobs: load.jobs } : {}),
          ...(load?.queued ? { queued: load.queued } : {}),
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
        const phase = this.phase(workload, state);
        return {
          ...base,
          phase,
          replicas: state.replicas,
          ready: state.ready,
          // Flux upgrades reset the GPU releases to zero replicas: drift from Studio's placement.
          ...(phase === "down"
            ? { reason: "Stopped outside Studio; its last placement had it running." }
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
      // A placement by hand ends any automatic swap and decides whether swapping continues.
      delete this.record.home;
      return this.begin("apply", plan, requestedBy);
    } finally {
      this.claimed = false;
    }
  }

  /** Hears the id of each workload Studio stops, including to restart it. */
  onStop(listener: (id: string) => void) {
    this.stopListeners.add(listener);
  }

  /** The queue whose work Settings › Workers shows and ends. */
  useQueue(queue: WorkloadQueue) {
    this.queue = queue;
  }

  /** Cancel Queue: every queued and running job routed to a workload. */
  cancelQueue(id: string) {
    const workload = this.workload(id);
    if (!this.queue) throw new RuntimeUnavailable("Studio's queue isn't running.");
    return this.queue.cancel(workload.id);
  }

  /**
   * Stop a running workload and start it again in place: scale to 0, wait for its pod to go, scale
   * to 1. `force` doesn't wait for Radiance's accepted work, which ends; a change already waiting
   * for that work stops waiting for it.
   */
  async restart(id: string, requestedBy: string, force = false) {
    const workload = this.workload(id);
    if (force && !isRadiance(workload))
      throw new RuntimeRequestError("Only Radiance restarts without waiting for its work.");
    if (force && this.draining && this.current?.stop.includes(id)) {
      this.forced.add(id);
      return structuredClone(this.current);
    }
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
      if (force) this.forced.add(id);
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
      if (this.cancelledBy) throw new Error(`Cancelled by ${this.cancelledBy}.`);
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
    let scaled = false;
    try {
      // New work for a leaving workload waits (acquire refuses it); accepted work finishes and saves first.
      this.draining = true;
      await this.until(
        operation,
        this.timeouts.drain,
        async () => {
          this.queue?.releaseStale();
          // Work can't run on a workload without pods, so its leases hold nothing back.
          const states = await this.states();
          const busy = plan.stop.filter(
            (id) => !this.forced.has(id) && this.active.get(id) && holds(states.get(id)!),
          );
          if (!busy.length) return;
          const count = busy.reduce((sum, id) => sum + (this.active.get(id) ?? 0), 0);
          return `Waiting for ${plural(count, "accepted operation")} on ${busy.map(label).join(", ")} to finish.`;
        },
        "; nothing was stopped",
      );
      this.draining = false;
      scaled = true;
      for (const id of plan.stop) {
        this.step(operation, `Stopping ${label(id)}.`);
        await this.engine.scale(this.workload(id), 0);
        for (const listener of this.stopListeners) listener(id);
        if (this.forced.has(id)) {
          this.step(operation, `Ending the accepted work on ${label(id)}.`);
          await this.queue?.end(id);
        }
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
      this.forced.clear();
      this.draining = false;
      operation.finishedAt = this.timestamp();
      operation.after = await this.states().then(
        (states) =>
          this.workloads.filter((item) => holds(states.get(item.id)!)).map((item) => item.id),
        () => undefined,
      );
      if (operation.after === undefined) delete operation.after;
      // A change that gave up before scaling anything, or was cancelled, leaves what runs as the
      // placement, so reconcile doesn't retry it as if the workloads had been stopped outside Studio.
      if (
        operation.type === "apply" &&
        operation.status === "failed" &&
        (!scaled || this.cancelledBy)
      )
        this.record.desired = operation.after ?? plan.holders;
      this.settleHome();
      this.cancelledBy = undefined;
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
    const [workload] = choices;
    if (
      this.swaps === "automatic" &&
      choices.every((item, index) => this.isParked(item, states[index]))
    ) {
      if (choices.every(isComfy)) {
        this.wanted.set(workload.id, this.now());
        this.comfyUsedAt = this.now();
        void this.swapOnDemand().catch(() => {});
        throw new RuntimeUnavailable(
          `Waiting for ${workload.label} — Studio is switching the GPUs.`,
        );
      }
      if (this.record.home)
        throw new RuntimeUnavailable(
          `Waiting for ${workload.label} — Studio switches the GPUs back once the ComfyUI work finishes.`,
        );
    }
    throw new RuntimeUnavailable(
      choices.every((item, index) => this.isParked(item, states[index]))
        ? parkedReason(workload.label)
        : `${workload.label} stopped outside Studio; Studio restores it once its GPUs are free.`,
    );
  }

  /** GPUs the given workloads claim in one pool. */
  private usage(ids: string[], pool: string) {
    return ids
      .map((id) => this.workload(id))
      .filter((item) => item.pool === pool)
      .reduce((sum, item) => sum + item.gpus, 0);
  }

  /**
   * The running workloads, those stopped outside Studio (restored with it) and `workload`, stopping
   * others in its pool to make room, idle ones first.
   */
  private placementWith(workload: Workload, states: Map<string, DeploymentState>) {
    const target = this.workloads
      .filter((item) => item.id === workload.id || !this.isParked(item, states.get(item.id)!))
      .map((item) => item.id);
    const candidates = target
      .filter((id) => id !== workload.id && this.workload(id).pool === workload.pool)
      .sort((a, b) => (this.active.get(a) ?? 0) - (this.active.get(b) ?? 0));
    while (this.usage(target, workload.pool) > this.pools[workload.pool] && candidates.length)
      target.splice(target.indexOf(candidates.shift()!), 1);
    return this.plan(this.validate(target), states);
  }

  /**
   * An explicit start, such as choosing a parked profile: the first candidate that is running,
   * else the first that fits beside what runs, else the first, stopping what it needs room from.
   * Apply the returned placement with its signature.
   */
  async previewStart(candidates: string[]): Promise<RuntimePreview> {
    const choices = candidates.map((id) => this.workload(id));
    if (!choices.length) throw new RuntimeRequestError("Name a workload to start.");
    const states = await this.states();
    const plans = choices.map((workload) => this.placementWith(workload, states));
    const { holders: _holders, ...preview } =
      plans.find((plan) => !plan.start.length && !plan.stop.length) ??
      plans.find((plan) => !plan.stop.length) ??
      plans[0];
    return preview;
  }

  /**
   * Restore Studio's last placement after something else stopped a workload, such as a Flux upgrade
   * (which resets GPU deployments to 0).
   */
  async reconcile() {
    const desired = this.record.desired?.filter((id) =>
      this.workloads.some((item) => item.id === id),
    );
    if (!desired || this.current || this.claimed) return;
    this.claim();
    try {
      const states = await this.states();
      if (desired.every((id) => holds(states.get(id)!))) return;
      this.begin(
        "apply",
        this.plan(desired, states),
        "restoring the last placement after an outside stop",
      );
    } finally {
      this.claimed = false;
    }
  }

  /**
   * While swaps are automatic, called by waiting ComfyUI work and every 30 seconds: place the
   * ComfyUI workloads waiting work asks for, in the order it first asked, as many as fit, keeping
   * placed ones that have work or are still asked for; what no longer fits, Radiance included,
   * stops once its accepted work finishes, as in any change. Once no ComfyUI work has waited or
   * run for swapIdleMs, the administrator's placement returns.
   */
  async swapOnDemand() {
    if (this.swaps !== "automatic" || this.current || this.claimed) return;
    this.claim();
    try {
      const now = this.now();
      for (const [id, at] of this.wanted) if (now - at > wantedMs) this.wanted.delete(id);
      const desired = this.record.desired ?? [];
      const home = this.record.home ?? desired;
      const comfy = this.workloads.filter(isComfy).map((item) => item.id);
      let target: string[];
      if (this.wanted.size) {
        const fits = (ids: string[]) =>
          Object.entries(this.pools).every(([pool, capacity]) => this.usage(ids, pool) <= capacity);
        const placedFirst = [...this.wanted.keys()].sort(
          (a, b) => Number(!desired.includes(a)) - Number(!desired.includes(b)),
        );
        target = desired.filter((id) => comfy.includes(id) && this.active.get(id));
        for (const id of [...placedFirst, ...desired])
          if (!target.includes(id) && fits([...target, id])) target.push(id);
      } else if (
        this.record.home &&
        !comfy.some((id) => this.active.get(id)) &&
        now - this.comfyUsedAt >= swapIdleMs
      )
        target = home;
      else return;
      if (sameSet(target, desired)) return;
      const states = await this.states();
      this.record.home = home;
      const names = (ids: string[]) => ids.map((id) => this.workload(id).label).join(", ");
      this.begin(
        "apply",
        this.plan(target, states),
        target === home
          ? `automatic: back to ${names(home)} after ${minutes(swapIdleMs)} without ComfyUI work`
          : `automatic: switching to ${names(target)} for waiting ComfyUI work`,
      );
    } finally {
      this.claimed = false;
    }
  }

  /** Stop the running change at its next check; what it already stopped or started stays so. */
  cancel(id: string, requestedBy: string) {
    if (this.current?.id !== id) throw new RuntimeConflict("That change is no longer running.");
    this.cancelledBy = requestedBy;
    return structuredClone(this.current);
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
        if (held.some(isComfy)) this.comfyUsedAt = this.now();
        for (const { id } of held) {
          const remaining = (this.active.get(id) ?? 1) - 1;
          if (remaining) this.active.set(id, remaining);
          else this.active.delete(id);
        }
      },
    };
  }
}
