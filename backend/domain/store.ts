import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  GenerationInput,
  GenerationOperation,
  QueueJob,
  StudioSession,
} from "../../shared/queue.ts";
import { awaitsWriting, terminalStatuses } from "../../shared/queue.ts";
import type { DreamOrigin } from "./dream.ts";

/** Queue tiers on one resource, lower first; finishing upscales and then Dream run below MCP. */
export const queuePriority = { manual: 0, mcp: 1, finishing: 2, dream: 3 } as const;
/**
 * Where a job was admitted from: its tier, for an MCP call the set it was enqueued with, for a
 * Dream job its prompt and note, which its gallery items carry until the person keeps them, and
 * `faceRedo` for Face Check's automatic redo of its `parentItemId` (domain/face-redo.ts).
 */
export interface QueueOrigin {
  priority?: number;
  queueSet?: string;
  dream?: DreamOrigin;
  faceRedo?: true;
}
/**
 * `cleared` takes a failed job out of the queue panel; its record stays. `dream` is
 * the Dream origin here; `publicJob` shows only that the job is Dream's.
 */
export type OwnedJob = Omit<QueueJob, "dream"> &
  QueueOrigin & {
    ownerId: string;
    resource: string;
    cancelRequested?: boolean;
    cleared?: boolean;
  };
/** One job of a request, as `Store.enqueueAll` queues it. */
export interface QueuedCopy {
  input: GenerationInput;
  operation: GenerationOperation;
  parentJobId?: string;
  resource?: string;
  requestedId?: string;
  origin?: QueueOrigin & { parentItemId?: string };
}
interface UserPreset {
  id: string;
  title: string;
  input: GenerationInput;
  /** Presets saved before dates were kept have none. */
  savedAt?: string;
  /** The parts of a draft it holds, when only some; one without holds them all. */
  parts?: string[];
}
const now = () => new Date().toISOString();
/** The pause key that holds every account's queue. */
export const everyone = "*";
/** Not yet handed to a provider: the work a pause holds and a move reorders. */
export const pendingStatuses: ReadonlySet<string> = new Set(["writing", "queued", "waiting"]);
/** Not yet done: pending, or handed to a provider. */
const openStatuses = [...pendingStatuses, "starting", "running", "saving"];
/** How many of an account's finished jobs its queue lists, newest first; older ones are read one at a time (`job`). */
export const listedFinishedJobs = 200;
const placeholders = (values: Iterable<unknown>) => [...values].map(() => "?").join(", ");

export class Store {
  readonly db: DatabaseSync;
  // Each worker's stored observation as last read or written: its node list is large to parse.
  private readonly workerModelRecords = new Map<
    string,
    { url: string; record: Record<string, any> }
  >();

