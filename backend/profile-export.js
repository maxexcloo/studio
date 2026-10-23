// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Profiles › Export: Studio's live profiles, guides and catalogue as one archive in the
 * seed repository's layout (`ai/profiles/`), so a person can unpack it there, review the diff and
 * commit it. Studio never writes Git itself.
 *
 *   config/studio/workflows/<id>.json   every profile file Studio holds, exactly as on disk
 *   config/prompting.json               the guide store without its `meta`
 *   config/lora-catalogue.json          the LoRA catalogue by file name (seed and admin files plus Studio's edits)
 *   config/catalogue.json               editable metadata for every model file, keyed by folder/file
 *   config/models.json                  the restore manifest, when there is one
 *   EXPORT.json                         what changed, each item's origin and the unreviewed AI drafts
 *
 * Each export is also kept under `<data>/exports/<stamp>.zip` (the 20 newest), and records the
 * hashes it held so the next one can say what changed since.
 */
import fs from "node:fs";
import path from "node:path";
import { zipBuffer } from "./gallery-export.js";
import { profileBlock } from "./profile-block.js";
import { hashOf } from "./profile-store.js";

export const exportsKept = 20;
const validId = (id) => /^[a-z0-9][a-z0-9._-]{0,79}$/.test(id) && !id.includes("..");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sorted = (value) =>
  Object.fromEntries(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));

/**
 * The bundle's files and summary, without writing anything. `profiles` and `guides` are the
 * profile-store.js stores, `catalogue` the library catalogue (or null), `manifestFile` the
 * restore manifest's path (or '').
 */
export function buildExport({
  workflowsDir,
  profiles,
  guides,
  catalogue = null,
  manifestFile = "",
  by = "",
  studioVersion = "",
  now = new Date(),
}) {
  const files = [];
  const summary = { profiles: [], guides: [] };
  const metas = profiles.metas();
  let names = [];
  try {
    names = fs
      .readdirSync(workflowsDir)
      .filter((name) => name.endsWith(".json") && !name.startsWith("."))
      .sort();
  } catch {
    /* No profiles yet. */
  }
  for (const name of names) {
    const id = name.slice(0, -5);
    if (!validId(id)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(workflowsDir, name), "utf8");
    } catch {
      continue;
    }
    const meta = metas[id] || {};
    const hash = hashOf(text);
    let label = id;
    try {
      const raw = JSON.parse(text);
      label = String(profileBlock(raw)?.name || id);
    } catch {
      /* Exported as it is. */
    }
    files.push({ name: `config/studio/workflows/${name}`, body: text, date: now });
    summary.profiles.push({
      id,
      name: label,
      version: meta.version || 0,
      origin: meta.origin || "seed",
      aiDrafted: meta.aiDrafted === true,
      by: meta.by || "",
      changedSinceSeed: !meta.seedHash || meta.seedHash !== hash,
      changedSinceExport: meta.exportedHash !== hash,
      hash,
    });
  }
  const store = guides.read();
  if (store) {
    const { meta = {}, ...config } = store;
    files.push({ name: "config/prompting.json", body: json(config), date: now });
    for (const [packId, pack] of Object.entries(config.packs || {})) {
      const item = meta[packId] || {};
      const hash = hashOf(pack);
      summary.guides.push({
        packId,
        name: String(pack?.name || packId),
        version: item.version || 0,
        origin: item.origin || "seed",
        aiDrafted: item.aiDrafted === true,
        by: item.by || "",
        changedSinceSeed: !item.seedHash || item.seedHash !== hash,
        changedSinceExport: item.exportedHash !== hash,
        hash,
      });
    }
  }
  if (catalogue)
    files.push({
      name: "config/lora-catalogue.json",
      body: json(sorted(catalogue.loraView().catalogue)),
      date: now,
    });
  if (catalogue?.definitions) {
    const definitions = catalogue.definitions();
    if (Object.keys(definitions).length)
      files.push({ name: "config/catalogue.json", body: json(sorted(definitions)), date: now });
  }
  if (manifestFile) {
    try {
      files.push({
        name: "config/models.json",
        body: fs.readFileSync(manifestFile, "utf8"),
        date: now,
      });
    } catch {
      /* No manifest to export. */
    }
  }
  const strip = ({ hash: _hash, ...item }) => item;
  const report = {
    format: 1,
    layout: "ai/profiles",
    exportedAt: now.toISOString(),
    by: String(by || ""),
    studioVersion,
    adopt:
      "Unpack into ai/profiles/, review the diff and commit it. Profiles marked aiDrafted are unreviewed: approve them in Studio first, or commit them knowing they are drafts.",
    changed: {
      profiles: summary.profiles.filter((item) => item.changedSinceExport).map((item) => item.id),
      guides: summary.guides.filter((item) => item.changedSinceExport).map((item) => item.packId),
    },
    unreviewed: {
      profiles: summary.profiles.filter((item) => item.aiDrafted).map((item) => item.id),
      guides: summary.guides.filter((item) => item.aiDrafted).map((item) => item.packId),
    },
    profiles: summary.profiles.map(strip),
    guides: summary.guides.map(strip),
  };
  files.push({ name: "EXPORT.json", body: json(report), date: now });
  return {
    files,
    report,
    hashes: {
      profiles: Object.fromEntries(summary.profiles.map((item) => [item.id, item.hash])),
      guides: Object.fromEntries(summary.guides.map((item) => [item.packId, item.hash])),
    },
  };
}

/** Builds the archive, keeps it under `<data>/exports` and records what it held. */
export function writeExport({ dataDir, ...options }) {
  const now = options.now || new Date();
  const built = buildExport({ ...options, now });
  const archive = zipBuffer(built.files);
  const name = `studio-profiles-${now.toISOString().replace(/[:.]/g, "-")}.zip`;
  const dir = path.join(dataDir, "exports");
  fs.mkdirSync(dir, { recursive: true });
  const temporary = path.join(dir, `.${name}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, archive, { mode: 0o600 });
  fs.renameSync(temporary, path.join(dir, name));
  try {
    const kept = fs
      .readdirSync(dir)
      .filter((file) => /^studio-profiles-.*\.zip$/.test(file))
      .sort();
    for (const old of kept.slice(0, Math.max(0, kept.length - exportsKept)))
      fs.rmSync(path.join(dir, old), { force: true });
  } catch {
    /* Pruned next time. */
  }
  options.profiles.markExported(built.hashes.profiles);
  options.guides.markExported(built.hashes.guides);
  return { name, archive, report: built.report };
}
