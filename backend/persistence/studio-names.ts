import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { hasMigration, runtimeDatabase, withOfflineDatabase } from "./runtime.ts";

/**
 * The 1.0 rename of the names Studio kept on disk from HEISS UI (CONFIGURATION.md#studio-names):
 * the `heiss-ui` media folder and `.heiss-trash` (with every record, URL and trash batch that
 * names them), the profile block in profiles and their version history, and old `heiss-*.log`
 * files. Run by migrate-runtime.mjs after the SQLite import, with Studio stopped. Each folder is
 * one rename on its own file system and each file is replaced whole; the database changes in one
 * transaction with its marker. A manifest and copies of everything changed are written first, so
 * `undoStudioNames` can put it all back.
 */
const namesMigration = "studio-names-v1";
const folders: Record<string, string> = { "heiss-ui": "studio", ".heiss-trash": ".studio-trash" };
const oldBlocks = ["heissUi", "heiss_ui", "jAiStudio", "j_ai_studio"];
// Imported into SQLite by the runtime step, whose source JSON stays as it was.
const sourceDocuments = ["accounts.json", "gallery.json", "gallery-hidden.json"];
// Top-level folders read separately (history, workflows) or never rewritten (backups, media).
const unscanned = new Set(["backups", "history", "imports", "logs", "media", "workflows"]);
const oldLog = /^heiss-\d{4}-\d{2}-\d{2}\.log$/;
const segment = /(^|\/|=|%2F)(heiss-ui|\.heiss-trash)(?=$|\/|&|%2F)/gi;
const digest = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");

/** A path, URL or subfolder with each old folder name replaced: `heiss-ui/accounts/…` → `studio/accounts/…`. */
export const renamePath = (value: string) =>
  value.replace(
    segment,
    (_match, lead: string, name: string) => lead + folders[name.toLowerCase()],
  );

type Visit = (at: (string | number)[], value: string, key: boolean) => string;

/** Replaces string tokens (keys and values) in JSON text, leaving every other byte as it was. */
export function rewriteJson(text: string, visit: Visit) {
  JSON.parse(text);
  const stack: { keys: boolean; at: string | number; expectKey: boolean }[] = [];
  let out = "";
  let copied = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const top = stack.at(-1);
    if (char === "{") stack.push({ keys: true, at: "", expectKey: true });
    else if (char === "[") stack.push({ keys: false, at: 0, expectKey: false });
    else if (char === "}" || char === "]") stack.pop();
    else if (char === "," && top) {
      if (top.keys) top.expectKey = true;
      else top.at = Number(top.at) + 1;
    } else if (char === ":" && top) top.expectKey = false;
    else if (char === '"') {
      let end = i + 1;
      while (text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      const value = JSON.parse(text.slice(i, end + 1));
      const key = Boolean(top?.keys && top.expectKey);
      if (key) top!.at = value;
      const next = visit(
        stack.map((frame) => frame.at),
        value,
        key,
      );
      if (next !== value) {
        out += text.slice(copied, i) + JSON.stringify(next);
        copied = end + 1;
      }
      i = end;
    }
  }
  return out + text.slice(copied);
}

const renameStrings: Visit = (_at, value) => renamePath(value);

/** A profile's text with its block named `studio` and its output prefixes renamed. */
function profileText(text: string, name: string, conflicts: string[]) {
  const raw = JSON.parse(text);
  const blocks = ["studio", ...oldBlocks].filter((block) => raw?.[block] !== undefined);
  if (blocks.length > 1) conflicts.push(`${name} has more than one profile block (${blocks})`);
  return rewriteJson(text, (at, value, key) =>
    key && at.length === 1 && oldBlocks.includes(value) ? "studio" : renamePath(value),
  );
}

const galleryKey = (item: Record<string, unknown>) =>
  String(item?.url || item?.id || item?.outputName || item?.filename || "");

type Row = { table: string; rowid: number; column: string; value: string; next: string };
type FileChange = { file: string; final: string; kind: string; next: string };
type Options = { mediaDir: string; outputDir?: string };

