import { createMcpTables, linkKeyOf } from "./persistence/mcp-ownership.ts";
import { runtimeDatabase, savedDocument } from "./persistence/runtime.ts";

/**
 * The migrate-runtime step that moves MCP's records from the `mcp-ownership` document, which
 * Studio rewrote whole on every change, into rows (persistence/mcp-ownership.ts), and its signing
 * key into the `mcp-signing-key` document, then deletes the old document. Result links, sealed
 * ones included, keep opening. A row already holding something else is a conflict, and a plan
 * with conflicts applies nothing. Online-safe: MCP refuses work while the old document exists, and
 * the step reads and writes in one transaction. Plans by default; `apply` writes. A second run
 * finds nothing.
 */
export function mcpOwnershipRows(dataDir, { apply = false } = {}) {
  const old = savedDocument(dataDir, "mcp-ownership");
  if (!old) return { applied: apply, document: false, rows: {}, conflicts: [] };
  const db = runtimeDatabase(dataDir);
  db.exec(createMcpTables);
  const rows = {
    jobs: Object.entries(old.jobs || {}).map(([id, owner]) => [id, owner]),
    assets: Object.entries(old.assets || {}).flatMap(([id, owners]) =>
      [...new Set([owners].flat())].map((owner) => [id, owner]),
    ),
    refs: Object.entries(old.refs || {}).flatMap(([scope, entry]) =>
      Object.entries(entry.jobs || {}).map(([number, jobId]) => [scope, Number(number), jobId]),
    ),
    offers: Object.entries(old.refs || {}).flatMap(([scope, entry]) =>
      entry.offer ? [[scope, JSON.stringify(entry.offer)]] : [],
    ),
    numbers: Object.entries(old.numbers || {}).flatMap(([jobId, numbers]) =>
      numbers.flatMap((number, index) => (number ? [[jobId, index, number]] : [])),
    ),
    links: Object.entries(old.links || {}).map(([id, link]) => [
      id,
      linkKeyOf(link),
      JSON.stringify(link),
    ]),
    prompts: Object.entries(old.prompts || {}).map(([jobId, record]) => [
      jobId,
      JSON.stringify(record),
    ]),
    uploads: Object.entries(old.uploads || {}),
  };
  // Each table's key columns, then the columns a conflict compares.
  const tables = {
    jobs: [["job_id"], ["owner"]],
    assets: [["asset_id", "owner"], []],
    refs: [["scope", "number"], ["job_id"]],
    offers: [["scope"], ["value"]],
    numbers: [["job_id", "output"], ["number"]],
    links: [["id"], ["key", "value"]],
    prompts: [["job_id"], ["value"]],
    uploads: [["reference"], ["asset_id"]],
  };
  const conflicts = [];
  const write = [];
  for (const [name, [keys, values]] of Object.entries(tables)) {
    const columns = [...keys, ...values];
    const find = db.prepare(
      `SELECT ${columns.join(", ")} FROM studio_mcp_${name} WHERE ${keys.map((key) => `${key} = ?`).join(" AND ")}`,
    );
    const insert = db.prepare(
      `INSERT INTO studio_mcp_${name} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    );
    for (const row of rows[name]) {
      const held = find.get(...row.slice(0, keys.length));
      if (!held) write.push(() => insert.run(...row));
      else if (columns.some((column, index) => held[column] !== row[index]))
        conflicts.push({ table: name, key: row.slice(0, keys.length) });
    }
  }
  const key = savedDocument(dataDir, "mcp-signing-key");
  if (key !== undefined && key !== old.signingKey) conflicts.push({ signingKey: "differs" });
  const counts = Object.fromEntries(
    Object.entries(rows).map(([name, list]) => [name, list.length]),
  );
  const plan = { document: true, rows: counts, conflicts: conflicts.slice(0, 20) };
  if (!apply || conflicts.length) return { applied: false, ...plan };
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const run of write) run();
    if (key === undefined && old.signingKey)
      db.prepare("INSERT INTO studio_documents (name, value) VALUES ('mcp-signing-key', ?)").run(
        JSON.stringify(old.signingKey),
      );
    db.prepare("DELETE FROM studio_documents WHERE name = 'mcp-ownership'").run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { applied: true, ...plan };
}