  /** `db` comes from runtimeDatabase (or openDatabase in tests), which sets its pragmas. */
  constructor(db: DatabaseSync) {
    this.db = db;
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS studio_worker_models (id TEXT PRIMARY KEY, url TEXT NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_sessions (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, updated_at TEXT NOT NULL, record TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS studio_sessions_owner ON studio_sessions(owner_id, updated_at);
      CREATE UNIQUE INDEX IF NOT EXISTS studio_sessions_conversation
        ON studio_sessions(owner_id, json_extract(record, '$.mcp.conversationId'))
        WHERE json_extract(record, '$.mcp.conversationId') IS NOT NULL;
      CREATE TABLE IF NOT EXISTS studio_queue (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES studio_sessions(id),
        created_at TEXT NOT NULL, status TEXT NOT NULL, record TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS studio_queue_owner ON studio_queue(owner_id, created_at);
      CREATE INDEX IF NOT EXISTS studio_queue_status ON studio_queue(status, created_at);
      CREATE INDEX IF NOT EXISTS studio_queue_session ON studio_queue(session_id, created_at);
      CREATE TABLE IF NOT EXISTS studio_queue_pauses (owner_id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS studio_user_presets (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, record TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS studio_user_presets_owner ON studio_user_presets(owner_id);
      CREATE TABLE IF NOT EXISTS studio_provider_jobs (id TEXT PRIMARY KEY REFERENCES studio_queue(id), owner_id TEXT NOT NULL, record TEXT NOT NULL);`);
  }

  /** A session holds the jobs of one request or run of requests, such as an MCP conversation's. */
  createSession(
    ownerId: string,
    title = "",
    inputs: GenerationInput = {},
    marks: Pick<StudioSession, "mcp"> = {},
  ): StudioSession {
    const stamp = now();
    const session: StudioSession = {
      id: randomUUID(),
      title,
      inputs,
      createdAt: stamp,
      updatedAt: stamp,
      ...marks,
    };
    this.db
      .prepare("INSERT INTO studio_sessions VALUES (?, ?, ?, ?)")
      .run(session.id, ownerId, stamp, JSON.stringify(session));
    return session;
  }

  /** The session of an MCP client's conversation, made on its first generation; without one, a new session. */
  mcpSession(
    ownerId: string,
    title: string,
    inputs: GenerationInput,
    conversationId = "",
  ): StudioSession {
    if (!conversationId) return this.createSession(ownerId, title, inputs);
    const row = this.db
      .prepare(
        "SELECT record FROM studio_sessions WHERE owner_id = ? AND json_extract(record, '$.mcp.conversationId') = ?",
      )
      .get(ownerId, conversationId);
    if (row) return JSON.parse(row.record as string);
    // Before a conversation kept one session, each MCP job had its own; the conversation goes on in its first.
    const first = this.db
      .prepare(
        "SELECT session_id FROM studio_queue WHERE owner_id = ? AND json_extract(record, '$.input.chat.conversationId') = ? ORDER BY created_at, rowid LIMIT 1",
      )
      .get(ownerId, conversationId);
    const earlier = first && this.session(ownerId, first.session_id as string);
    if (!earlier) return this.createSession(ownerId, title, inputs, { mcp: { conversationId } });
    const session = { ...earlier, mcp: { conversationId } };
    this.db
      .prepare("UPDATE studio_sessions SET record = ? WHERE id = ? AND owner_id = ?")
      .run(JSON.stringify(session), session.id, ownerId);
    return session;
  }

  session(ownerId: string, id: string): StudioSession | undefined {
    const row = this.db
      .prepare("SELECT record FROM studio_sessions WHERE id = ? AND owner_id = ?")
      .get(id, ownerId);
    return row ? JSON.parse(row.record as string) : undefined;
  }

  enqueue(
    ownerId: string,
    sessionId: string,
    input: GenerationInput,
    operation: GenerationOperation,
    parentJobId?: string,
    resource?: string,
    requestedId?: string,
    origin?: QueuedCopy["origin"],
  ): OwnedJob {
    return this.enqueueAll(ownerId, () => sessionId, [
      { input, operation, parentJobId, resource, requestedId, origin },
    ])[0];
  }

  /**
   * Queues the copies of one request in one transaction. `session` creates or finds their session
   * inside it, so a failed insert (a requested ID already in use) leaves neither session nor copies.
   */
  enqueueAll(ownerId: string, session: () => string, copies: QueuedCopy[]): OwnedJob[] {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const sessionId = session();
      if (!this.session(ownerId, sessionId)) throw new Error("Session not found.");
      const jobs = copies.map(
        ({ input, operation, parentJobId, resource = "local-media", requestedId, origin = {} }) => {
          if (parentJobId && !this.job(ownerId, parentJobId))
            throw new Error("Parent generation not found.");
          const stamp = now();
          const id = requestedId || randomUUID();
          const jobResource = resource.startsWith("provider:cliproxyapi")
            ? `provider:cliproxyapi:${id}`
            : resource;
          const backend = resource.startsWith("worker:")
            ? resource.slice(resource.indexOf(":") + 1)
            : undefined;
          const job: OwnedJob = {
            id,
            jobId: id,
            ownerId,
            resource: jobResource,
            backend,
            sessionId,
            parentJobId,
            ...(origin.parentItemId ? { parentItemId: origin.parentItemId } : {}),
            operation,
            priority: origin.priority ?? queuePriority.manual,
            queueSet: origin.queueSet,
            ...(origin.dream ? { dream: origin.dream } : {}),
            ...(origin.faceRedo ? { faceRedo: origin.faceRedo } : {}),
            // A prompt the assistant writes is the item's first stage (queue.ts); it then queues.
            status: awaitsWriting(input) ? "writing" : "queued",
            reason: "",
            input: { ...input, clientJobId: id },
            items: [],
            outputs: [],
            createdAt: stamp,
            updatedAt: stamp,
          };
          this.db
            .prepare("INSERT INTO studio_queue VALUES (?, ?, ?, ?, ?, ?)")
            .run(id, ownerId, sessionId, stamp, job.status, JSON.stringify(job));
          return job;
        },
      );
      this.db.exec("COMMIT");
      return jobs;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * A job finished outside the queue, never scheduled: a video edit (gallery/video-edits.js),
   * recorded so its result joins the versions of the one it was made from, or an upload Recreate
   * makes a version of (gallery/recreate.js).
   */
  recordFinished(
    ownerId: string,
    sessionId: string,
    input: GenerationInput,
    origin: {
      parentJobId?: string;
      parentItemId?: string;
      operation?: GenerationOperation;
      outputs: QueueJob["outputs"];
    },
  ): OwnedJob {
    const stamp = now();
    const id = randomUUID();
    const job: OwnedJob = {
      id,
      jobId: id,
      ownerId,
      resource: "studio",
      sessionId,
      ...(origin.parentJobId ? { parentJobId: origin.parentJobId } : {}),
      ...(origin.parentItemId ? { parentItemId: origin.parentItemId } : {}),
      operation: origin.operation ?? "animate",
      status: "completed",
      reason: "",
      input: { ...input, clientJobId: id },
      items: [],
      outputs: origin.outputs,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.db
      .prepare("INSERT INTO studio_queue VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, ownerId, sessionId, stamp, job.status, JSON.stringify(job));
    return job;
  }

  jobs(ownerId?: string, sessionId?: string): OwnedJob[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (ownerId !== undefined) {
      clauses.push("owner_id = ?");
      values.push(ownerId);
    }
    if (sessionId !== undefined) {
      clauses.push("session_id = ?");
      values.push(sessionId);
    }
    return this.db
      .prepare(
        `SELECT record FROM studio_queue${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at, rowid`,
      )
      .all(...values)
      .map((row) => JSON.parse(row.record as string));
  }

  /** Unfinished jobs, optionally one owner's, in queue order: read through the status index. */
  openJobs(ownerId?: string): OwnedJob[] {
    return this.db
      .prepare(
        `SELECT record FROM studio_queue WHERE status IN (${placeholders(openStatuses)})${ownerId === undefined ? "" : " AND owner_id = ?"} ORDER BY created_at, rowid`,
      )
      .all(...openStatuses, ...(ownerId === undefined ? [] : [ownerId]))
      .map((row) => JSON.parse(row.record as string));
  }

  /**
   * The owner's queue as it lists, in queue order: every unfinished job, every failed one not
   * cleared, and the newest `listedFinishedJobs` of the rest. Nothing is deleted: an older job
   * stays readable by its ID.
   */
  queueJobs(ownerId: string): OwnedJob[] {
    return this.db
      .prepare(
        `SELECT record FROM studio_queue WHERE owner_id = ? AND (
          status IN (${placeholders(openStatuses)})
          OR (status = 'failed' AND json_extract(record, '$.cleared') IS NULL)
          OR rowid IN (SELECT rowid FROM studio_queue WHERE owner_id = ? AND status IN (${placeholders(terminalStatuses)})
            ORDER BY created_at DESC, rowid DESC LIMIT ?)
        ) ORDER BY created_at, rowid`,
      )
      .all(ownerId, ...openStatuses, ownerId, ...terminalStatuses, listedFinishedJobs)
      .map((row) => JSON.parse(row.record as string));
  }

  /** Jobs by ID, whoever owns them: for what the server itself already knows by ID. */
  jobsById(ids: string[]): OwnedJob[] {
    if (!ids.length) return [];
    return this.db
      .prepare(`SELECT record FROM studio_queue WHERE id IN (${placeholders(ids)})`)
      .all(...ids)
      .map((row) => JSON.parse(row.record as string));
  }

  /** The finished job holding an upload, as Recreate made it (gallery/recreate.js). */
  uploadJob(ownerId: string, itemId: string): OwnedJob | undefined {
    const row = this.db
      .prepare(
        `SELECT record FROM studio_queue WHERE owner_id = ? AND json_extract(record, '$.resource') = 'studio'
          AND json_extract(record, '$.parentJobId') IS NULL AND json_extract(record, '$.outputs[0].id') = ?
          ORDER BY created_at, rowid LIMIT 1`,
      )
      .get(ownerId, itemId);
    return row ? JSON.parse(row.record as string) : undefined;
  }

  /**
   * How many of the owner's jobs ran each profile (by `input.profileId`) since an ISO time, with
   * every profile they ever ran at 0 or more. Cancelled jobs tried nothing and are left out.
   */
  profileRuns(ownerId: string, since: string): Map<string, number> {
    return new Map(
      this.db
        .prepare(
          `SELECT COALESCE(json_extract(record, '$.input.profileId'), '') AS profile, SUM(created_at >= ?) AS recent
          FROM studio_queue WHERE owner_id = ? AND status != 'cancelled' GROUP BY profile`,
        )
        .all(since, ownerId)
        .map((row) => [String(row.profile), Number(row.recent)]),
    );
  }

  /** The owner's jobs created at or after an ISO time, in queue order: read through the owner index. */
  jobsSince(ownerId: string, since: string): OwnedJob[] {
    return this.db
      .prepare(
        "SELECT record FROM studio_queue WHERE owner_id = ? AND created_at >= ? ORDER BY created_at, rowid",
      )
      .all(ownerId, since)
      .map((row) => JSON.parse(row.record as string));
  }

  /** The IDs of all the owner's jobs, without reading their records. */
  jobIds(ownerId: string): Set<string> {
    return new Set(
      this.db
        .prepare("SELECT id FROM studio_queue WHERE owner_id = ?")
        .all(ownerId)
        .map((row) => row.id as string),
    );
  }

  /**
   * What a scheduler tick weighs, in queue order: every unfinished job, and the finished ones it
   * still counts, which are those created since the oldest unfinished job (overtakes) and those in
   * an unfinished job's set (a started set keeps its place). Read through the status index.
   */
  schedulable(): OwnedJob[] {
    const open = `status IN (${placeholders(openStatuses)})`;
    const finished = `status IN (${placeholders(terminalStatuses)})`;
    const rows = this.db
      .prepare(
        `SELECT rowid, created_at, record FROM studio_queue WHERE ${open}
        UNION SELECT rowid, created_at, record FROM studio_queue WHERE ${finished}
          AND created_at >= (SELECT MIN(created_at) FROM studio_queue WHERE ${open})`,
      )
      .all(...openStatuses, ...terminalStatuses, ...openStatuses);
    const jobs = new Map(rows.map((row) => [row, JSON.parse(row.record as string) as OwnedJob]));
    const sets = [
      ...new Set(
        [...jobs.values()]
          .filter((job) => job.queueSet && !terminalStatuses.has(job.status))
          .map((job) => job.queueSet!),
      ),
    ];
    if (sets.length) {
      const listed = new Set([...jobs.values()].map((job) => job.id));
      for (const row of this.db
        .prepare(
          `SELECT rowid, created_at, record FROM studio_queue WHERE ${finished}
          AND json_extract(record, '$.queueSet') IN (${placeholders(sets)})`,
        )
        .all(...terminalStatuses, ...sets)) {
        const job = JSON.parse(row.record as string) as OwnedJob;
        if (!listed.has(job.id)) jobs.set(row, job);
      }
    }
    return [...jobs]
      .sort(([a], [b]) =>
        a.created_at === b.created_at
          ? Number(a.rowid) - Number(b.rowid)
          : String(a.created_at) < String(b.created_at)
            ? -1
            : 1,
      )
      .map(([, job]) => job);
  }

  /** The owner's pending queue items that moves reorder: Dream's wait at their own tier. */
  movable(ownerId: string): OwnedJob[] {
    return this.openJobs(ownerId).filter(
      (job) => pendingStatuses.has(job.status) && job.priority !== queuePriority.dream,
    );
  }

  /**
   * Moves some of the owner's pending queue items (one, or a set's), together in their order, to
   * place `to` (from 0) among the owner's other pending items. The items trade their places in the
   * queue order (`created_at, rowid`), so other accounts' work keeps its place. Returns false when
   * an item is not one of the owner's pending items.
   */
  move(ownerId: string, ids: string[], to: number): boolean {
    const pending = this.movable(ownerId);
    const moving = new Set(ids);
    const block = pending.filter((job) => moving.has(job.id)).map((job) => job.id);
    if (!block.length || block.length !== moving.size) return false;
    const order = pending.map((job) => job.id).filter((id) => !moving.has(id));
    order.splice(Math.min(order.length, to), 0, ...block);
    if (order.every((id, index) => id === pending[index].id)) return true;
    const read = this.db.prepare("SELECT rowid, created_at FROM studio_queue WHERE id = ?");
    const places = pending.map((job) => read.get(job.id) as { rowid: number; created_at: string });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      // Rowids are unique, so negating them frees the places first.
      const free = this.db.prepare("UPDATE studio_queue SET rowid = -rowid WHERE id = ?");
      for (const jobId of order) free.run(jobId);
      const place = this.db.prepare(
        "UPDATE studio_queue SET rowid = ?, created_at = ? WHERE id = ?",
      );
      order.forEach((jobId, index) =>
        place.run(places[index].rowid, places[index].created_at, jobId),
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return true;
  }

  /** The owners whose pending work is held; `everyone` holds every account's. */
  pauses(): Set<string> {
    return new Set(
      this.db
        .prepare("SELECT owner_id FROM studio_queue_pauses")
        .all()
        .map((row) => row.owner_id as string),
    );
  }

  setPaused(ownerId: string, paused: boolean) {
    this.db
      .prepare(
        paused
          ? "INSERT OR IGNORE INTO studio_queue_pauses VALUES (?)"
          : "DELETE FROM studio_queue_pauses WHERE owner_id = ?",
      )
      .run(ownerId);
  }

  /** Every owner's failed jobs on a resource prefix updated since an ISO time, newest first. */
  failedJobs(resourcePrefix: string, since: string): OwnedJob[] {
    return this.db
      .prepare(
        "SELECT record FROM studio_queue WHERE status = 'failed' AND substr(json_extract(record, '$.resource'), 1, length(?)) = ? AND json_extract(record, '$.updatedAt') >= ? ORDER BY json_extract(record, '$.updatedAt') DESC",
      )
      .all(resourcePrefix, resourcePrefix, since)
      .map((row) => JSON.parse(row.record as string));
  }

  job(ownerId: string, id: string): OwnedJob | undefined {
    const row = this.db
      .prepare("SELECT record FROM studio_queue WHERE id = ? AND owner_id = ?")
      .get(id, ownerId);
    return row ? JSON.parse(row.record as string) : undefined;
  }

  /** Whether the owner's job is recorded and not yet completed, failed or cancelled. */
  unfinished(ownerId: string, id: string): boolean {
    const job = this.job(ownerId, id);
    return Boolean(job && !terminalStatuses.has(job.status));
  }

  save(job: OwnedJob): OwnedJob {
    const next = { ...job, updatedAt: now() };
    this.db
      .prepare("UPDATE studio_queue SET record = ?, status = ? WHERE id = ? AND owner_id = ?")
      .run(JSON.stringify(next), next.status, next.id, next.ownerId);
    return next;
  }

  close() {
    this.db.close();
  }

  /** A worker's stored observation, shared between callers: treat it as read-only. */
  workerModels(id: string, url: string): Record<string, any> | undefined {
    let kept = this.workerModelRecords.get(id);
    if (!kept) {
      const row = this.db
        .prepare("SELECT url, record FROM studio_worker_models WHERE id = ?")
        .get(id);
      if (!row) return undefined;
      kept = { url: row.url as string, record: JSON.parse(row.record as string) };
      this.workerModelRecords.set(id, kept);
    }
    return kept.url === url ? kept.record : undefined;
  }

  saveWorkerModels(id: string, url: string, models: Record<string, any>) {
    this.db
      .prepare(
        "INSERT INTO studio_worker_models VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET url = excluded.url, record = excluded.record",
      )
      .run(id, url, JSON.stringify(models));
    this.workerModelRecords.set(id, { url, record: models });
  }

  providerRecord<T>(ownerId: string, id: string): T | undefined {
    const row = this.db
      .prepare("SELECT record FROM studio_provider_jobs WHERE id = ? AND owner_id = ?")
      .get(id, ownerId);
    return row ? JSON.parse(row.record as string) : undefined;
  }

  saveProviderRecord(ownerId: string, id: string, record: unknown) {
    this.db
      .prepare(
        "INSERT INTO studio_provider_jobs VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record WHERE studio_provider_jobs.owner_id = excluded.owner_id",
      )
      .run(id, ownerId, JSON.stringify(record));
  }

  presets(ownerId: string): UserPreset[] {
    return this.db
      .prepare("SELECT record FROM studio_user_presets WHERE owner_id = ? ORDER BY rowid DESC")
      .all(ownerId)
      .map((row) => JSON.parse(row.record as string));
  }

  createPreset(
    ownerId: string,
    title: string,
    input: GenerationInput,
    parts?: string[],
  ): UserPreset {
    const preset = { id: randomUUID(), title, input, savedAt: now(), ...(parts ? { parts } : {}) };
    this.db
      .prepare("INSERT INTO studio_user_presets VALUES (?, ?, ?)")
      .run(preset.id, ownerId, JSON.stringify(preset));
    return preset;
  }

  deletePreset(ownerId: string, id: string): boolean {
    return (
      this.db
        .prepare("DELETE FROM studio_user_presets WHERE id = ? AND owner_id = ?")
        .run(id, ownerId).changes > 0
    );
  }

  updatePreset(
    ownerId: string,
    id: string,
    patch: { title?: string; input?: GenerationInput },
  ): UserPreset | undefined {
    const row = this.db
      .prepare("SELECT record FROM studio_user_presets WHERE id = ? AND owner_id = ?")
      .get(id, ownerId);
    if (!row) return;
    const preset = { ...JSON.parse(row.record as string), ...patch };
    this.db
      .prepare("UPDATE studio_user_presets SET record = ? WHERE id = ? AND owner_id = ?")
      .run(JSON.stringify(preset), id, ownerId);
    return preset;
  }
}

export function publicJob({
  ownerId: _ownerId,
  resource: _resource,
  cancelRequested: _cancelRequested,
  cleared: _cleared,
  priority,
  dream: _dream,
  faceRedo: _faceRedo,
  ...job
}: OwnedJob): QueueJob {
  return priority === queuePriority.dream ? { ...job, dream: true } : job;
}
