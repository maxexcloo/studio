import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { comfyModelsDir } from "./comfy.js";
import { dataDir } from "./media-paths.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { startDownload } from "./model-downloads.js";
import { isInside } from "./paths.js";

/**
 * A pinned model manifest: every weight the deployment expects, with its size
 * and SHA-256, and where to get it again. The deployment keeps the master copy
 * (HEISS_MODEL_MANIFEST, mounted read-only); an administrator may import one
 * here instead, and export what HEISS uses. HEISS reports what is present,
 * missing or wrong, verifies checksums in the background and restores missing
 * files through its own checksum-verifying downloader.
 */

const importedPath = path.join(dataDir, "model-manifest.json");
const verifiedPath = path.join(dataDir, "model-manifest-verified.json");
const prefix = (process.env.HEISS_MODEL_MANIFEST_PREFIX ?? "models/comfyui/").replace(/^\/+/, "");
// What HEISS's downloader may place; anything else is restored by the deployment's own tooling.
const restorableFolders = new Set(["text_encoders", "vae", "diffusion_models", "checkpoints", "loras", "clip_vision"]);
const verifyState = { running: false, done: 0, total: 0, current: "", startedAt: 0, finishedAt: 0, error: "" };
let verified = null;

function cleanEntry(entry) {
  if (!entry || typeof entry.path !== "string" || !/^[0-9a-f]{64}$/i.test(String(entry.sha256 || "")) || !Number.isSafeInteger(entry.size)) return null;
  const parts = entry.path.split("/");
  if (path.isAbsolute(entry.path) || parts.some((part) => !part || part === "." || part === "..")) return null;
  return {
    path: entry.path,
    sha256: String(entry.sha256).toLowerCase(),
    size: entry.size,
    ...(typeof entry.url === "string" && /^https:\/\//.test(entry.url) ? { url: entry.url } : {}),
    ...(Array.isArray(entry.primary) ? { primary: entry.primary.map(String) } : {}),
    ...(Array.isArray(entry.secondary) ? { secondary: entry.secondary.map(String) } : {}),
    ...(typeof entry.source === "string" ? { source: entry.source } : {})
  };
}

export function parseManifest(value) {
  if (!Array.isArray(value)) throw new Error("A model manifest is a JSON list of entries with path, sha256 and size.");
  const entries = value.map(cleanEntry);
  const invalid = entries.filter((entry) => !entry).length;
  if (invalid) throw new Error(`${invalid} manifest ${invalid === 1 ? "entry is" : "entries are"} missing a safe path, a SHA-256 or a size.`);
  return entries;
}

/** The manifest in use: an administrator's import, else the deployment's file. */
export function loadManifest() {
  try {
    if (fs.existsSync(importedPath)) return { source: "imported", entries: parseManifest(readJsonFile(importedPath)) };
  } catch (error) { return { source: "imported", entries: [], error: error.message }; }
  const file = process.env.HEISS_MODEL_MANIFEST;
  if (!file) return { source: "none", entries: [] };
  try { return { source: "deployment", entries: parseManifest(JSON.parse(fs.readFileSync(file, "utf8"))) }; }
  catch (error) { return { source: "deployment", entries: [], error: error.code === "ENOENT" ? "The deployment's manifest file is missing." : error.message }; }
}

export function importManifest(value) {
  const entries = parseManifest(value);
  writeJsonFile(importedPath, entries, { mode: 0o600 });
  return entries.length;
}

/** Back to the deployment's manifest. */
export function clearImportedManifest() {
  fs.rmSync(importedPath, { force: true });
}

function verifiedCache() {
  if (verified) return verified;
  try { verified = readJsonFile(verifiedPath) || {}; } catch { verified = {}; }
  return verified;
}

/** Where an entry lives under ComfyUI's model folder, or why HEISS cannot place it. */
function locate(entry, modelsDir) {
  if (!entry.path.startsWith(prefix)) return { reason: "Outside ComfyUI's model folder" };
  if (!modelsDir) return { reason: "ComfyUI's model folder isn't known here" };
  const relative = entry.path.slice(prefix.length);
  const file = path.resolve(modelsDir, relative);
  if (!isInside(path.resolve(modelsDir), file)) return { reason: "Outside ComfyUI's model folder" };
  return { file, relative };
}

function stateOf(entry, modelsDir) {
  const place = locate(entry, modelsDir);
  if (!place.file) return { status: "external", reason: place.reason };
  let stat = null;
  try { stat = fs.statSync(place.file); } catch { stat = null; }
  if (!stat?.isFile()) return { status: "missing", ...place };
  if (stat.size !== entry.size) return { status: "wrong-size", ...place, actualSize: stat.size };
  const cached = verifiedCache()[entry.path];
  const fresh = cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs && cached.sha256 === entry.sha256;
  return { status: fresh ? (cached.ok ? "verified" : "mismatch") : "present", ...place };
}

/** Why a missing entry can or cannot be restored here. */
function restoreRoute(entry, relative) {
  if (!entry.url) return { restorable: false, restoreNote: "No download address; restore it from the deployment's backup" };
  const [folder, file, extra] = String(relative || "").split("/");
  if (extra !== undefined) return { restorable: false, restoreNote: "In a subfolder; restore it with the deployment's tooling" };
  if (!restorableFolders.has(folder)) return { restorable: false, restoreNote: `HEISS doesn't download into ${folder}` };
  if (!/\.(safetensors|gguf)$/i.test(file || "")) return { restorable: false, restoreNote: "Only .safetensors and .gguf files download here" };
  return { restorable: true, folder, file };
}

export function manifestStatus() {
  const { source, entries, error } = loadManifest();
  const modelsDir = comfyModelsDir();
  const items = entries.map((entry) => {
    const state = stateOf(entry, modelsDir);
    const route = state.status === "missing" ? restoreRoute(entry, state.relative) : {};
    return { path: entry.path, size: entry.size, status: state.status, ...(state.reason ? { reason: state.reason } : {}), ...(state.actualSize !== undefined ? { actualSize: state.actualSize } : {}), ...(route.restoreNote ? { restoreNote: route.restoreNote } : {}), ...(route.restorable ? { restorable: true } : {}) };
  });
  const counts = Object.fromEntries(["verified", "present", "missing", "wrong-size", "mismatch", "external"].map((status) => [status, items.filter((item) => item.status === status).length]));
  return { source, ...(error ? { error } : {}), total: items.length, counts, restorable: items.filter((item) => item.restorable).length, items, verify: { ...verifyState } };
}

async function sha256Of(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 8 * 1024 * 1024 })) hash.update(chunk);
  return hash.digest("hex");
}

