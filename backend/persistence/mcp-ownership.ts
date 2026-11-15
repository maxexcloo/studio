import type { DatabaseSync } from "node:sqlite";

/**
 * A short result link: one output (`index`) or a job's watch page (`page`), a conversation's All
 * Results (`all`, `scope`) or a run's contact sheet (`sheet`, [jobId, index] pairs).
 */
interface McpLink {
  audience: string;
  owner: string;
  jobId?: string;
  index?: number;
  page?: boolean;
  all?: boolean;
  scope?: string;
  sheet?: [string, number][];
}

/** The key a link is reused by: the same output, page, conversation or sheet for the same owner. */
export const mcpLinkKey = (audience: string, owner: string, target: string, index?: unknown) =>
  JSON.stringify([audience, owner, target, index ?? "page"]);

export const linkKeyOf = (link: McpLink) =>
  link.all
    ? mcpLinkKey(link.audience, link.owner, `refs:${link.scope}`, "all")
    : link.sheet
      ? mcpLinkKey(link.audience, link.owner, `sheet:${JSON.stringify(link.sheet)}`, "sheet")
      : mcpLinkKey(link.audience, link.owner, link.jobId!, link.index);

/**
 * MCP's records, a row per change: each job's and reference's MCP owner, each conversation's
 * results in order (`refs`), its sets in order (`sets`, see `ChatSet`) and its latest lettered options, Studio's result numbers by output,
 * short links (several ids may share a key), the request behind each job and the asset each upload
 * link's image became.
 */
export const createMcpTables = `CREATE TABLE IF NOT EXISTS studio_mcp_jobs (job_id TEXT PRIMARY KEY, owner TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS studio_mcp_assets (asset_id TEXT NOT NULL, owner TEXT NOT NULL, PRIMARY KEY (asset_id, owner));
  CREATE TABLE IF NOT EXISTS studio_mcp_refs (scope TEXT NOT NULL, number INTEGER NOT NULL, job_id TEXT NOT NULL, PRIMARY KEY (scope, number));
  CREATE INDEX IF NOT EXISTS studio_mcp_refs_job ON studio_mcp_refs (scope, job_id);
  CREATE TABLE IF NOT EXISTS studio_mcp_sets (scope TEXT NOT NULL, number INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY (scope, number));
  CREATE TABLE IF NOT EXISTS studio_mcp_offers (scope TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS studio_mcp_numbers (job_id TEXT NOT NULL, output INTEGER NOT NULL, number INTEGER NOT NULL, PRIMARY KEY (job_id, output));
  CREATE INDEX IF NOT EXISTS studio_mcp_numbers_number ON studio_mcp_numbers (number);
  CREATE TABLE IF NOT EXISTS studio_mcp_links (id TEXT PRIMARY KEY, key TEXT NOT NULL, value TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS studio_mcp_links_key ON studio_mcp_links (key);
  CREATE TABLE IF NOT EXISTS studio_mcp_prompts (job_id TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS studio_mcp_uploads (reference TEXT PRIMARY KEY, asset_id TEXT NOT NULL);`;

export interface Offer {
  comparison: string;
  jobs: string[];
  picked?: string;
}

/**
 * A conversation's set: one generate call, a set rerun or a comparison. Each plan is one model's
 * submission (its generate arguments without prompts) and its jobs, in order, with the prompt each
 * ran (`prompt`, an index into `prompts`) and how many images it makes.
 */
export interface ChatSet {
  plans: {
    args: Record<string, unknown>;
    prompts: string[];
    jobs: { id: string; prompt: number; images: number }[];
  }[];
}

type Row = Record<string, string | number> | undefined;