function jsonFiles(dir: string, top = true): string[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name.startsWith(".") || (top && unscanned.has(entry.name))
        ? []
        : jsonFiles(file, false);
    return entry.isFile() &&
      entry.name.endsWith(".json") &&
      !(top && sourceDocuments.includes(entry.name))
      ? [file]
      : [];
  });
}

const subdirectories = (dir: string) => {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
};

/** Every row value naming an old folder, from the database (or the JSON the runtime step imports). */
function readRows(dataDir: string) {
  const migrated = withOfflineDatabase(dataDir, (db) => hasMigration(db, "runtime-json-v1"));
  const rows = withOfflineDatabase(dataDir, offlineRows) || [];
  if (!migrated)
    for (const name of sourceDocuments) {
      const file = path.join(dataDir, name);
      if (!fs.existsSync(file)) continue;
      const value = JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8")));
      rows.push({
        table: "studio_documents",
        rowid: -1,
        column: path.basename(name, ".json"),
        value,
        next: value,
      });
    }
  return rows;
}

function offlineRows(db: DatabaseSync): Row[] {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'studio_migrations'",
    )
    .all() as { name: string }[];
  return tables.flatMap(({ name: table }) => {
    const columns = (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map(
      (column) => column.name,
    );
    return (
      db.prepare(`SELECT rowid AS rowid, * FROM "${table}"`).all() as Record<string, unknown>[]
    ).flatMap((row) =>
      columns
        .filter((column) => typeof row[column] === "string")
        .map((column) => ({
          table,
          rowid: Number(row.rowid),
          column: table === "studio_documents" && column === "value" ? String(row.name) : column,
          value: String(row[column]),
          next: String(row[column]),
        })),
    );
  });
}

/** A JSON (or plain) value with every old folder name replaced. */
function renameValue(value: string) {
  const text = value.trimStart();
  if (text.startsWith("{") || text.startsWith("[") || text.startsWith('"')) {
    try {
      return rewriteJson(value, renameStrings);
    } catch {
      // Not JSON after all.
    }
  }
  return renamePath(value);
}

/** The deletion markers of renamed gallery records, moved to their new keys (gallery-store.js markerOf). */
function remapMarkers(
  dataDir: string,
  hidden: Record<string, unknown>,
  pairs: Map<string, string>,
) {
  let key: Buffer;
  try {
    key = Buffer.from(
      fs.readFileSync(path.join(dataDir, ".gallery-marker-key"), "utf8").trim(),
      "base64url",
    );
  } catch {
    return 0;
  }
  if (key.length !== 32) return 0;
  const markerOf = (text: string) =>
    `h:${crypto.createHmac("sha256", key).update(text).digest("base64url")}`;
  let moved = 0;
  for (const [before, after] of pairs) {
    const marker = markerOf(before);
    if (!Object.hasOwn(hidden, marker)) continue;
    hidden[markerOf(after)] = hidden[marker];
    delete hidden[marker];
    moved += 1;
  }
  return moved;
}

