import type { DatabaseSync } from "node:sqlite";

/** A gallery item as numbering reads it: one output of a job. */
export interface Numbered {
  jobId?: string;
  index?: number;
  ownerId?: string;
  createdAt?: string;
  number?: number;
}
interface Row {
  number: number;
  job_id: string;
  output_index: number;
}

const createTable =
  "CREATE TABLE IF NOT EXISTS studio_result_numbers (owner_id TEXT NOT NULL, number INTEGER NOT NULL, job_id TEXT NOT NULL, output_index INTEGER NOT NULL, PRIMARY KEY (owner_id, number), UNIQUE (owner_id, job_id, output_index))";

const key = (jobId: string, index: number) => `${jobId}\n${index}`;
const outputIndex = (item: Numbered) => (Number.isInteger(item.index) ? item.index! : 0);
const time = (item: Numbered) => Date.parse(item.createdAt || "") || 0;

/**
 * Each account's results numbered #1, #2… in the order they were made, so a chat and Studio name a
 * result alike. A number belongs to one output of one job for good and is never reused. Numbers are
 * given lazily: an account's first numbered result numbers everything it already has, oldest first
 * (`existing`), and later results take the next number when first shown or queued.
 */
export function createResultNumbers({
  db,
  existing,
}: {
  db: DatabaseSync;
  /** The owner's gallery items, for its first numbering. */
  existing(ownerId: string): Numbered[];
}) {
  db.exec(createTable);
  const owners = new Map<string, { byKey: Map<string, number>; next: number }>();
  const insert = db.prepare(
    "INSERT INTO studio_result_numbers (owner_id, number, job_id, output_index) VALUES (?, ?, ?, ?)",
  );
  function assign(
    ownerId: string,
    entry: { byKey: Map<string, number>; next: number },
    items: Numbered[],
  ) {
    const fresh = new Map<string, Numbered>();
    for (const item of items) {
      const id = key(item.jobId!, outputIndex(item));
      if (!entry.byKey.has(id) && !fresh.has(id)) fresh.set(id, item);
    }
    if (!fresh.size) return;
    const ordered = [...fresh.values()].sort(
      (a, b) => time(a) - time(b) || outputIndex(a) - outputIndex(b),
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const item of ordered) {
        insert.run(ownerId, entry.next, item.jobId!, outputIndex(item));
        entry.byKey.set(key(item.jobId!, outputIndex(item)), entry.next++);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      owners.delete(ownerId);
      throw error;
    }
  }
  function load(ownerId: string) {
    let entry = owners.get(ownerId);
    if (entry) return entry;
    const rows = db
      .prepare("SELECT number, job_id, output_index FROM studio_result_numbers WHERE owner_id = ?")
      .all(ownerId) as unknown as Row[];
    entry = {
      byKey: new Map(rows.map((row) => [key(row.job_id, row.output_index), row.number])),
      next: Math.max(0, ...rows.map((row) => row.number)) + 1,
    };
    owners.set(ownerId, entry);
    if (!rows.length)
      assign(
        ownerId,
        entry,
        existing(ownerId).filter((item) => item.jobId),
      );
    return entry;
  }
  return {
    /** The items with their numbers, numbering any that have none; items without a job have none. */
    numbered<T extends Numbered>(items: T[]): (T & { number?: number })[] {
      const byOwner = new Map<string, T[]>();
      for (const item of items)
        if (item.jobId) {
          const ownerId = item.ownerId || "";
          byOwner.set(ownerId, [...(byOwner.get(ownerId) || []), item]);
        }
      for (const [ownerId, list] of byOwner) assign(ownerId, load(ownerId), list);
      return items.map((item) => {
        const number =
          item.jobId &&
          owners.get(item.ownerId || "")?.byKey.get(key(item.jobId, outputIndex(item)));
        return number ? { ...item, number } : item;
      });
    },
    /** The job output an owner's number names, or null. */
    find(ownerId: string, number: number) {
      load(ownerId);
      const row = db
        .prepare(
          "SELECT number, job_id, output_index FROM studio_result_numbers WHERE owner_id = ? AND number = ?",
        )
        .get(ownerId, number) as Row | undefined;
      return row ? { jobId: row.job_id, index: row.output_index } : null;
    },
  };
}
export type ResultNumbers = ReturnType<typeof createResultNumbers>;
