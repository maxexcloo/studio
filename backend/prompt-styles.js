/**
 * The assistant's fixed options, edited in Library › Templates: `<data>/prompt-styles.json`
 * holds `{styles, meta}`, each style `{id, kind, label, description,
 * instruction, enabled, uncensored?}`. An `uncensored` style is offered only to accounts with
 * Uncensored Models, which also see every other style. `kind` is the menu it belongs to: `improve` (Improve
 * Prompt's rewrite styles), `animate` (Animate's themes) or `change` (fixed AI edits); IDs are
 * unique within a kind. A data folder without the file has the built-in seed
 * (assistant-presets.js); the first save records it as version 1. Every save is a new version under
 * `<data>/history/prompt-styles/<n>.json`, refused when stale (`baseHash`); a chat draft is
 * AI-Drafted until an administrator approves it, as for guides (profile/store.js). Custom… and
 * Improve Prompt's Follow Guide are built in system options and never stored.
 */
import path from "node:path";

import { imageChangeActions } from "../shared/suggestions.ts";
import { customStyles, defaultPreset, seedStyles, systemStyles } from "./assistant-presets.js";
import { currentDataDir } from "./data-dir.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { hashOf, versionsIn, writeVersion } from "./profile/store.js";
import { isObject } from "./values.js";

const origins = ["seed", "studio", "ai", "chat"];
const styleKinds = ["improve", "animate", "change"];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** The IDs built in per kind, which a stored style must not take. */
const systemIds = new Set([
  ...Object.values(systemStyles).flatMap((styles) => styles.map((style) => style.id)),
  ...Object.values(customStyles).map((style) => style.id),
]);
const editableStyles = (styles) =>
  styles.filter((entry) => !systemStyles[entry.kind]?.some((style) => style.id === entry.id));

function cleanStyles(value) {
  if (!Array.isArray(value)) throw fail("Prompt styles are a list.");
  const seen = new Set();
  return value.map((entry, index) => {
    if (!isObject(entry)) throw fail(`Style ${index + 1} is not an object.`);
    const id = text(entry.id, 40);
    const kind = entry.kind;
    if (!styleKinds.includes(kind)) throw fail(`Style ${index + 1} needs a kind.`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || systemIds.has(id) || seen.has(`${kind}:${id}`))
      throw fail(`Style ${index + 1} needs its own lowercase ID.`);
    seen.add(`${kind}:${id}`);
    const actions = entry.actions;
    if (
      kind === "change" &&
      actions !== undefined &&
      (!Array.isArray(actions) ||
        !actions.length ||
        actions.some((action) => !imageChangeActions.includes(action)))
    )
      throw fail(`Style ${index + 1} needs Edit or Recreate as its action.`);
    const style = {
      id,
      kind,
      label: text(entry.label, 40),
      description: text(entry.description, 60),
      instruction: text(entry.instruction, 2000),
      enabled: entry.enabled !== false,
      ...(kind === "animate" && entry.modifier === true ? { modifier: true } : {}),
      ...(kind === "change" && actions && { actions: [...new Set(actions)] }),
      ...(entry.uncensored === true ? { uncensored: true } : {}),
    };
    if (!style.label || !style.description || !style.instruction)
      throw fail(`Style ${index + 1} needs a name, a brief and an instruction.`);
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
    const styles = stored ? stored.styles : structuredClone(seedStyles);
    return { styles: editableStyles(styles), hash: hashOf(styles), meta: stored?.meta ?? null };
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
  const revert = (n, options) => save(editableStyles(version(n).styles), options);

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

  /** A kind's enabled styles alphabetically, then its system styles, then Custom; not its modifiers. */
  const usable = (kind) => [
    ...list()
      .styles.filter((style) => style.kind === kind && style.enabled && !style.modifier)
      .sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }),
      ),
    ...(systemStyles[kind] || []),
    ...(customStyles[kind] ? [customStyles[kind]] : []),
  ];

  /** An enabled Animate modifier, by id; null otherwise. */
  const modifier = (id) =>
    list().styles.find(
      (entry) => entry.kind === "animate" && entry.id === id && entry.enabled && entry.modifier,
    ) || null;

  /** An enabled style, modifier, system style or Custom of a kind by id; null otherwise. */
  const style = (kind, id) =>
    usable(kind).find((entry) => entry.id === id) || (kind === "animate" ? modifier(id) : null);

  /** A kind's enabled modifiers alphabetically. */
  const modifiers = () =>
    list()
      .styles.filter((style) => style.kind === "animate" && style.enabled && style.modifier)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  /** The style a rewrite uses when none is asked for: Enhance where enabled, else the first. */
  const defaultId = () => (style("improve", defaultPreset) || usable("improve")[0]).id;

  return {
    file,
    list,
    save,
    versions,
    version,
    revert,
    approve,
    usable,
    modifiers,
    modifier,
    style,
    defaultId,
  };
}

const stores = new Map();
/** The shared store for a data folder: one writer per file. */
export function promptStyleStore(options = {}) {
  const key = options.dataDir || currentDataDir();
  if (!stores.has(key)) stores.set(key, createPromptStyleStore({ ...options, dataDir: key }));
  return stores.get(key);
}