export function planStudioNames(dataDir: string, { mediaDir, outputDir }: Options) {
  const conflicts: string[] = [];
  const folderRenames: { from: string; to: string }[] = [];
  const files: FileChange[] = [];
  const pairs = new Map<string, string>();
  const trashItems: Record<string, unknown>[] = [];
  const alreadyRenamed = Boolean(
    withOfflineDatabase(dataDir, (db) => hasMigration(db, namesMigration)),
  );
  const change = (file: string, kind: string, next: string, final = file) => {
    if (next !== fs.readFileSync(file, "utf8")) files.push({ file, final, kind, next });
  };
  const readJson = (file: string) => {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return "";
    }
  };

  // Folders: the media (and ComfyUI output) folder, its trash, and each trash batch's files.
  for (const base of [mediaDir, outputDir].filter(Boolean) as string[]) {
    for (const [from, to] of Object.entries(folders)) {
      const source = path.join(base, from);
      const target = path.join(base, to);
      if (!fs.existsSync(source)) continue;
      if (fs.existsSync(target)) conflicts.push(`${target} already exists beside ${source}`);
      folderRenames.push({ from: source, to: target });
    }
    const trash = path.join(base, ".heiss-trash");
    for (const batch of subdirectories(trash)) {
      const filesDir = path.join(trash, batch, "files");
      const final = path.join(base, ".studio-trash", batch);
      if (fs.existsSync(path.join(filesDir, "heiss-ui"))) {
        if (fs.existsSync(path.join(filesDir, "studio")))
          conflicts.push(`${path.join(filesDir, "studio")} already exists`);
        folderRenames.push({
          from: path.join(final, "files", "heiss-ui"),
          to: path.join(final, "files", "studio"),
        });
      }
      const batchFile = path.join(trash, batch, "batch.json");
      const text = readJson(batchFile);
      if (!text) continue;
      try {
        const next = rewriteJson(text, renameStrings);
        for (const item of JSON.parse(text).items || []) trashItems.push(item);
        change(batchFile, "trash batches", next, path.join(final, "batch.json"));
      } catch {
        conflicts.push(`${batchFile} is unreadable`);
      }
    }
  }

  // Profiles and their version history, then the hashes that named their old texts.
  const hashes = new Map<string, string>();
  const workflows = path.join(dataDir, "workflows");
  for (const name of fs.existsSync(workflows) ? fs.readdirSync(workflows).sort() : []) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const file = path.join(workflows, name);
    try {
      const text = fs.readFileSync(file, "utf8");
      const next = profileText(text, `workflows/${name}`, conflicts);
      hashes.set(digest(text), digest(next));
      change(file, "profiles", next);
    } catch {
      conflicts.push(`workflows/${name} is unreadable`);
    }
  }
  const history = path.join(dataDir, "history", "profiles");
  for (const id of subdirectories(history).sort())
    for (const name of fs.readdirSync(path.join(history, id)).sort()) {
      if (!/^\d+\.json$/.test(name)) continue;
      const file = path.join(history, id, name);
      try {
        const text = fs.readFileSync(file, "utf8");
        const version = JSON.parse(text);
        const body = profileText(
          String(version.text ?? ""),
          `history/profiles/${id}/${name}`,
          conflicts,
        );
        const hash = digest(body);
        if (version.hash) hashes.set(version.hash, hash);
        const next = rewriteJson(text, (at, value, key) => {
          if (!key && at.length === 1 && at[0] === "text") return body;
          if (!key && at.length === 1 && at[0] === "hash") return hash;
          return renamePath(value);
        });
        change(file, "profile versions", next);
      } catch {
        conflicts.push(`history/profiles/${id}/${name} is unreadable`);
      }
    }
  for (const name of [".studio-meta.json", ".studio-edits.json"]) {
    const file = path.join(workflows, name);
    const text = readJson(file);
    if (!text) continue;
    change(
      file,
      "profile records",
      rewriteJson(text, (at, value, key) =>
        !key && ["seedHash", "exportedHash", "baseHash"].includes(String(at.at(-1)))
          ? hashes.get(value) || value
          : renamePath(value),
      ),
    );
  }

  // Every other JSON store in the data folder (reference assets, Library, account files).
  for (const file of jsonFiles(dataDir)) {
    try {
      change(file, "other files", rewriteJson(fs.readFileSync(file, "utf8"), renameStrings));
    } catch {
      conflicts.push(`${path.relative(dataDir, file)} is unreadable`);
    }
  }

  // Database rows: documents (gallery, deletion markers, Dream, taste), sessions, queue and jobs.
  const rows = readRows(dataDir);
  const records: Record<string, number> = {};
  const galleryByOwner: Record<string, number> = {};
  const missing: string[] = [];
  let outsideMedia = 0;
  let hiddenRow: Row | undefined;
  for (const row of rows) {
    if (row.table === "studio_documents" && row.column === "gallery-hidden") {
      hiddenRow = row;
      continue;
    }
    if (row.table === "studio_documents" && row.column === "gallery") {
      const gallery = JSON.parse(row.value) as Record<string, unknown>[];
      const next = gallery.map((item) => {
        const text = JSON.stringify(item);
        const renamed = rewriteJson(text, renameStrings);
        if (renamed === text) return item;
        const owner = String(item.ownerId || "single-user");
        galleryByOwner[owner] = (galleryByOwner[owner] || 0) + 1;
        const after = JSON.parse(renamed);
        if (galleryKey(item) !== galleryKey(after)) pairs.set(galleryKey(item), galleryKey(after));
        return after;
      });
      row.next = JSON.stringify(next);
      for (const item of next) {
        if (item.status !== "done" || !String(item.url || "").startsWith("/comfy/view?")) continue;
        const params = new URLSearchParams(String(item.url).split("?")[1]);
        const base = params.get("type") === "media" ? mediaDir : outputDir;
        if (!base) {
          outsideMedia += 1;
          continue;
        }
        // Checked where the file is now; after the rename, where it will be.
        const subfolder = String(params.get("subfolder") || "");
        const now = folderRenames.some((rename) => rename.from === path.join(base, "heiss-ui"))
          ? subfolder.replace(/^studio(?=\/|$)/, "heiss-ui")
          : subfolder;
        const file = path.join(base, now, String(params.get("filename") || ""));
        if (!fs.existsSync(file)) missing.push(path.relative(base, file));
      }
      if (row.next !== row.value)
        records["studio_documents/gallery"] = Object.values(galleryByOwner).reduce((a, b) => a + b);
      continue;
    }
    row.next = renameValue(row.value);
    if (row.next !== row.value) {
      const name = row.table === "studio_documents" ? `studio_documents/${row.column}` : row.table;
      records[name] = (records[name] || 0) + 1;
    }
  }
  for (const item of trashItems) {
    const after = JSON.parse(rewriteJson(JSON.stringify(item), renameStrings));
    if (galleryKey(item) !== galleryKey(after)) pairs.set(galleryKey(item), galleryKey(after));
  }
  let markers = 0;
  if (hiddenRow) {
    const hidden = JSON.parse(renameValue(hiddenRow.value));
    if (hidden && typeof hidden === "object" && !Array.isArray(hidden))
      markers = remapMarkers(dataDir, hidden, pairs);
    hiddenRow.next = JSON.stringify(hidden);
    if (hiddenRow.next !== hiddenRow.value) records["studio_documents/gallery-hidden"] = 1;
  }

  const logs = path.join(dataDir, "logs");
  const oldLogs = (fs.existsSync(logs) ? fs.readdirSync(logs) : [])
    .filter((name) => oldLog.test(name))
    .map((name) => path.join(logs, name));

  const fileCounts: Record<string, number> = {};
  for (const file of files) fileCounts[file.kind] = (fileCounts[file.kind] || 0) + 1;
  return {
    alreadyRenamed,
    folders: folderRenames,
    files: fileCounts,
    records,
    galleryByOwner,
    markers,
    logs: oldLogs.map((file) => path.basename(file)),
    missingFiles: missing,
    outsideMedia,
    conflicts,
    // Not printed: the planned changes themselves.
    changes: { files, rows: rows.filter((row) => row.next !== row.value), oldLogs },
  };
}

