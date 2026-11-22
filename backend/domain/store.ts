import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type {
  GenerationInput,
  GenerationOperation,
  QueueJob,
  StudioSession,
} from "../../shared/queue.ts";
import {
  activeStatuses,
  awaitsWriting,
  pendingStatuses,
  terminalStatuses,
} from "../../shared/queue.ts";
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
  /** The first job of one prompt's Count, when its outputs need separate provider runs. */
  queueBatch?: string;
  /** The owner's exact source result, checked by the admitting caller. */
  parentItemId?: string;
  dream?: DreamOrigin;
  faceRedo?: true;
  galleryAt?: string;
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
    replacementJobId?: string;
    /** Radiance refused to load this job until its pod frees host memory. */
    memoryRecovery?: string;
    /** Queued again automatically after its first run failed (queue.ts `again`); it isn't again. */
    retried?: true;
    /** When the scheduler admitted the job and when Studio first began saving its results. */
    admittedAt?: number;
    savingAt?: number;
  };
/** One job of a request, as `Store.enqueueAll` queues it. */
export interface QueuedCopy {
  input: GenerationInput;
  operation: GenerationOperation;
  parentJobId?: string;
  resource?: string;
  requestedId?: string;
  origin?: QueueOrigin;
  replaces?: { id: string; clear?: boolean; automatic?: boolean };
}
interface UserPreset {
  id: string;
  title: string;
  input: GenerationInput;
  /** Presets saved before dates were kept have none. */
  savedAt?: string;
  /** The parts of a draft it holds, when only some; one without holds them all. */
  parts?: string[];
  /** The model family its LoRAs were chosen for, which the LoRA picker lists it under. */
  family?: string;
}
const now = () => new Date().toISOString();
/** The pause key that holds every account's queue. */
export const everyone = "*";
/** Not yet done: pending, or handed to a provider. */
const openStatuses = [...pendingStatuses, ...activeStatuses];
const jobPriority = "json_extract(record, '$.priority')";
const dreamPriority = `${jobPriority} = ${queuePriority.dream}`;
const pendingMemoryRecovery = `status = 'failed'
  AND json_extract(record, '$.memoryRecovery') IS NOT NULL
  AND json_extract(record, '$.cleared') IS NULL`;
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
      CREATE INDEX IF NOT EXISTS studio_queue_memory_recovery ON studio_queue(id)
        WHERE ${pendingMemoryRecovery};
      CREATE INDEX IF NOT EXISTS studio_queue_session ON studio_queue(session_id, created_at);
      CREATE INDEX IF NOT EXISTS studio_queue_set ON studio_queue(json_extract(record, '$.queueSet'));
      CREATE INDEX IF NOT EXISTS studio_queue_priority ON studio_queue(status, ${jobPriority});
      CREATE INDEX IF NOT EXISTS studio_queue_dream_recent ON studio_queue(owner_id, created_at) WHERE ${dreamPriority};
      CREATE TABLE IF NOT EXISTS studio_queue_pauses (owner_id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS studio_user_presets (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, record TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS studio_user_presets_owner ON studio_user_presets(owner_id);
      CREATE TABLE IF NOT EXISTS studio_provider_jobs (id TEXT PRIMARY KEY REFERENCES studio_queue(id), owner_id TEXT NOT NULL, record TEXT NOT NULL);`);
    // Gallery seed selection and recent profile counts query jobs without loading their records.
    const columns = this.db
      .prepare("SELECT name FROM pragma_table_xinfo('studio_queue')")
      .all()
      .map((row) => row.name);
    if (!columns.includes("profile_id"))
      this.db.exec(
        "ALTER TABLE studio_queue ADD COLUMN profile_id GENERATED ALWAYS AS (json_extract(record, '$.input.profileId')) VIRTUAL",
      );
    if (!columns.includes("prompted"))
      this.db.exec(
        "ALTER TABLE studio_queue ADD COLUMN prompted GENERATED ALWAYS AS (trim(coalesce(json_extract(record, '$.input.prompt'), '')) != '') VIRTUAL",
      );
    this.db.exec(
      "DROP INDEX IF EXISTS studio_queue_prompted; CREATE INDEX IF NOT EXISTS studio_queue_profile ON studio_queue(owner_id, profile_id, created_at, status)",
    );
  }

  /** A session holds the jobs of one request or run of requests, such as an MCP conversation's. */
  createSession(
    ownerId: string,
    title = "",
    marks: Pick<StudioSession, "mcp"> = {},
  ): StudioSession {
    const stamp = now();
    const session: StudioSession = {
      id: randomUUID(),
      title,
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
  mcpSession(ownerId: string, title: string, conversationId = ""): StudioSession {
    if (!conversationId) return this.createSession(ownerId, title);
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
    if (!earlier) return this.createSession(ownerId, title, { mcp: { conversationId } });
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
    replaces?: QueuedCopy["replaces"],
  ): OwnedJob {
    return this.enqueueAll(ownerId, () => sessionId, [
      { input, operation, parentJobId, resource, requestedId, origin, replaces },
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
        ({
          input,
          operation,
          parentJobId,
          resource = "local-media",
          requestedId,
          origin = {},
          replaces,
        }) => {
          const original = replaces && this.job(ownerId, replaces.id);
          if (replaces && original?.status !== "failed") throw new Error("Failed job not found.");
          if (original?.replacementJobId) {
            if (replaces?.clear && !original.cleared) this.save({ ...original, cleared: true });
            return this.job(ownerId, original.replacementJobId)!;
          }
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
            ...(origin.queueBatch ? { queueBatch: origin.queueBatch } : {}),
            ...(origin.dream ? { dream: origin.dream } : {}),
            ...(origin.faceRedo ? { faceRedo: origin.faceRedo } : {}),
            ...(origin.galleryAt ? { galleryAt: origin.galleryAt } : {}),
            ...(replaces?.automatic ? { retried: true } : {}),
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
          if (original)
            this.save({
              ...original,
              memoryRecovery: undefined,
              replacementJobId: id,
              ...(replaces?.clear ? { cleared: true } : {}),
            });
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

  /**
   * Unfinished jobs, optionally one owner's, in queue order: read through the status index, named
   * because the gathered statistics average its few open jobs with the many finished ones.
   */
  openJobs(ownerId?: string): OwnedJob[] {
    return this.db
      .prepare(
        `SELECT record FROM studio_queue INDEXED BY studio_queue_status WHERE status IN (${placeholders(openStatuses)})${ownerId === undefined ? "" : " AND owner_id = ?"} ORDER BY created_at, rowid`,
      )
      .all(...openStatuses, ...(ownerId === undefined ? [] : [ownerId]))
      .map((row) => JSON.parse(row.record as string));
  }

  /** The last started job per resource, for restoring its loaded model and LoRAs on restart. */
  loadedJobs(): OwnedJob[] {
    return this.db
      .prepare(
        `SELECT record FROM studio_queue WHERE rowid IN (
          SELECT job_rowid FROM (
            SELECT rowid AS job_rowid, row_number() OVER (
              PARTITION BY json_extract(record, '$.resource')
              ORDER BY json_extract(record, '$.updatedAt') DESC, created_at DESC, rowid DESC
            ) AS position FROM studio_queue WHERE status NOT IN (${placeholders(pendingStatuses)}, 'cancelled')
          ) WHERE position = 1
        )`,
      )
      .all(...pendingStatuses)
      .map((row) => JSON.parse(row.record as string));
  }

  /** Journal the confirmed provider failure before it is published to the in-memory adapter. */
  rememberMemoryFailure(ownerId: string, id: string, reason: string) {
    const job = this.job(ownerId, id);
    if (job && !terminalStatuses.has(job.status) && !job.cancelRequested && !job.retried)
      this.save({ ...job, memoryRecovery: reason });
  }

  pendingMemoryRecoveries(): OwnedJob[] {
    return this.db
      .prepare(
        `SELECT record FROM studio_queue INDEXED BY studio_queue_memory_recovery
         WHERE ${pendingMemoryRecovery}`,
      )
      .all()
      .map((row) => JSON.parse(row.record as string));
  }

  /** Whether any unfinished job is someone's own work, not Dream's, read from the priority index alone. */
  hasOpenOwnWork(waiting = false): boolean {
    const statuses = waiting ? pendingStatuses : openStatuses;
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM studio_queue INDEXED BY studio_queue_priority WHERE status IN (${placeholders(statuses)}) AND ${jobPriority} IS NOT ${queuePriority.dream} LIMIT 1`,
        )
        .get(...statuses),
    );
  }

  /** An admitted generation the account requested after the cutoff, including finished work. */
  hasRecentGenerationRequest(ownerId: string, cutoff: string): boolean {
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM studio_queue
          WHERE owner_id = ? AND created_at > ?
            AND ${jobPriority} IN (${queuePriority.manual}, ${queuePriority.mcp})
            AND json_extract(record, '$.operation') IS NOT 'upscale'
            AND json_extract(record, '$.faceRedo') IS NOT 1
            AND json_extract(record, '$.retried') IS NOT 1
          LIMIT 1`,
        )
        .get(ownerId, cutoff),
    );
  }

  /** Open Dream work, without loading prompts, outputs or other accounts' own work. */
  openDreamJobs(ownerId?: string, waiting = false) {
    const statuses = waiting ? pendingStatuses : openStatuses;
    return this.db
      .prepare(
        `SELECT id, owner_id AS ownerId,
          json_extract(record, '$.resource') AS resource,
          json_extract(record, '$.input.kind') AS kind,
          json_extract(record, '$.input.type') AS type,
          json_extract(record, '$.dream.projectId') AS projectId,
          json_extract(record, '$.dream.pair.id') AS pairId,
          json_extract(record, '$.dream.draft') AS draft
        FROM studio_queue INDEXED BY studio_queue_priority
        WHERE status IN (${placeholders(statuses)}) AND ${dreamPriority}${ownerId === undefined ? "" : " AND owner_id = ?"}
        ORDER BY created_at, rowid`,
      )
      .all(...statuses, ...(ownerId === undefined ? [] : [ownerId])) as {
      id: string;
      ownerId: string;
      resource: string;
      kind: string | null;
      type: string | null;
      projectId: string | null;
      pairId: string | null;
      draft: string | null;
    }[];
  }

  hasWritingJobs(): boolean {
    return Boolean(
      this.db.prepare("SELECT 1 FROM studio_queue WHERE status = 'writing' LIMIT 1").get(),
    );
  }

  /** Reads a seed's input without transferring the job's saved media records. */
  jobInput(ownerId: string, id: string): GenerationInput | undefined {
    const row = this.db
      .prepare(
        "SELECT json_extract(record, '$.input') AS input FROM studio_queue WHERE id = ? AND owner_id = ?",
      )
      .get(id, ownerId);
    return row ? JSON.parse(row.input as string) : undefined;
  }

  /** Recent Dream jobs, in queue order, with only the fields its scheduler uses. */
  dreamJobsSince(ownerId: string, since: string) {
    return this.db
      .prepare(
        `SELECT id, created_at AS createdAt, status, profile_id AS profileId,
          json_extract(record, '$.dream.at') AS dreamAt,
          json_extract(record, '$.input.kind') AS kind,
          json_extract(record, '$.input.type') AS type,
          CASE WHEN json_type(record, '$.input.loras') = 'array'
            THEN json_extract(record, '$.input.loras') END AS loras,
          json_type(record, '$.input.writing') IN ('object', 'array')
            AND json_type(record, '$.input.writing.prompt') IS NOT 'text' AS awaitsWriting
        FROM studio_queue WHERE owner_id = ? AND created_at >= ? AND ${dreamPriority}
        ORDER BY created_at, rowid`,
      )
      .all(ownerId, since) as {
      id: string;
      createdAt: string;
      status: string;
      profileId: string | null;
      dreamAt: string | null;
      kind: string | null;
      type: string | null;
      loras: string | null;
      awaitsWriting: number | null;
    }[];
  }

  /**
   * The owner's queue as it lists, in queue order: every unfinished job, every failed one not
   * cleared, and the newest `listedFinishedJobs` of the rest. Nothing is deleted: an older job
   * stays readable by its ID. With `results` false, records leave out their `items` and
   * `outputs`, which copy each result's gallery record twice over.
   */
  queueJobs(ownerId: string, { results = true } = {}): OwnedJob[] {
    return this.db
      .prepare(
        `SELECT ${results ? "record" : "json_remove(record, '$.items', '$.outputs') AS record"}
        FROM studio_queue WHERE rowid IN (
          SELECT rowid FROM studio_queue INDEXED BY studio_queue_status
            WHERE status IN (${placeholders(openStatuses)}) AND owner_id = ?
          UNION ALL
          SELECT rowid FROM studio_queue INDEXED BY studio_queue_status
            WHERE status = 'failed' AND owner_id = ? AND json_extract(record, '$.cleared') IS NULL
          UNION ALL
          SELECT rowid FROM (
            SELECT rowid FROM studio_queue INDEXED BY studio_queue_owner
              WHERE owner_id = ? AND status IN (${placeholders(terminalStatuses)})
              ORDER BY created_at DESC, rowid DESC LIMIT ?
          )
        ) ORDER BY created_at, rowid`,
      )
      .all(...openStatuses, ownerId, ownerId, ownerId, ...terminalStatuses, listedFinishedJobs)
      .map((row) => JSON.parse(row.record as string));
  }

  /** Some completed members may have aged out of the queue listing. */
  clearableFailedSets(ownerId: string, sets: string[]): string[] {
    if (!sets.length) return [];
    return this.db
      .prepare(
        `SELECT json_extract(record, '$.queueSet') AS set_id FROM studio_queue INDEXED BY studio_queue_set
          WHERE owner_id = ? AND json_extract(record, '$.queueSet') IN (SELECT value FROM json_each(?))
          GROUP BY set_id
          HAVING count(*) FILTER (WHERE status NOT IN ('failed', 'cancelled')) = 0
            AND count(*) FILTER (WHERE status = 'failed' AND json_extract(record, '$.cleared') IS NULL) > 0`,
      )
      .all(ownerId, JSON.stringify(sets))
      .map((row) => String(row.set_id));
  }

  failedSetJobs(ownerId: string, set: string): OwnedJob[] {
    return this.db
      .prepare(
        `SELECT record FROM studio_queue INDEXED BY studio_queue_set
          WHERE owner_id = ? AND json_extract(record, '$.queueSet') = ?
          AND status = 'failed' AND json_extract(record, '$.cleared') IS NULL`,
      )
      .all(ownerId, set)
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

  /** Counts recent uses of each candidate and distinguishes it from one never used. */
  profileRuns(ownerId: string, since: string, profiles: string[]): Map<string, number> {
    const recent = this.db.prepare(
      "SELECT count(*) AS count FROM studio_queue WHERE owner_id = ? AND profile_id = ? AND created_at >= ? AND status != 'cancelled'",
    );
    const earlier = this.db.prepare(
      "SELECT 1 FROM studio_queue WHERE owner_id = ? AND profile_id = ? AND status != 'cancelled' LIMIT 1",
    );
    const runs = new Map<string, number>();
    for (const profile of profiles) {
      const count = Number(recent.get(ownerId, profile, since)?.count);
      if (count || earlier.get(ownerId, profile)) runs.set(profile, count);
    }
    return runs;
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

  /**
   * What a scheduler tick weighs, in queue order: every unfinished job, and the finished ones it
   * still counts. Those are, for each resource and tier with work queued or waiting, the newest
   * `overtakes` that started since its oldest such job (enough to tell whether that job was
   * overtaken so often), and those in an unfinished job's set (a started set keeps its place).
   * Read through the status and set indexes, so a job left waiting does not make each tick read
   * every job finished since.
   */
  schedulable(overtakes: number): OwnedJob[] {
    type Row = { rowid: unknown; created_at: unknown; record: unknown };
    const finished = `status IN (${placeholders(terminalStatuses)})`;
    const rows = new Map<string, Row>();
    const jobs = new Map<string, OwnedJob>();
    const add = (row: Row) => {
      const job = JSON.parse(row.record as string) as OwnedJob;
      if (jobs.has(job.id)) return;
      rows.set(job.id, row);
      jobs.set(job.id, job);
    };
    for (const row of this.db
      .prepare(
        `SELECT rowid, created_at, record FROM studio_queue INDEXED BY studio_queue_status WHERE status IN (${placeholders(openStatuses)})`,
      )
      .all(...openStatuses) as Row[])
      add(row);
    const oldest = new Map<string, { resource: string; tier: number; since: string }>();
    for (const job of jobs.values()) {
      if (job.status !== "queued" && job.status !== "waiting") continue;
      const tier = job.priority ?? queuePriority.manual;
      const key = JSON.stringify([job.resource, tier]);
      const since = String(rows.get(job.id)!.created_at);
      if (!oldest.has(key) || since < oldest.get(key)!.since)
        oldest.set(key, { resource: job.resource, tier, since });
    }
    // A cancelled job never started, so it overtook nothing.
    const startedFinished = [...terminalStatuses].filter((status) => status !== "cancelled");
    const later = this.db.prepare(
      `SELECT rowid, created_at, record FROM studio_queue WHERE status IN (${placeholders(startedFinished)})
        AND created_at >= ? AND json_extract(record, '$.resource') = ?
        AND COALESCE(json_extract(record, '$.priority'), ${queuePriority.manual}) = ?
        ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    );
    for (const { resource, tier, since } of oldest.values())
      for (const row of later.all(...startedFinished, since, resource, tier, overtakes) as Row[])
        add(row);
    const sets = [
      ...new Set(
        [...jobs.values()]
          .filter((job) => job.queueSet && !terminalStatuses.has(job.status))
          .map((job) => job.queueSet!),
      ),
    ];
    if (sets.length)
      for (const row of this.db
        .prepare(
          `SELECT rowid, created_at, record FROM studio_queue
          WHERE json_extract(record, '$.queueSet') IN (${placeholders(sets)}) AND ${finished}`,
        )
        .all(...sets, ...terminalStatuses) as Row[])
        add(row);
    return [...jobs.values()].sort((left, right) => {
      const a = rows.get(left.id)!;
      const b = rows.get(right.id)!;
      return a.created_at === b.created_at
        ? Number(a.rowid) - Number(b.rowid)
        : String(a.created_at) < String(b.created_at)
          ? -1
          : 1;
    });
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

  /**
   * A worker's stored observation, shared between callers: treat it as read-only. With `url`, only
   * one observed at that address.
   */
  workerModels(id: string, url?: string): Record<string, any> | undefined {
    let kept = this.workerModelRecords.get(id);
    if (!kept) {
      const row = this.db
        .prepare("SELECT url, record FROM studio_worker_models WHERE id = ?")
        .get(id);
      if (!row) return undefined;
      kept = { url: row.url as string, record: JSON.parse(row.record as string) };
      this.workerModelRecords.set(id, kept);
    }
    return url === undefined || kept.url === url ? kept.record : undefined;
  }

  saveWorkerModels(id: string, url: string, models: Record<string, any>) {
    this.db
      .prepare(
        `INSERT INTO studio_worker_models VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET url = excluded.url, record = excluded.record
        WHERE studio_worker_models.url <> excluded.url OR studio_worker_models.record <> excluded.record`,
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
    family?: string,
  ): UserPreset {
    const preset = {
      id: randomUUID(),
      title,
      input,
      savedAt: now(),
      ...(parts ? { parts } : {}),
      ...(family ? { family } : {}),
    };
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
  cancelRequested,
  cleared: _cleared,
  replacementJobId: _replacementJobId,
  memoryRecovery: _memoryRecovery,
  admittedAt: _admittedAt,
  savingAt: _savingAt,
  priority,
  dream: _dream,
  faceRedo: _faceRedo,
  input: { clientJobId: _clientJobId, ...input },
  ...job
}: OwnedJob): QueueJob {
  // Its idempotency key would make a run reusing this input return this job instead of queuing.
  return {
    ...job,
    input,
    ...(cancelRequested && activeStatuses.has(job.status) && job.status !== "saving"
      ? { cancelling: true }
      : {}),
    ...(priority === queuePriority.dream ? { dream: true } : {}),
  };
}
