import { runtimeDatabase } from "./persistence/runtime.ts";

/**
 * The migrate-runtime step that turns stars into likes: a starred gallery item (`favorite: true`)
 * is liked (`rating: "liked"`), a Dream discard is disliked (kept and hidden, as Dream's Dislike
 * leaves one), and taste signals of stars and unstars become likes and unlikes. Safe while Studio
 * runs: its writes are synchronous on the server's own database. Plans by default; `apply` writes.
 * A second run finds nothing.
 */
const starred = "json_extract(value, '$.favorite') IS NOT NULL";
const discarded =
  "json_extract(value, '$.dream.state') = 'discarded' AND json_extract(value, '$.rating') IS NULL";
const renamed = { star: "like", unstar: "unlike" };

export function galleryRatings(dataDir, { apply = false } = {}) {
  const db = runtimeDatabase(dataDir);
  const count = (where) =>
    db.prepare(`SELECT count(*) AS count FROM studio_gallery WHERE ${where}`).get().count;
  const likes = count(`json_extract(value, '$.favorite') = 1`);
  const unstarred = count(starred) - likes;
  const dislikes = count(discarded);
  const tastes = db
    .prepare("SELECT name, value FROM studio_documents WHERE name LIKE 'taste:%'")
    .all()
    .map((row) => ({ name: row.name, taste: JSON.parse(row.value) }))
    .filter(({ taste }) => taste.signals?.some((signal) => renamed[signal.kind]));
  const signals = tastes.reduce(
    (total, { taste }) => total + taste.signals.filter((signal) => renamed[signal.kind]).length,
    0,
  );
  const result = { applied: apply, likes, unstarred, dislikes, signals };
  if (!apply || !(likes + unstarred + dislikes + signals)) return result;
  const write = db.prepare("UPDATE studio_documents SET value = ? WHERE name = ?");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`UPDATE studio_gallery SET value = CASE WHEN json_extract(value, '$.favorite') = 1
      THEN json_set(json_remove(value, '$.favorite'), '$.rating', 'liked')
      ELSE json_remove(value, '$.favorite') END WHERE ${starred}`);
    db.exec(
      `UPDATE studio_gallery SET value = json_set(value, '$.rating', 'disliked') WHERE ${discarded}`,
    );
    for (const { name, taste } of tastes) {
      for (const signal of taste.signals) signal.kind = renamed[signal.kind] ?? signal.kind;
      write.run(JSON.stringify(taste), name);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return result;
}