function writeAtomic(file: string, data: string | Buffer, mode?: number) {
  const temporary = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, data, { flag: "wx", ...(mode ? { mode } : {}) });
  const handle = fs.openSync(temporary, "r");
  try {
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(temporary, file);
}

/** Applies the plan; refused when already applied, with conflicts or with the SQLite import pending. */
export function applyStudioNames(dataDir: string, options: Options) {
  const plan = planStudioNames(dataDir, options);
  const { changes, ...summary } = plan;
  if (plan.alreadyRenamed || plan.conflicts.length)
    return { ...summary, applied: false, backup: "" };
  if (changes.rows.some((row) => row.rowid < 0))
    throw new Error("Apply the SQLite import before renaming.");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(
    dataDir,
    ".backups",
    `names-${stamp}-${crypto.randomBytes(3).toString("hex")}`,
  );
  fs.mkdirSync(path.join(backup, "files"), { recursive: true, mode: 0o700 });
  const copies = [...changes.files.map((change) => change.file), ...changes.oldLogs].map(
    (file, n) => {
      const copy = path.join(backup, "files", String(n));
      fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL);
      return copy;
    },
  );
  fs.writeFileSync(
    path.join(backup, "rows.json"),
    JSON.stringify(changes.rows.map(({ next: _next, ...row }) => row)),
    { mode: 0o600, flag: "wx" },
  );
  const manifest = {
    migration: namesMigration,
    createdAt: new Date().toISOString(),
    dataDir,
    folders: plan.folders,
    files: changes.files.map((change, n) => ({
      file: change.file,
      final: change.final,
      copy: String(n),
    })),
    logs: changes.oldLogs.map((file, n) => ({ file, copy: String(changes.files.length + n) })),
    rows: "rows.json",
  };
  fs.writeFileSync(path.join(backup, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  // The complete undo record must reach disk before anything changes.
  for (const file of [
    ...copies,
    path.join(backup, "rows.json"),
    path.join(backup, "manifest.json"),
    path.join(backup, "files"),
    backup,
  ]) {
    const handle = fs.openSync(file, "r");
    try {
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
  }

  for (const change of changes.files)
    writeAtomic(change.file, change.next, fs.statSync(change.file).mode & 0o777);
  for (const { from, to } of plan.folders) {
    if (fs.existsSync(to))
      throw new Error(`${to} appeared during the migration; run --undo ${backup}`);
    fs.renameSync(from, to);
  }
  const db = runtimeDatabase(dataDir);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of changes.rows) {
      const column = row.table === "studio_documents" ? "value" : row.column;
      const result = db
        .prepare(`UPDATE "${row.table}" SET "${column}" = ? WHERE rowid = ? AND "${column}" = ?`)
        .run(row.next, row.rowid, row.value);
      if (result.changes !== 1) throw new Error(`${row.table} changed during the migration`);
    }
    db.prepare("INSERT INTO studio_migrations(name, applied_at) VALUES (?, ?)").run(
      namesMigration,
      new Date().toISOString(),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw Object.assign(error as Error, {
      message: `${(error as Error).message}; run --undo ${backup}`,
    });
  }
  for (const file of changes.oldLogs) fs.rmSync(file);
  return { ...summary, applied: true, backup };
}

/**
 * Puts back what `applyStudioNames` changed, from its manifest: folders renamed back, files and
 * database rows restored, old logs returned and the marker removed. Safe after an interrupted
 * apply, and again after a completed undo. Work saved since the apply is not kept.
 */
export function undoStudioNames(backup: string) {
  const manifest = JSON.parse(fs.readFileSync(path.join(backup, "manifest.json"), "utf8"));
  if (manifest.migration !== namesMigration) throw new Error("Not a Studio names manifest");
  for (const { from, to } of [...manifest.folders].reverse()) {
    if (fs.existsSync(from)) continue;
    if (!fs.existsSync(to)) throw new Error(`Neither ${from} nor ${to} exists`);
    fs.renameSync(to, from);
  }
  for (const { file, copy } of [...manifest.files, ...manifest.logs]) {
    const saved = path.join(backup, "files", copy);
    writeAtomic(file, fs.readFileSync(saved), fs.statSync(saved).mode & 0o777);
  }
  const rows = JSON.parse(fs.readFileSync(path.join(backup, manifest.rows), "utf8")) as Row[];
  const db = runtimeDatabase(manifest.dataDir);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      const column = row.table === "studio_documents" ? "value" : row.column;
      db.prepare(`UPDATE "${row.table}" SET "${column}" = ? WHERE rowid = ?`).run(
        row.value,
        row.rowid,
      );
    }
    db.prepare("DELETE FROM studio_migrations WHERE name = ?").run(namesMigration);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return {
    undone: true,
    folders: manifest.folders.length,
    files: manifest.files.length,
    rows: rows.length,
    logs: manifest.logs.length,
  };
}
