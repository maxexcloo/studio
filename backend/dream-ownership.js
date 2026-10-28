import fs from "node:fs";
import path from "node:path";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import {
  hasMigration,
  runtimeDatabase,
  usesRuntimeDatabase,
  withOfflineDatabase,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";
import {
  galleryRowsMigration,
  readGalleryRows,
  writeGalleryRows,
} from "./persistence/gallery-rows.ts";

/**
 * The migrate-runtime step that clears Dream answers left on records another account owns. Dream
 * marks and calibration answers don't record who gave them, so the one account that used Dream is
 * named (`owner`): Dream marks on gallery items owned by anyone else are removed, as are that
 * account's calibration answers (`dream:<owner>` judged ids) and Dream taste signals about those
 * items. The account's own marks, answers and taste summary stay. Plans by default; `apply`
 * writes, with Studio stopped. A second run finds nothing.
 */
const dreamSignals = new Set(["keep", "discard", "calibrate-like", "calibrate-pass"]);

export function dreamOwnership(dataDir, { owner, apply = false }) {
  if (!owner) throw new Error("Name the account that used Dream with --dream-owner <account id>.");
  const database = usesRuntimeDatabase(dataDir);
  const galleryFile = path.join(dataDir, "gallery.json");
  let rows = false;
  const documents = withOfflineDatabase(dataDir, (db) => {
    rows = hasMigration(db, galleryRowsMigration);
    const read = db.prepare("SELECT value FROM studio_documents WHERE name = ?");
    const document = (name) => {
      const row = read.get(name);
      return row ? JSON.parse(row.value) : null;
    };
    return {
      gallery: rows ? readGalleryRows(db) : document("gallery"),
      [`dream:${owner}`]: document(`dream:${owner}`),
      [`taste:${owner}`]: document(`taste:${owner}`),
    };
  });
  const gallery =
    (database
      ? documents?.gallery
      : fs.existsSync(galleryFile)
        ? readJsonFile(galleryFile)
        : null) || [];
  const own = (item) => (item?.ownerId || "") === owner;
  const marked = gallery.filter((item) => item?.dream && !own(item));
  const foreignIds = new Set(gallery.filter((item) => !own(item)).map((item) => item.id));
  const foreignJobs = new Set(
    gallery.filter((item) => !own(item) && item.jobId).map((item) => item.jobId),
  );
  const ownJobs = new Set(
    gallery.filter((item) => own(item) && item.jobId).map((item) => item.jobId),
  );

  const dream = documents?.[`dream:${owner}`];
  const judged = (dream?.judged || []).filter((id) => foreignIds.has(id));
  const taste = documents?.[`taste:${owner}`];
  const signals = (taste?.signals || []).filter(
    (signal) =>
      dreamSignals.has(signal.kind) && foreignJobs.has(signal.jobId) && !ownJobs.has(signal.jobId),
  );
  const result = {
    applied: apply,
    owner,
    marks: marked.length,
    marksByState: marked.reduce((counts, item) => {
      const state = String(item.dream.state || "unknown");
      counts[state] = (counts[state] || 0) + 1;
      return counts;
    }, {}),
    judged: judged.length,
    signals: signals.length,
  };
  if (!apply) return result;

  if (marked.length) {
    const cleared = new Map(
      marked.map((item) => {
        const { dream: _dream, ...rest } = item;
        return [item, rest];
      }),
    );
    const next = gallery.map((item) => cleared.get(item) || item);
    if (rows) writeGalleryRows(runtimeDatabase(dataDir), [...cleared.values()]);
    else if (database) writeRuntimeDocument(dataDir, "gallery", next);
    else writeJsonFile(galleryFile, next);
  }
  if (judged.length)
    writeRuntimeDocument(dataDir, `dream:${owner}`, {
      ...dream,
      judged: dream.judged.filter((id) => !foreignIds.has(id)),
    });
  if (signals.length) {
    const dropped = new Set(signals);
    // `since` counts the newest signals not yet in the summary.
    const unsummarised = taste.signals.slice(0, taste.since || 0);
    writeRuntimeDocument(dataDir, `taste:${owner}`, {
      ...taste,
      signals: taste.signals.filter((signal) => !dropped.has(signal)),
      since: unsummarised.filter((signal) => !dropped.has(signal)).length,
    });
  }
  return result;
}
