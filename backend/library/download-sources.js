// SPDX-License-Identifier: AGPL-3.0-only
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readJsonFile, writeJsonFile } from "../json-store.js";
import { verifiedBackup } from "../persistence/migration.ts";

/**
 * The migrate-runtime step that folds the retired `model-download-sources.json` (Civitai and
 * Hugging Face download specs by download id) into the catalogue's provider layer, which Studio
 * alone reads and writes now, then deletes the file. For an id both hold, the file's spec wins, as
 * Studio wrote it last. Plans by default, listing download ids only: those `added` to the layer,
 * those `changed`, the `unchanged` count and entries that are not specs (`skipped`). `apply`
 * copies the file, its `.bak` copy (json-store.js) and the catalogue to a
 * `.backups/download-sources-*` folder with their mapping (restorable with `--restore`), writes
 * the catalogue and deletes the file and its `.bak`, with Studio stopped. A second run finds
 * nothing.
 */
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

export function downloadSources(dataDir, { apply = false } = {}) {
  const sourceName = "model-download-sources.json";
  const catalogueName = "library/catalogue.json";
  const sourceFile = path.join(dataDir, sourceName);
  const catalogueFile = path.join(dataDir, catalogueName);
  const result = { applied: false, backup: "", added: [], changed: [], unchanged: 0, skipped: [] };
  if (!fs.existsSync(sourceFile)) return result;
  const sources = readJsonFile(sourceFile);
  if (!isObject(sources)) throw new Error(`${sourceName} is not an object of download specs.`);
  const state = fs.existsSync(catalogueFile) ? readJsonFile(catalogueFile) : { version: 1 };
  const provider = isObject(state.layers?.provider) ? { ...state.layers.provider } : {};
  for (const [id, spec] of Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isObject(spec)) {
      result.skipped.push(id);
      continue;
    }
    const next = { ...spec, id };
    if (!Object.hasOwn(provider, id)) result.added.push(id);
    else if (JSON.stringify(provider[id]) !== JSON.stringify(next)) result.changed.push(id);
    else {
      result.unchanged += 1;
      continue;
    }
    provider[id] = next;
  }
  if (!apply) return result;

  const files = [sourceName, `${sourceName}.bak`, catalogueName]
    .filter((name) => fs.existsSync(path.join(dataDir, name)))
    .map((name) => {
      const bytes = fs.readFileSync(path.join(dataDir, name));
      return { source: name, hash: digest(bytes), bytes };
    });
  const mappings = files.map(({ source, hash }) => ({ source, target: catalogueName, hash }));
  result.backup = verifiedBackup(dataDir, "download-sources", files, {
    mappings,
    added: result.added,
    changed: result.changed,
    unchanged: result.unchanged,
    skipped: result.skipped,
  });
  // The catalogue no longer syncs the file, so its signature goes with it.
  const { provider: _signature, ...signatures } = isObject(state.signatures)
    ? state.signatures
    : {};
  // Studio rebuilds the entries from the layers and edits when it loads the catalogue.
  writeJsonFile(catalogueFile, {
    ...state,
    layers: { ...state.layers, provider },
    signatures,
  });
  fs.rmSync(sourceFile);
  fs.rmSync(`${sourceFile}.bak`, { force: true });
  result.applied = true;
  return result;
}
