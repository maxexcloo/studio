import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { comfy, comfyOutputDir, normalizeFolderInput, root, setComfyOutputDir } from "./comfy.js";
import { gallery, isComfyOutputItem, outputFolderMatch, outputsFrom } from "./gallery-store.js";

const mediaPattern = /\.(png|jpe?g|webp|gif|avif|mp4|webm|mov|mkv)$/i;
const scanLimit = 4000;

/** Count media in a folder and its direct subfolders, where Comfy often files videos. */
function countMedia(dir) {
  let media = 0;
  let seen = 0;
  let comfyNamed = false;
  const visit = (folder, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (seen >= scanLimit) return;
      seen += 1;
      if (entry.isFile() && mediaPattern.test(entry.name)) {
        media += 1;
        if (/^ComfyUI[_-]/i.test(entry.name)) comfyNamed = true;
      } else if (entry.isDirectory() && depth === 0 && !entry.name.startsWith(".")) {
        visit(path.join(folder, entry.name), 1);
      }
    }
  };
  visit(dir, 0);
  return { media, capped: seen >= scanLimit, comfyNamed };
}

function hasComfySiblings(dir) {
  const parent = path.dirname(dir);
  try {
    return ["models", "custom_nodes"].some((name) =>
      fs.statSync(path.join(parent, name)).isDirectory(),
    );
  } catch {
    return false;
  }
}

/** Newest Comfy outputs to test a folder against, from the gallery or, if empty, Comfy's history. */
async function sampleOutputs() {
  const known = gallery.filter((item) => item?.status === "done" && isComfyOutputItem(item));
  if (known.length) return known;
  const history = await comfy("/history?max_items=12").catch(() => ({}));
  const createdAt = new Date().toISOString();
  return Object.values(history || {}).flatMap((entry) =>
    outputsFrom(entry).map((output) => ({ ...output, id: output.url, status: "done", createdAt })),
  );
}

/**
 * Everything the settings row needs to say about a folder: does it exist, how
 * much media is in it, and does it hold the outputs Studio actually made.
 */
export async function inspectOutputDir(value, samples) {
  const dir = normalizeFolderInput(value);
  if (!dir) return { path: "", state: "empty" };
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    return { path: dir, state: "missing" };
  }
  if (!stat.isDirectory()) return { path: dir, state: "not-folder" };
  const { media, capped, comfyNamed } = countMedia(dir);
  const { checked, found } = outputFolderMatch(dir, samples || (await sampleOutputs()));
  const state = !checked ? "ok" : found ? "match" : "mismatch";
  return {
    path: dir,
    state,
    media,
    capped,
    checked,
    found,
    looksLikeComfy: comfyNamed || hasComfySiblings(dir),
  };
}

function argValue(argv, flag) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === flag && argv[index + 1]) return String(argv[index + 1]);
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return "";
}

/** A ComfyUI root is the folder that holds models/ or custom_nodes/. */
function rootFromComfyPath(value) {
  const parts = path.resolve(String(value || "")).split(/[\\/]/);
  const index = parts.findIndex((part) => part === "models" || part === "custom_nodes");
  return index > 0 ? parts.slice(0, index).join(path.sep) || path.sep : "";
}

function flattenStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => flattenStrings(item, out));
  else if (value && typeof value === "object")
    Object.values(value).forEach((item) => flattenStrings(item, out));
  return out;
}

/**
 * Ask ComfyUI where it writes, then fall back to the usual install spots. Each
 * candidate is inspected so the best one can be adopted without guessing.
 */
async function detectOutputDirs() {
  const found = new Map();
  const add = (dir, source) => {
    const resolved = normalizeFolderInput(dir);
    if (resolved && !found.has(resolved)) found.set(resolved, source);
  };
  const stats = await comfy("/system_stats").catch(() => null);
  const argv = Array.isArray(stats?.system?.argv) ? stats.system.argv : [];
  const explicit = argValue(argv, "--output-directory");
  if (explicit) add(explicit, "comfy");
  const baseDir = argValue(argv, "--base-directory");
  if (baseDir) add(path.join(baseDir, "output"), "comfy");
  const folders = await comfy("/internal/folder_paths").catch(() => null);
  const roots = new Set(flattenStrings(folders).map(rootFromComfyPath).filter(Boolean));
  for (const comfyRoot of roots) add(path.join(comfyRoot, "output"), "comfy");
  const home = os.homedir();
  for (const dir of [
    path.join(home, "ComfyUI", "output"),
    path.join(home, "Documents", "ComfyUI", "output"),
    path.join(path.dirname(root), "ComfyUI", "output"),
  ])
    add(dir, "common");
  const samples = await sampleOutputs();
  const candidates = [];
  for (const [dir, source] of found) {
    const report = await inspectOutputDir(dir, samples);
    if (report.state === "missing" || report.state === "not-folder") continue;
    candidates.push({ ...report, source });
  }
  const rank = (item) =>
    item.state === "match" ? 0 : item.state === "mismatch" ? 3 : item.source === "comfy" ? 1 : 2;
  candidates.sort(
    (a, b) =>
      rank(a) - rank(b) || (b.found || 0) - (a.found || 0) || (b.media || 0) - (a.media || 0),
  );
  return candidates;
}

let autoDetect = null;
/** Adopt a folder on first run when ComfyUI names it or it holds our outputs. */
export function autoDetectOutputDir() {
  if (comfyOutputDir) return Promise.resolve(comfyOutputDir);
  autoDetect ||= detectOutputDirs()
    .then((candidates) => {
      const best =
        candidates.find((item) => item.state === "match") ||
        candidates.find((item) => item.source === "comfy" && item.state === "ok");
      return best ? setComfyOutputDir(best.path) : "";
    })
    .catch(() => "")
    .finally(() => {
      autoDetect = null;
    });
  return autoDetect;
}
