import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  GenerationInput,
  GenerationOperation,
  QueueJob,
  StudioSession,
} from "../../shared/queue.ts";
import type { DreamOrigin } from "./dream.ts";

/** Queue tiers on one resource, lower first; Dream's and finishing's background work run below MCP. */
export const queuePriority = { manual: 0, mcp: 1, dream: 2, finishing: 3 } as const;
/**
 * Where a job was admitted from: its tier, for an MCP call the set it was enqueued with, and for a
 * Dream job its prompt and note, which its gallery items carry until the person keeps them.
 */
export interface QueueOrigin {
  priority?: number;
  queueSet?: string;
  dream?: DreamOrigin;
}
export type OwnedJob = QueueJob &
  QueueOrigin & { ownerId: string; resource: string; cancelRequested?: boolean };
interface UserPreset {
  id: string;
  title: string;
  input: GenerationInput;
}
const now = () => new Date().toISOString();

export class RewriteStore {
  readonly db: DatabaseSync;

  constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS studio_worker_models (id TEXT PRIMARY KEY, url TEXT NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_sessions (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, updated_at TEXT NOT NULL, record TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS studio_sessions_owner ON studio_sessions(owner_id, updated_at);
      CREATE TABLE IF NOT EXISTS studio_queue (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES studio_sessions(id),
        created_at TEXT NOT NULL, status TEXT NOT NULL, record TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS studio_queue_owner ON studio_queue(owner_id, created_at);
      CREATE INDEX IF NOT EXISTS studio_queue_status ON studio_queue(status, created_at);
      CREATE TABLE IF NOT EXISTS studio_user_presets (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, record TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS studio_user_presets_owner ON studio_user_presets(owner_id);
      CREATE TABLE IF NOT EXISTS studio_provider_jobs (id TEXT PRIMARY KEY REFERENCES studio_queue(id), owner_id TEXT NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_chat_messages (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES studio_sessions(id), record TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS studio_chat_session ON studio_chat_messages(owner_id, session_id);`);
  }

  /** A `hidden` session (Dream's own) holds jobs but is never listed as a Chat. */
  createSession(
    ownerId: string,
    title = "New Chat",
    inputs: GenerationInput = {},
    hidden = false,
  ): StudioSession {
    const stamp = now();
    const session: StudioSession = {
      id: randomUUID(),
      title,
      inputs,
      createdAt: stamp,
      updatedAt: stamp,
      ...(hidden ? { hidden: true as const } : {}),
    };
    this.db
      .prepare("INSERT INTO studio_sessions VALUES (?, ?, ?, ?)")
      .run(session.id, ownerId, stamp, JSON.stringify(session));
    return session;
  }

  sessions(ownerId: string): StudioSession[] {
    return this.db
      .prepare("SELECT record FROM studio_sessions WHERE owner_id = ? ORDER BY updated_at DESC")
      .all(ownerId)
      .map((row) => JSON.parse(row.record as string) as StudioSession)
      .filter((session) => !session.hidden);
  }

  session(ownerId: string, id: string): StudioSession | undefined {
    const row = this.db
      .prepare("SELECT record FROM studio_sessions WHERE id = ? AND owner_id = ?")
      .get(id, ownerId);
    return row ? JSON.parse(row.record as string) : undefined;
  }

  updateSession(
    ownerId: string,
    id: string,
    patch: { title?: string; inputs?: GenerationInput },
  ): StudioSession | undefined {
    const session = this.session(ownerId, id);
    if (!session) return;
    // A title set here is the user's rename; generated titles never replace it.
    const next = {
      ...session,
      ...patch,
      ...(patch.title === undefined ? {} : { titleSource: "user" as const }),
      updatedAt: now(),
    };
    this.db
      .prepare(
        "UPDATE studio_sessions SET record = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
      )
      .run(JSON.stringify(next), next.updatedAt, id, ownerId);
    return next;
  }

  /** Work that must finish or be cancelled before the chat can be deleted. */
  sessionActivity(ownerId: string, id: string): "active-jobs" | "active-chat" | undefined {
    const row = this.db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM studio_queue WHERE owner_id = ?1 AND session_id = ?2 AND status NOT IN ('completed', 'failed', 'cancelled')) AS jobs,
          (SELECT COUNT(*) FROM studio_chat_messages WHERE owner_id = ?1 AND session_id = ?2 AND json_extract(record, '$.status') = 'streaming') AS chat`,
      )
      .get(ownerId, id)!;
    return Number(row.jobs) ? "active-jobs" : Number(row.chat) ? "active-chat" : undefined;
  }

  /** Removes a chat with its messages and job records; its results stay in the gallery. */
  deleteSession(
    ownerId: string,
    id: string,
  ): "deleted" | "missing" | "active-jobs" | "active-chat" {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      let outcome: ReturnType<RewriteStore["deleteSession"]> = "deleted";
      const activity = this.sessionActivity(ownerId, id);
      if (!this.session(ownerId, id)) outcome = "missing";
      else if (activity) outcome = activity;
      else {
        this.db
          .prepare(
            "DELETE FROM studio_provider_jobs WHERE id IN (SELECT id FROM studio_queue WHERE owner_id = ? AND session_id = ?)",
          )
          .run(ownerId, id);
        for (const table of ["studio_queue", "studio_chat_messages"])
          this.db
            .prepare(`DELETE FROM ${table} WHERE owner_id = ? AND session_id = ?`)
            .run(ownerId, id);
        this.db
          .prepare("DELETE FROM studio_sessions WHERE id = ? AND owner_id = ?")
          .run(id, ownerId);
      }
      this.db.exec("COMMIT");
      return outcome;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  enqueue(
    ownerId: string,
    sessionId: string,
    input: GenerationInput,
    operation: GenerationOperation,
    parentJobId?: string,
    resource = "local-media",
    requestedId?: string,
    jobLimit?: number,
    origin: QueueOrigin = {},
  ): OwnedJob {
    if (!this.session(ownerId, sessionId)) throw new Error("Session not found.");
    if (parentJobId && !this.job(ownerId, parentJobId))
      throw new Error("Parent generation not found.");
    if (jobLimit !== undefined) {
      const row = this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM studio_queue WHERE owner_id = ? AND status NOT IN ('completed', 'failed', 'cancelled') AND COALESCE(json_extract(record, '$.priority'), 0) < ?",
        )
        .get(ownerId, queuePriority.dream)!;
      if (Number(row.count) >= jobLimit)
        throw Object.assign(new Error(`You can have up to ${jobLimit} outstanding jobs.`), {
          status: 429,
          reason: "job-limit",
        });
    }
    const stamp = now();
    const id = requestedId || randomUUID();
    const jobResource = resource.startsWith("provider:cliproxyapi")
      ? `provider:cliproxyapi:${id}`
      : resource;
    const backend = /^(worker|cloud):/.test(resource)
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
      operation,
      priority: origin.priority ?? queuePriority.manual,
      queueSet: origin.queueSet,
      ...(origin.dream ? { dream: origin.dream } : {}),
      status: "queued",
      reason: "",
      input: { ...input, clientJobId: id },
      items: [],
      outputs: [],
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("INSERT INTO studio_queue VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, ownerId, sessionId, stamp, job.status, JSON.stringify(job));
      this.updateSession(ownerId, sessionId, operation === "upscale" ? {} : { inputs: input });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
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

  job(ownerId: string, id: string): OwnedJob | undefined {
    const row = this.db
      .prepare("SELECT record FROM studio_queue WHERE id = ? AND owner_id = ?")
      .get(id, ownerId);
    return row ? JSON.parse(row.record as string) : undefined;
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

  workerModels(id: string, url: string): Record<string, any> | undefined {
    const row = this.db
      .prepare("SELECT record FROM studio_worker_models WHERE id = ? AND url = ?")
      .get(id, url);
    return row ? JSON.parse(row.record as string) : undefined;
  }

  saveWorkerModels(id: string, url: string, models: unknown) {
    this.db
      .prepare(
        "INSERT INTO studio_worker_models VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET url = excluded.url, record = excluded.record",
      )
      .run(id, url, JSON.stringify(models));
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

  createPreset(ownerId: string, title: string, input: GenerationInput): UserPreset {
    const preset = { id: randomUUID(), title, input };
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
  priority: _priority,
  queueSet: _queueSet,
  dream: _dream,
  ...job
}: OwnedJob): QueueJob {
  return job;
}