export function mcpOwnership(db: DatabaseSync) {
  db.exec(createMcpTables);
  const prepared = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
  const run = (sql: string) => {
    let statement = prepared.get(sql);
    if (!statement) prepared.set(sql, (statement = db.prepare(sql)));
    return statement;
  };
  const get = (sql: string, ...values: (string | number)[]) => run(sql).get(...values) as Row;
  const json = (row: Row) => (row ? JSON.parse(String(row.value)) : undefined);
  return {
    /** Runs `write` as one commit. */
    batch(write: () => void) {
      db.exec("BEGIN IMMEDIATE");
      try {
        write();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    jobOwner: (jobId: string) =>
      get("SELECT owner FROM studio_mcp_jobs WHERE job_id = ?", jobId)?.owner as string | undefined,
    setJobOwner(jobId: string, owner: string) {
      run(
        "INSERT INTO studio_mcp_jobs (job_id, owner) VALUES (?, ?) ON CONFLICT(job_id) DO UPDATE SET owner = excluded.owner",
      ).run(jobId, owner);
    },
    assetOwners: (assetId: string) =>
      (
        run("SELECT owner FROM studio_mcp_assets WHERE asset_id = ?").all(assetId) as {
          owner: string;
        }[]
      ).map((row) => row.owner),
    addAssetOwner(assetId: string, owner: string) {
      run("INSERT OR IGNORE INTO studio_mcp_assets (asset_id, owner) VALUES (?, ?)").run(
        assetId,
        owner,
      );
    },
    /** The job's number among the scope's results, if it is one. */
    refNumber: (scope: string, jobId: string) =>
      get("SELECT number FROM studio_mcp_refs WHERE scope = ? AND job_id = ?", scope, jobId)
        ?.number as number | undefined,
    /** Adds the job as the scope's next result; a number is never reused. */
    addRef: (scope: string, jobId: string) =>
      get(
        "INSERT INTO studio_mcp_refs (scope, number, job_id) SELECT ?, coalesce(max(number), 0) + 1, ? FROM studio_mcp_refs WHERE scope = ? RETURNING number",
        scope,
        jobId,
        scope,
      )!.number as number,
    refJob: (scope: string, number: number) =>
      get("SELECT job_id FROM studio_mcp_refs WHERE scope = ? AND number = ?", scope, number)
        ?.job_id as string | undefined,
    /** The scope's latest `limit` results, oldest first. */
    latestRefs: (scope: string, limit: number) =>
      (
        run(
          "SELECT number, job_id AS jobId FROM studio_mcp_refs WHERE scope = ? ORDER BY number DESC LIMIT ?",
        ).all(scope, limit) as { number: number; jobId: string }[]
      ).reverse(),
    /** Adds the scope's next set; a number is never reused. */
    addSet: (scope: string, set: ChatSet) =>
      get(
        "INSERT INTO studio_mcp_sets (scope, number, value) SELECT ?, coalesce(max(number), 0) + 1, ? FROM studio_mcp_sets WHERE scope = ? RETURNING number",
        scope,
        JSON.stringify(set),
        scope,
      )!.number as number,
    chatSet: (scope: string, number: number) =>
      json(
        get("SELECT value FROM studio_mcp_sets WHERE scope = ? AND number = ?", scope, number),
      ) as ChatSet | undefined,
    offer: (scope: string) =>
      json(get("SELECT value FROM studio_mcp_offers WHERE scope = ?", scope)) as Offer | undefined,
    setOffer(scope: string, offer: Offer) {
      run(
        "INSERT INTO studio_mcp_offers (scope, value) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET value = excluded.value",
      ).run(scope, JSON.stringify(offer));
    },
    number: (jobId: string, index: number) =>
      get("SELECT number FROM studio_mcp_numbers WHERE job_id = ? AND output = ?", jobId, index)
        ?.number as number | undefined,
    setNumber(jobId: string, index: number, number: number) {
      run(
        "INSERT INTO studio_mcp_numbers (job_id, output, number) VALUES (?, ?, ?) ON CONFLICT(job_id, output) DO UPDATE SET number = excluded.number",
      ).run(jobId, index, number);
    },
    /** The owner's job output Studio gave this number, if one is known. */
    numbered(owner: string, number: number) {
      const row = get(
        "SELECT n.job_id, n.output FROM studio_mcp_numbers AS n JOIN studio_mcp_jobs AS j ON j.job_id = n.job_id WHERE n.number = ? AND j.owner = ? ORDER BY n.output LIMIT 1",
        number,
        owner,
      );
      return row && { jobId: String(row.job_id), index: Number(row.output) };
    },
    link: (id: string) =>
      json(get("SELECT value FROM studio_mcp_links WHERE id = ?", id)) as McpLink | undefined,
    linkId: (key: string) =>
      get("SELECT id FROM studio_mcp_links WHERE key = ? LIMIT 1", key)?.id as string | undefined,
    addLink(id: string, link: McpLink) {
      run("INSERT INTO studio_mcp_links (id, key, value) VALUES (?, ?, ?)").run(
        id,
        linkKeyOf(link),
        JSON.stringify(link),
      );
    },
    prompt: (jobId: string) =>
      json(get("SELECT value FROM studio_mcp_prompts WHERE job_id = ?", jobId)) as
        | Record<string, unknown>
        | undefined,
    setPrompt(jobId: string, record: unknown) {
      run(
        "INSERT INTO studio_mcp_prompts (job_id, value) VALUES (?, ?) ON CONFLICT(job_id) DO UPDATE SET value = excluded.value",
      ).run(jobId, JSON.stringify(record));
    },
    upload: (reference: string) =>
      get("SELECT asset_id FROM studio_mcp_uploads WHERE reference = ?", reference)?.asset_id as
        | string
        | undefined,
    setUpload(reference: string, assetId: string) {
      run(
        "INSERT INTO studio_mcp_uploads (reference, asset_id) VALUES (?, ?) ON CONFLICT(reference) DO UPDATE SET asset_id = excluded.asset_id",
      ).run(reference, assetId);
    },
  };
}
