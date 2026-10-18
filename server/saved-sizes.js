import path from "node:path";
import { dataDir } from "./gallery-store.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";

/**
 * Custom sizes kept from the size menu ("Save size"), in data/saved-sizes.json:
 * the studio's, not one browser's, so the phone and every other device see
 * the same list. The client owns the order and the names; this checks shape
 * and bounds, and keeps the file.
 */

const file = path.join(dataDir, "saved-sizes.json");
const limit = 60;

/** One saved size, or null when it isn't one: an id, a name, and sides a model could draw. */
export function cleanSize(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id || "").slice(0, 64);
  const name = String(value.name || "").trim().slice(0, 32);
  const width = Math.round(Number(value.width));
  const height = Math.round(Number(value.height));
  const side = (n) => Number.isFinite(n) && n >= 64 && n <= 8192;
  if (!id || !name || !side(width) || !side(height)) return null;
  return { id, name, width, height };
}

export function loadSavedSizes() {
  try {
    const raw = readJsonFile(file);
    return (Array.isArray(raw?.sizes) ? raw.sizes : []).map(cleanSize).filter(Boolean).slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Saves a device's list: what came in, cleaned, one per id, at most 60.
 * With `base`, the ids that device last had from here, it's a merge rather
 * than a replace: a size another device added since (on the server, not in
 * `base`) stays, after this device's own; only the ones it took off go.
 */
export function saveSavedSizes(list, base = null) {
  const seen = new Set();
  const incoming = (Array.isArray(list) ? list : []).map(cleanSize).filter((item) => item && !seen.has(item.id) && seen.add(item.id));
  const known = Array.isArray(base) ? new Set(base.map(String)) : null;
  const added = known ? loadSavedSizes().filter((item) => !seen.has(item.id) && !known.has(item.id)) : [];
  const sizes = [...incoming, ...added].slice(0, limit);
  writeJsonFile(file, { sizes });
  return sizes;
}
