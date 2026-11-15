import { runtimeDatabase } from "./persistence/runtime.ts";

/**
 * The migrate-runtime step that rewrites shapes older builds stored: a Dream result made before
 * arms were recorded exploited the taste profile (`dream.arm: "exploit"`), and a taste profile
 * written as prose keeps it as its `note` rather than `summary`. Safe while Studio runs: its writes
 * are synchronous on the server's own database. Plans by default; `apply` writes. A second run
 * finds nothing.
 */
const armless =
  "json_type(value, '$.dream') = 'object' AND json_type(value, '$.dream.arm') IS NULL";

export function legacyShapes(dataDir, { apply = false } = {}) {
  const db = runtimeDatabase(dataDir);
  const arms = db
    .prepare(`SELECT count(*) AS count FROM studio_gallery WHERE ${armless}`)
    .get().count;
  const tastes = db
    .prepare(
      "SELECT name, value FROM studio_documents WHERE name LIKE 'taste:%' AND json_type(value, '$.summary') IS NOT NULL",
    )
    .all();
  const result = { applied: apply, arms, notes: tastes.length };
  if (!apply || !(arms + tastes.length)) return result;
  const write = db.prepare("UPDATE studio_documents SET value = ? WHERE name = ?");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(
      `UPDATE studio_gallery SET value = json_set(value, '$.dream.arm', 'exploit') WHERE ${armless}`,
    );
    for (const { name, value } of tastes) {
      const { summary, ...taste } = JSON.parse(value);
      write.run(JSON.stringify({ ...taste, note: taste.note ?? summary }), name);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return result;
}
