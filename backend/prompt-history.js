import path from "node:path";
import { dataDir, gallery } from "./gallery-store.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import crypto from "node:crypto";

/**
 * Prompts you generated with, newest first, kept on this computer so every
 * device on it sees the same list. A prompt used again moves to the top
 * instead of appearing twice; pinned ones stay no matter how many follow.
 *
 * It can be turned off (Settings › Generation): then nothing new is kept and
 * the recent ones are forgotten; starred prompts stay until unstarred.
 */

export const promptHistoryPath = path.join(dataDir, "prompt-history.json");
export const historyLimit = 500;
const pinnedLimit = 200;
const maxPromptLength = 8000;

/** Two prompts are the same when they only differ in spacing or case. */
export function promptKey(text = "") {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanText(text = "") {
  return String(text || "")
    .trim()
    .slice(0, maxPromptLength);
}

function cleanEntries(value) {
  const list = Array.isArray(value?.entries) ? value.entries : Array.isArray(value) ? value : [];
  const seen = new Set();
  const entries = [];
  for (const raw of list) {
    const text = cleanText(raw?.text);
    const key = promptKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    entries.push({
      text,
      at: Number.isFinite(Date.parse(raw?.at || ""))
        ? new Date(raw.at).toISOString()
        : new Date(0).toISOString(),
      uses: Math.max(0, Math.floor(Number(raw?.uses) || 0)),
      ...(raw?.pinned ? { pinned: true } : {}),
    });
  }
  return capEntries(entries);
}

/** Newest first; at most `historyLimit` unpinned and `pinnedLimit` pinned. */
function capEntries(entries) {
  const sorted = [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  let pinned = 0;
  let recent = 0;
  return sorted.filter((entry) =>
    entry.pinned ? (pinned += 1) <= pinnedLimit : (recent += 1) <= historyLimit,
  );
}

/** The list with `text` used once more at `at`. */
export function addPrompt(entries, text, at = new Date()) {
  const clean = cleanText(text);
  const key = promptKey(clean);
  if (!key) return entries;
  const previous = entries.find((entry) => promptKey(entry.text) === key);
  const next = {
    text: clean,
    at: new Date(at).toISOString(),
    uses: (previous?.uses || 0) + 1,
    ...(previous?.pinned ? { pinned: true } : {}),
  };
  return capEntries([next, ...entries.filter((entry) => entry !== previous)]);
}

export const negativePromptHistoryPath = path.join(dataDir, "negative-prompt-history.json");

function createHistory(
  field,
  historyPath,
  initiallyEnabled = () => true,
  initialSeedItems = () => gallery,
) {
  let cache = null;
  let enabled = true;

  /**
   * The saved list. The very first time there is none, it starts from the
   * prompts already in the gallery, so the list is useful from day one.
   */
  function loadPromptHistory(seedItems) {
    if (cache) return cache;
    try {
      const saved = readJsonFile(historyPath);
      enabled = saved?.enabled !== false;
      cache = cleanEntries(saved);
    } catch {
      enabled = initiallyEnabled();
      let entries = [];
      const seeds = (enabled ? (seedItems ?? initialSeedItems()) : [])
        .filter((item) => item?.[field] && item.status === "done")
        .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));
      for (const item of seeds)
        entries = addPrompt(entries, item[field], Date.parse(item.createdAt || "") || Date.now());
      cache = entries;
      if (entries.length) save();
    }
    return cache;
  }

  /**
   * `forget`: the store keeps the previous copy as .bak, and a prompt taken out
   * (forgotten, or cleared along with its image) must not stay in it.
   */
  function save({ forget = false } = {}) {
    writeJsonFile(historyPath, { version: 1, enabled, entries: cache || [] });
    if (forget) writeJsonFile(historyPath, { version: 1, enabled, entries: cache || [] });
  }

  function promptHistoryEnabled() {
    loadPromptHistory();
    return enabled;
  }

  /** Turning it off forgets the recent prompts (starred ones stay) and keeps no new ones. */
  function setPromptHistoryEnabled(on) {
    loadPromptHistory();
    enabled = Boolean(on);
    if (!enabled) cache = cache.filter((entry) => entry.pinned);
    save({ forget: !enabled });
    return cache;
  }

  function listPrompts() {
    return loadPromptHistory();
  }

  function recordPrompt(text) {
    if (!promptHistoryEnabled()) return cache;
    const entries = addPrompt(loadPromptHistory(), text);
    if (entries === cache) return cache;
    cache = entries;
    save();
    return cache;
  }

  function setPromptPinned(text, pinned) {
    const key = promptKey(text);
    const entries = loadPromptHistory();
    const found = entries.find((entry) => promptKey(entry.text) === key);
    // Pinning something not in the list yet (a prompt typed but never run) keeps it too.
    if (!found && !pinned) return entries;
    const clean = cleanText(text);
    if (!found && !promptKey(clean)) return entries;
    cache = capEntries(
      found
        ? entries.map((entry) => {
            if (entry !== found) return entry;
            const { pinned: _pinned, ...rest } = entry;
            return pinned ? { ...rest, pinned: true } : rest;
          })
        : [{ text: clean, at: new Date().toISOString(), uses: 0, pinned: true }, ...entries],
    );
    save();
    return cache;
  }

  /** Forgets these prompts. `keep` (keys) spares any that should stay, pinned or not. */
  function forgetPrompts(texts, keep = new Set()) {
    const keys = new Set(texts.map(promptKey).filter((key) => key && !keep.has(key)));
    if (!keys.size) return loadPromptHistory();
    const entries = loadPromptHistory();
    const next = entries.filter((entry) => !keys.has(promptKey(entry.text)));
    if (next.length === entries.length) return entries;
    cache = next;
    save({ forget: true });
    return cache;
  }

  function clearPromptHistory({ keepPinned = true } = {}) {
    cache = keepPinned ? loadPromptHistory().filter((entry) => entry.pinned) : [];
    save({ forget: true });
    return cache;
  }

  /** For tests: forget what was read, so the next call reads the file again. */
  function resetPromptHistoryCache() {
    cache = null;
  }
  return {
    clearPromptHistory,
    forgetPrompts,
    listPrompts,
    loadPromptHistory,
    promptHistoryEnabled,
    recordPrompt,
    resetPromptHistoryCache,
    setPromptHistoryEnabled,
    setPromptPinned,
  };
}

