/**
 * The assistant's fixed options, edited in Library › Prompt Styles: `<data>/prompt-styles.json`
 * holds `{styles, meta}`, the styles in menu order, each `{id, kind, label, description,
 * instruction, enabled, uncensored?}`. `kind` is the menu it belongs to: `improve` (Improve
 * Prompt's rewrite styles), `animate` (Animate's themes) or `change` (fixed AI edits); IDs are
 * unique within a kind. A data folder without the file has the built-in seed
 * (assistant-presets.js); the first save records it as version 1. Every save is a new version under
 * `<data>/history/prompt-styles/<n>.json`, refused when stale (`baseHash`); a chat draft is
 * AI-Drafted until an administrator approves it, as for guides (profile/store.js). Improve Prompt's
 * and Animate's Custom… are built in and never stored.
 */
import path from "node:path";
import { currentDataDir } from "./data-dir.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { customStyles, defaultPreset, seedStyles } from "./assistant-presets.js";
import { hashOf, versionsIn, writeVersion } from "./profile/store.js";
import { isObject } from "./values.js";

const origins = ["seed", "studio", "ai", "chat"];
export const styleKinds = ["improve", "animate", "change"];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** A saved list as the store keeps it, or a 400 naming what is wrong. */
export function cleanStyles(value) {
  if (!Array.isArray(value)) throw fail("Prompt styles are a list.");
  const seen = new Set();
  return value.map((entry, index) => {
    if (!isObject(entry)) throw fail(`Style ${index + 1} is not an object.`);
    const id = text(entry.id, 40);
    const kind = entry.kind;
    if (!styleKinds.includes(kind)) throw fail(`Style ${index + 1} needs a kind.`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || id === "custom" || seen.has(`${kind}:${id}`))
      throw fail(`Style ${index + 1} needs its own lowercase ID.`);
    seen.add(`${kind}:${id}`);
    const style = {
      id,
      kind,
      label: text(entry.label, 40),
      description: text(entry.description, 120),
      instruction: text(entry.instruction, 2000),
      enabled: entry.enabled !== false,
      ...(entry.uncensored === true ? { uncensored: true } : {}),
    };
    if (!style.label || !style.instruction)
      throw fail(`Style ${index + 1} needs a name and an instruction.`);
    return style;
  });
}

export function createPromptStyleStore({ dataDir = currentDataDir() } = {}) {
  const file = path.join(dataDir, "prompt-styles.json");
  const historyDir = path.join(dataDir, "history", "prompt-styles");
  const read = () => {
    try {
      const value = readJsonFile(file);
      return isObject(value) && Array.isArray(value.styles) ? value : null;
    } catch {
      return null;
    }
  };

  /** Every style in order, with the list's hash (an edit's base) and meta. */
  function list() {
    const stored = read();
    const styles = stored?.styles ?? structuredClone(seedStyles);
    return { styles, hash: hashOf(styles), meta: stored?.meta ?? null };
  }

  function addVersion(styles, { by, origin, aiDrafted = false, note = "" }) {
    const version = (versionsIn(historyDir).at(-1) || 0) + 1;
    const at = new Date().toISOString();
    const entry = {
      version,
      at,
      by: String(by || origin),
      origin,
      aiDrafted: Boolean(aiDrafted),
      hash: hashOf(styles),
      ...(note ? { note } : {}),
    };
    writeVersion(historyDir, version, { ...entry, styles });
    return { version, origin, aiDrafted: entry.aiDrafted, editedAt: at, by: entry.by };
  }

  /** Saves the whole list as a new version; unchanged is a no-op. */
  function save(value, { by = "", origin = "studio", aiDrafted = false, baseHash = "" } = {}) {
    if (!origins.includes(origin)) throw fail("Choose who made the change.");
    const current = list();
    if (baseHash && baseHash !== current.hash)
      throw fail(
        "The prompt styles changed since you opened them. Reload them, then make your edit again.",
        409,
      );
    const styles = cleanStyles(value);
    if (hashOf(styles) === current.hash && Boolean(current.meta?.aiDrafted) === Boolean(aiDrafted))
      return current;
    if (!versionsIn(historyDir).length)
      addVersion(current.styles, { by: "seed", origin: "seed", note: "Before the first edit" });
    const meta = addVersion(styles, { by, origin, aiDrafted });
    writeJsonFile(file, { styles, meta });
    return list();
  }

  function versions() {
    return versionsIn(historyDir)
      .reverse()
      .map((n) => {
        const { styles: _styles, ...rest } = version(n);
        return rest;
      });
  }

  function version(n) {
    if (!versionsIn(historyDir).includes(Number(n)))
      throw fail("That prompt styles version was not found.", 404);
    return readJsonFile(path.join(historyDir, `${Number(n)}.json`));
  }

  /** Restores an earlier version as a new version (history only grows). */
  const revert = (n, options) => save(version(n).styles, options);

  /** Clears AI-Drafted (an administrator reviewed the list). */
  function approve({ by = "" } = {}) {
    const stored = read();
    if (!stored?.meta?.aiDrafted) return list();
    stored.meta = {
      ...stored.meta,
      aiDrafted: false,
      approvedAt: new Date().toISOString(),
      approvedBy: String(by || ""),
    };
    writeJsonFile(file, stored);
    return list();
  }

  /** A kind's enabled styles in menu order, then its Custom where it has one. */
  const usable = (kind) => [
    ...list().styles.filter((style) => style.kind === kind && style.enabled),
    ...(customStyles[kind] ? [customStyles[kind]] : []),
  ];

  /** An enabled style or Custom of a kind by id; null otherwise. */
  const style = (kind, id) => usable(kind).find((entry) => entry.id === id) || null;

  /** The style a rewrite uses when none is asked for: Enhance where enabled, else the first. */
  const defaultId = () => (style("improve", defaultPreset) || usable("improve")[0]).id;

  return { file, list, save, versions, version, revert, approve, usable, style, defaultId };
}

const stores = new Map();
/** The shared store for a data folder: one writer per file. */
export function promptStyleStore(options = {}) {
  const key = options.dataDir || currentDataDir();
  if (!stores.has(key)) stores.set(key, createPromptStyleStore({ ...options, dataDir: key }));
  return stores.get(key);
}
