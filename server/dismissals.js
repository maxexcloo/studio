import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonFile, writeJsonFile } from "./json-store.js";

/**
 * Recommendations someone said not to show again ("flux3:upsampler"): kept in
 * the data folder, so the answer holds across restarts, updates and every
 * device, until they bring it back.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.HEISS_DATA_DIR ? path.resolve(process.env.HEISS_DATA_DIR) : path.join(root, "data");
const file = path.join(dataDir, "dismissed.json");
const keyPattern = /^[a-z0-9_]{1,40}:[a-z0-9_]{1,40}$/;

let cache = null;

/** Every dismissed key. */
export function dismissedKeys() {
  if (!cache) {
    let saved = null;
    try { saved = readJsonFile(file); } catch { saved = null; }
    cache = new Set(Array.isArray(saved?.keys) ? saved.keys.filter((key) => keyPattern.test(String(key))) : []);
  }
  return cache;
}

export function isDismissed(key) {
  return dismissedKeys().has(key);
}

/** Hides (or, with `dismissed: false`, brings back) one recommendation. Only well-formed keys. */
export function setDismissed(key, dismissed = true) {
  const value = String(key || "");
  if (!keyPattern.test(value)) throw new Error("That isn’t something Studio recommends.");
  const keys = dismissedKeys();
  if (dismissed) keys.add(value);
  else keys.delete(value);
  fs.mkdirSync(dataDir, { recursive: true });
  writeJsonFile(file, { keys: [...keys].sort() });
  return [...keys];
}