const historySets = new Map();
function historiesFor(ownerId = "") {
  const key = String(ownerId || "");
  if (!historySets.has(key)) {
    const directory = key
      ? path.join(dataDir, "accounts", crypto.createHash("sha256").update(key).digest("hex"))
      : dataDir;
    const paths = key
      ? {
          negative: path.join(directory, "negative-prompt-history.json"),
          positive: path.join(directory, "prompt-history.json"),
        }
      : { negative: negativePromptHistoryPath, positive: promptHistoryPath };
    const histories = {};
    const seeds = key ? () => [] : () => gallery;
    histories.negative = createHistory(
      "negative",
      paths.negative,
      () => histories.positive.promptHistoryEnabled(),
      seeds,
    );
    histories.positive = createHistory("prompt", paths.positive, () => true, seeds);
    historySets.set(key, histories);
  }
  return historySets.get(key);
}
const historyFor = (kind, ownerId) =>
  historiesFor(ownerId)[kind === "negative" ? "negative" : "positive"];

const loadPromptHistory = (seedItems, kind = "positive", ownerId = "") =>
  historyFor(kind, ownerId).loadPromptHistory(ownerId ? [] : seedItems);
export const listPrompts = (kind = "positive", ownerId = "") =>
  historyFor(kind, ownerId).listPrompts();
export const promptHistoryEnabled = (kind = "positive", ownerId = "") =>
  historyFor(kind, ownerId).promptHistoryEnabled();
export const recordPrompt = (text, kind = "positive", ownerId = "") =>
  historyFor(kind, ownerId).recordPrompt(text);
export const setPromptPinned = (text, pinned, kind = "positive", ownerId = "") =>
  historyFor(kind, ownerId).setPromptPinned(text, pinned);
export const forgetPrompts = (texts, keep = new Set(), kind = "positive", ownerId = "") =>
  historyFor(kind, ownerId).forgetPrompts(texts, keep);
export const clearPromptHistory = (options = {}, kind = "positive", ownerId = "") =>
  historyFor(kind, ownerId).clearPromptHistory(options);
export const setPromptHistoryEnabled = (on, ownerId = "") => {
  const histories = historiesFor(ownerId);
  histories.negative.setPromptHistoryEnabled(on);
  return histories.positive.setPromptHistoryEnabled(on);
};
export const resetPromptHistoryCache = () => {
  for (const histories of historySets.values())
    Object.values(histories).forEach((history) => history.resetPromptHistoryCache());
};