/** Hashes every present, unverified file in the background, one at a time. */
export function startVerify({ all = false } = {}) {
  if (verifyState.running) return { ...verifyState };
  const { entries } = loadManifest();
  const modelsDir = comfyModelsDir();
  const todo = entries.map((entry) => ({ entry, state: stateOf(entry, modelsDir) })).filter(({ state }) => state.file && (state.status === "present" || (all && ["verified", "mismatch"].includes(state.status))));
  Object.assign(verifyState, { running: true, done: 0, total: todo.length, current: "", startedAt: Date.now(), finishedAt: 0, error: "" });
  (async () => {
    for (const { entry, state } of todo) {
      verifyState.current = entry.path;
      try {
        const stat = fs.statSync(state.file);
        const digest = await sha256Of(state.file);
        verifiedCache()[entry.path] = { size: stat.size, mtimeMs: stat.mtimeMs, sha256: entry.sha256, ok: digest === entry.sha256, checkedAt: new Date().toISOString() };
        writeJsonFile(verifiedPath, verifiedCache(), { mode: 0o600 });
      } catch (error) { verifyState.error = `${entry.path}: ${error.message}`; }
      verifyState.done += 1;
    }
  })().finally(() => Object.assign(verifyState, { running: false, current: "", finishedAt: Date.now() }));
  return { ...verifyState };
}

/** Queues every missing, restorable entry (or the named ones) on HEISS's downloader. */
export function restoreMissing(paths = null) {
  const wanted = Array.isArray(paths) ? new Set(paths.map(String)) : null;
  const { entries } = loadManifest();
  const modelsDir = comfyModelsDir();
  const queued = [];
  const skipped = [];
  for (const entry of entries) {
    if (wanted && !wanted.has(entry.path)) continue;
    const state = stateOf(entry, modelsDir);
    if (state.status !== "missing") continue;
    const route = restoreRoute(entry, state.relative);
    if (!route.restorable) { skipped.push({ path: entry.path, reason: route.restoreNote }); continue; }
    try {
      startDownload({ id: `manifest:${entry.path}`, file: route.file, folder: route.folder, url: entry.url, sha256: entry.sha256, bytes: entry.size, label: route.file });
      queued.push(entry.path);
    } catch (error) { skipped.push({ path: entry.path, reason: error.message }); }
  }
  return { queued, skipped };
}
