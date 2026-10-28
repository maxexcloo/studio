import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { mediaRootFor, mediaSubfolder, mediaUrls } from "./media-paths.js";
import { mimeExtension } from "./reference-names.js";
import { verifiedBackup } from "./persistence/migration.ts";
import { galleryKey, galleryRowsMigration, readGalleryRows } from "./persistence/gallery-rows.ts";
import { hasMigration, runtimeDatabase, withOfflineDatabase } from "./persistence/runtime.ts";

/**
 * An uploaded image is a gallery image marked `uploaded`, owned by the uploader and kept in their
 * media folder. Uploads stay out of the gallery until its Uploads filter is on (gallery-store.js
 * pageGallery), and Dream never takes them (domain/dream.ts). The item's id is the upload's own,
 * so a reference saved with that id keeps resolving. Both a new upload (references.js) and the
 * migrate-runtime step below build the record here.
 */
export function uploadedGalleryItem(upload) {
  return {
    id: upload.id,
    ...mediaUrls(upload.filename, upload.subfolder),
    ...(upload.ownerId ? { ownerId: upload.ownerId } : {}),
    type: "image",
    status: "done",
    uploaded: true,
    prompt: "",
    filename: upload.name,
    outputName: upload.filename,
    mime: upload.mime,
    width: upload.width,
    height: upload.height,
    size: upload.size,
    hash: upload.hash,
    createdAt: upload.createdAt,
  };
}

/**
 * The migrate-runtime step `uploads-gallery-v1`: the retired reference store (`reference-assets/`,
 * an `index.json` of uploads beside their files) becomes uploaded gallery images. Plans by
 * default; `apply` writes a `.backups/uploads-gallery-<time>` folder with the mapping, copies each
 * upload into its owner's media folder, commits the rows and the marker atomically, then moves
 * `reference-assets/` into that backup (restorable with --restore). An upload whose file is gone
 * is listed under `missing` and left behind. Runs after gallery-rows-v1, with Studio stopped; a
 * second run finds it done.
 */
export const uploadsMigration = "uploads-gallery-v1";
const storeName = "reference-assets";

export function migrateUploads(dataDir, { apply = false } = {}) {
  const store = path.join(dataDir, storeName);
  const index = path.join(store, "index.json");
  const plan = {
    galleryRowsMigrated: false,
    alreadyMigrated: false,
    mappings: [],
    uploads: [],
    missing: [],
    conflicts: [],
  };
  // The rows to insert, by upload, beside the plan that reports them.
  const items = [];
  let keys = new Set();
  withOfflineDatabase(dataDir, (db) => {
    plan.galleryRowsMigrated = hasMigration(db, galleryRowsMigration);
    plan.alreadyMigrated = hasMigration(db, uploadsMigration);
    if (plan.galleryRowsMigrated) keys = new Set(readGalleryRows(db).map(galleryKey));
  });
  if (!plan.galleryRowsMigrated || plan.alreadyMigrated || !fs.existsSync(index))
    return { ...plan, applied: false, backup: "" };
  const bytes = fs.readFileSync(index);
  let records;
  try {
    records = JSON.parse(bytes.toString());
    if (!Array.isArray(records)) throw new Error("Expected a list");
  } catch {
    plan.conflicts.push(`${storeName}/index.json is unreadable or has an unsupported shape`);
    return { ...plan, applied: false, backup: "" };
  }
  plan.mappings.push({
    source: `${storeName}/index.json`,
    target: "studio_gallery",
    count: records.length,
    hash: crypto.createHash("sha256").update(bytes).digest("hex"),
  });
  const mediaRoot = mediaRootFor(dataDir);
  for (const record of records) {
    if (record?.source !== "upload") continue;
    const id = String(record.id || "");
    const file = path.join(store, "files", path.basename(String(record.file || "")));
    if (!/^[\w-]+$/.test(id) || !record.file || !fs.existsSync(file)) {
      plan.missing.push(id || "(no id)");
      continue;
    }
    const subfolder = mediaSubfolder(record.ownerId || "");
    const filename = `${id}.${mimeExtension(record.mime)}`;
    const item = uploadedGalleryItem({ ...record, filename, subfolder });
    if (keys.has(galleryKey(item))) plan.conflicts.push(`The gallery already holds upload ${id}`);
    keys.add(galleryKey(item));
    items.push(item);
    plan.uploads.push({
      id,
      ownerId: record.ownerId || "",
      source: path.relative(dataDir, file),
      target: path.join(mediaRoot, subfolder, filename),
    });
  }
  if (!apply || plan.conflicts.length) return { ...plan, applied: false, backup: "" };

  const backup = verifiedBackup(dataDir, "uploads-gallery", [], plan);
  for (const upload of plan.uploads) {
    fs.mkdirSync(path.dirname(upload.target), { recursive: true });
    const source = fs.readFileSync(path.join(dataDir, upload.source));
    // A run stopped before its commit may have copied this file already.
    if (fs.existsSync(upload.target) && !fs.readFileSync(upload.target).equals(source))
      throw new Error(`A different file already sits at ${upload.target}`);
    if (!fs.existsSync(upload.target)) fs.writeFileSync(upload.target, source, { mode: 0o600 });
  }
  const db = runtimeDatabase(dataDir);
  db.exec("BEGIN IMMEDIATE");
  try {
    const insert = db.prepare("INSERT INTO studio_gallery (key, value) VALUES (?, ?)");
    for (const item of items) insert.run(galleryKey(item), JSON.stringify(item));
    db.prepare("INSERT INTO studio_migrations(name, applied_at) VALUES (?, ?)").run(
      uploadsMigration,
      new Date().toISOString(),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  fs.renameSync(store, path.join(backup, storeName));
  return { ...plan, applied: true, backup };
}
