import { promptWords, titleCase } from "../shared/titles.ts";
import { readGalleryRows, writeGalleryRows } from "./persistence/gallery-rows.ts";
import { runtimeDatabase } from "./persistence/runtime.ts";

const words = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
// Its words run unbroken within the prompt's first few, as a name cut from the prompt does.
const fromPrompt = (title, prompt) => {
  const name = words(title);
  const text = words(prompt);
  for (let start = 0; start <= 6; start++)
    if (name.length && name.every((word, index) => text[start + index] === word)) return true;
  return false;
};

/**
 * The migrate-runtime step that retitles the gallery by shared/titles.ts. Titles, set titles and
 * set variations take Title Case. A set named by its first prompt's opening words ("Generate images
 * of a tiny") is named by that prompt's title words instead, unless it is a character's set. An
 * item title at the old five-word cap may have been cut mid-phrase, so it is cleared for the
 * gallery titler (domain/titles.ts) to write again. Safe while Studio runs: its writes are
 * synchronous on the server's own database. Plans by default; `apply` writes. A second run finds
 * nothing until the titler has written titles again.
 */
export function galleryTitles(dataDir, { apply = false } = {}) {
  const db = runtimeDatabase(dataDir);
  const items = readGalleryRows(db);
  // Each set's first result, whose prompt named it.
  const first = new Map();
  for (const item of items) {
    const set = item.resultSet;
    if (!set?.id) continue;
    const seen = first.get(set.id);
    if (!seen || (set.index ?? 0) < (seen.resultSet.index ?? 0)) first.set(set.id, item);
  }
  const plan = { applied: apply, titles: 0, cleared: 0, setItems: 0 };
  const changed = [];
  for (const item of items) {
    let next = item;
    if (typeof item.title === "string" && item.title) {
      if (item.title.trim().split(/\s+/).length >= 5) {
        const { title: _cut, ...kept } = item;
        next = kept;
        plan.cleared++;
      } else if (titleCase(item.title) !== item.title) {
        next = { ...item, title: titleCase(item.title) };
        plan.titles++;
      }
    }
    const set = item.resultSet;
    if (set?.id && typeof set.title === "string") {
      const prompt = first.get(set.id).prompt;
      const title =
        !set.character && fromPrompt(set.title, prompt)
          ? promptWords(prompt) || titleCase(set.title)
          : titleCase(set.title);
      const variation = set.variation && titleCase(set.variation);
      if (title !== set.title || variation !== set.variation) {
        next = { ...next, resultSet: { ...set, title, ...(variation ? { variation } : {}) } };
        plan.setItems++;
      }
    }
    if (next !== item) changed.push(next);
  }
  if (apply && changed.length) writeGalleryRows(db, changed);
  return plan;
}
