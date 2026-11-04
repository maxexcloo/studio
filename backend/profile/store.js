// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Versioned generation profiles and prompting guides, owned by Studio.
 *
 * Profiles stay where they are (`<data>/workflows/<id>.json`, read by custom-workflows.js); every
 * change becomes an immutable version under `<data>/history/profiles/<id>/<n>.json`, and
 * `<data>/workflows/.studio-meta.json` records each profile's current version, origin, AI-Drafted
 * marker and who saved it. profile/editor.js still writes `.studio-edits.json` for every profile
 * Studio changed or drafted (the retired seed deploy read it to skip them).
 * `<data>/workflows/.studio-aliases.json` maps a removed profile id to the profile that replaced it
 * (`{"<old id>": {"to": "<kept id>", "backend"?, "at", "by", "reason"}}`, written by profile/merge.js,
 * profile/backends.js and profile/rename.js), so records that still name the old id resolve to the kept profile
 * through `canonical`, and a per-backend id merged into a combined profile runs on its own backend
 * (`aliasBackend`).
 *
 * Guides live in `<data>/guides/prompting.json`: the prompting.json schema (families, packs,
 * profiles, variants, negatives) plus `meta.<packId>`. Pack versions go under
 * `<data>/history/guides/<packId>/<n>.json`; the bindings (`families`, `profiles`, `variants`,
 * `negatives`) are versioned together as `_bindings`, an id no pack can have. The store is the only
 * source of guides. Studio is the only writer of live profiles and guides; Library › Profiles ›
 * Export backs them up.
 *
 * Origins: "seed" (a sample profile or an older seed), "studio" (an administrator in Studio), "ai"
 * (assistant drafts) and "chat" (MCP admin tools). An AI-drafted save sets aiDrafted; an
 * administrator's edit or Approve clears it. Each store has one writer (this module) and writes
 * atomically (json-store.js).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { currentDataDir } from "../data-dir.js";
import { readJsonFile, writeJsonFile } from "../json-store.js";
import { loadMcpPrompting } from "../mcp/prompting.js";

const versionOrigins = Object.freeze(["seed", "studio", "ai", "chat"]);
export const validId = (id) =>
  /^[a-z0-9][a-z0-9._-]{0,79}$/.test(String(id || "")) && !String(id).includes("..");
const validPackId = (id) =>
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(String(id || "")) && !String(id).includes("..");
export const hashOf = (value) =>
  crypto
    .createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const stamp = () => new Date().toISOString();
const notFound = (message) => Object.assign(new Error(message), { status: 404 });
const conflict = (message) => Object.assign(new Error(message), { status: 409 });

function readObject(file, fallback = {}, recover = true) {
  try {
    const value = recover ? readJsonFile(file) : JSON.parse(fs.readFileSync(file, "utf8"));
    return isObject(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

/** Version numbers kept in a history folder, ascending. */
function versionsIn(dir) {
  try {
    return fs
      .readdirSync(dir)
      .map((name) => /^(\d+)\.json$/.exec(name)?.[1])
      .filter(Boolean)
      .map(Number)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** Writes version `n` once; an existing version is never replaced. */
function writeVersion(dir, n, record) {
  const file = path.join(dir, `${n}.json`);
  if (fs.existsSync(file)) throw conflict(`Version ${n} already exists.`);
  writeJsonFile(file, record, { mode: 0o600 });
}

/* ------------------------------------------------------------ Profiles */

export function createProfileStore({
  dataDir = currentDataDir(),
  workflowsDir = path.join(dataDir, "workflows"),
  log = console,
} = {}) {
  const metaFile = path.join(workflowsDir, ".studio-meta.json");
  const aliasFile = path.join(workflowsDir, ".studio-aliases.json");
  const editsFile = path.join(workflowsDir, ".studio-edits.json");
  const backupsDir = path.join(dataDir, "backups", "profile-edits");
  const historyDir = (id) => path.join(dataDir, "history", "profiles", id);
  const readMeta = () => readObject(metaFile);

  function latest(id) {
    const versions = versionsIn(historyDir(id));
    if (!versions.length) return null;
    return readJsonFile(path.join(historyDir(id), `${versions.at(-1)}.json`));
  }

  /**
   * Records `text` as the profile's next version, unless it is already the latest. Returns the
   * version record (the existing one when unchanged).
   */
  function record(
    id,
    text,
    { by = "", origin = "studio", aiDrafted = false, at = stamp(), note = "" } = {},
  ) {
    if (!validId(id)) throw notFound("That profile was not found.");
    if (!versionOrigins.includes(origin)) throw new Error("Choose who made the change.");
    const body = String(text ?? "");
    const hash = hashOf(body);
    const previous = latest(id);
    const meta = readMeta();
    if (previous?.hash === hash) return previous;
    const version = (previous?.version || 0) + 1;
    const entry = {
      id,
      version,
      at,
      by: String(by || origin),
      origin,
      aiDrafted: Boolean(aiDrafted),
      hash,
      ...(note ? { note } : {}),
      text: body,
    };
    writeVersion(historyDir(id), version, entry);
    const current = meta[id] || {};
    meta[id] = {
      ...current,
      version,
      origin,
      aiDrafted: Boolean(aiDrafted),
      editedAt: at,
      by: entry.by,
      seedHash: current.seedHash || (origin === "seed" ? hash : ""),
      exportedHash: current.exportedHash || "",
    };
    if (origin === "seed") meta[id].seedHash = hash;
    writeJsonFile(metaFile, meta);
    return entry;
  }

  /** Every version of a profile, newest first, without their text. */
  function versions(id) {
    if (!validId(id)) throw notFound("That profile was not found.");
    return versionsIn(historyDir(id))
      .reverse()
      .map((n) => {
        const { text: _text, ...rest } = readJsonFile(path.join(historyDir(id), `${n}.json`));
        return rest;
      });
  }

  function version(id, n) {
    const file = path.join(historyDir(id), `${Number(n)}.json`);
    if (!validId(id) || !Number.isSafeInteger(Number(n)) || !fs.existsSync(file))
      throw notFound("That profile version was not found.");
    return readJsonFile(file);
  }

  /** Clears AI-Drafted on the current version (an administrator reviewed it). */
  function approve(id, { by = "" } = {}) {
    const meta = readMeta();
    if (!meta[id]) throw notFound("That profile was not found.");
    if (!meta[id].aiDrafted) return meta[id];
    meta[id] = { ...meta[id], aiDrafted: false, approvedAt: stamp(), approvedBy: String(by || "") };
    writeJsonFile(metaFile, meta);
    return meta[id];
  }

  /**
   * The boot migration, safe on every start. A profile without history gets its backups (oldest
   * first; the oldest is the seed) and its current file as versions; one listed in
   * `.studio-edits.json` has its later versions marked "studio". A profile whose file changed
   * outside Studio (a seed deploy) gets that as a new "seed" version. Nothing is deleted.
   */
  function migrate() {
    if (!fs.existsSync(workflowsDir)) return { profiles: 0, versions: 0 };
    const edits = readObject(editsFile);
    let backups = [];
    try {
      backups = fs
        .readdirSync(backupsDir)
        .filter((name) => name.endsWith(".json"))
        .sort();
    } catch {
      /* none */
    }
    let profiles = 0;
    let added = 0;
    for (const name of fs.readdirSync(workflowsDir)) {
      if (!name.endsWith(".json") || name.startsWith(".")) continue;
      const id = name.slice(0, -5);
      if (!validId(id)) continue;
      let text;
      try {
        text = fs.readFileSync(path.join(workflowsDir, name), "utf8");
      } catch {
        continue;
      }
      profiles += 1;
      const edited = edits[id];
      if (!versionsIn(historyDir(id)).length) {
        const own = backups.filter(
          (file) =>
            file.startsWith(`${id}-`) && /^\d{4}-\d{2}-\d{2}T/.test(file.slice(id.length + 1)),
        );
        const steps = own
          .map((file) => {
            const when = file
              .slice(id.length + 1, -5)
              .replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1:$2:$3.$4Z");
            let body = "";
            try {
              body = fs.readFileSync(path.join(backupsDir, file), "utf8");
            } catch {
              return null;
            }
            return { text: body, at: Number.isNaN(Date.parse(when)) ? stamp() : when };
          })
          .filter(Boolean);
        steps.push({ text, at: edited?.editedAt || stamp() });
        steps.forEach((step, index) => {
          const origin = index === 0 || !edited ? "seed" : "studio";
          const before = latest(id)?.version || 0;
          record(id, step.text, {
            origin,
            at: step.at,
            by:
              origin === "studio" && index === steps.length - 1
                ? edited?.by || "studio"
                : origin === "seed"
                  ? "seed"
                  : "studio",
            note: index < steps.length - 1 ? "From backups/profile-edits" : "",
          });
          if ((latest(id)?.version || 0) > before) added += 1;
        });
        const meta = readMeta();
        if (edited?.baseHash && meta[id]) {
          meta[id].seedHash = edited.baseHash;
          writeJsonFile(metaFile, meta);
        }
      } else if (latest(id)?.hash !== hashOf(text)) {
        record(id, text, {
          origin: edited ? "studio" : "seed",
          by: edited ? edited.by || "studio" : "seed",
          note: "Changed outside Studio",
        });
        added += 1;
      }
    }
    if (added)
      log.info?.(
        `[profiles] Recorded ${added} profile version${added === 1 ? "" : "s"} under history/profiles.`,
      );
    return { profiles, versions: added };
  }

  /** Records what an export held (`{id: hash}`), so the next export can say what changed since. */
  function markExported(hashes) {
    const meta = readMeta();
    let changed = false;
    for (const [id, hash] of Object.entries(hashes))
      if (meta[id] && meta[id].exportedHash !== hash) {
        meta[id] = { ...meta[id], exportedHash: hash };
        changed = true;
      }
    if (changed) writeJsonFile(metaFile, meta);
  }

  // Read on every lookup, so it is cached on the file's size and modification time.
  let aliasCache = { signature: "", value: {} };
  function aliases() {
    let signature = "";
    try {
      const stat = fs.statSync(aliasFile);
      signature = `${stat.size}:${stat.mtimeMs}`;
    } catch {
      return {};
    }
    if (aliasCache.signature !== signature)
      aliasCache = { signature, value: readObject(aliasFile) };
    return aliasCache.value;
  }

  /**
   * The id a profile goes by now: an alias's kept id (following later merges), else the id as
   * given. Takes `custom:<id>` or a bare id and answers in the same form.
   */
  function canonical(value) {
    if (typeof value !== "string" || !value) return value;
    const prefixed = value.startsWith("custom:");
    let id = prefixed ? value.slice(7) : value;
    const map = aliases();
    for (const seen = new Set([id]); typeof map[id]?.to === "string"; seen.add(id)) {
      if (seen.has(map[id].to)) break;
      id = map[id].to;
    }
    return prefixed ? `custom:${id}` : id;
  }

  /**
   * The backend an old id ran on, when it was merged into a combined profile: the first alias on
   * its way to the kept id that names one. Takes `custom:<id>` or a bare id; "" otherwise.
   */
  function aliasBackend(value) {
    if (typeof value !== "string" || !value) return "";
    let id = value.startsWith("custom:") ? value.slice(7) : value;
    const map = aliases();
    for (const seen = new Set([id]); typeof map[id]?.to === "string"; seen.add(id)) {
      if (typeof map[id].backend === "string" && map[id].backend) return map[id].backend;
      if (seen.has(map[id].to)) break;
      id = map[id].to;
    }
    return "";
  }

  /** Records `{from, to, backend?, reason}` aliases: `from` now resolves to `to` (on `backend`). */
  function addAliases(entries, { by = "", at = stamp() } = {}) {
    const next = { ...aliases() };
    for (const { from, to, backend = "", reason = "" } of entries) {
      if (!validId(from) || !validId(to) || from === to) throw new Error("Choose two profile ids.");
      next[from] = {
        to,
        ...(backend ? { backend: String(backend) } : {}),
        at,
        by: String(by || ""),
        ...(reason ? { reason } : {}),
      };
    }
    writeJsonFile(aliasFile, next);
    return next;
  }

  /**
   * Gives profile `from` the id `to` (profile/rename.js): its alias first, so an interrupted
   * rename resolves and finishes on a second run, then its version history, meta and edit record,
   * then `text` (the file's new body, written by the caller) as its next version.
   */
  function rename(from, to, text, { by = "", note = "" } = {}) {
    if (!validId(from) || !validId(to) || from === to) throw new Error("Choose two profile ids.");
    if (aliases()[from]?.to !== to) addAliases([{ from, to, reason: "renamed" }], { by });
    if (fs.existsSync(historyDir(from)) && !fs.existsSync(historyDir(to))) {
      fs.mkdirSync(path.dirname(historyDir(to)), { recursive: true });
      fs.renameSync(historyDir(from), historyDir(to));
    }
    for (const file of [metaFile, editsFile]) {
      const records = readObject(file);
      if (!Object.hasOwn(records, from)) continue;
      records[to] ??= records[from];
      delete records[from];
      writeJsonFile(file, records);
    }
    return record(to, text, { by, aiDrafted: meta(to)?.aiDrafted === true, note });
  }

  const meta = (id) => readMeta()[id] || null;

  /**
   * Whether Studio has ever held this profile (any version) or merged it into another, so a seed
   * never brings back one it removed.
   */
  const known = (id) =>
    versionsIn(historyDir(id)).length > 0 ||
    Boolean(readMeta()[id]) ||
    Object.hasOwn(aliases(), id);

  return {
    metaFile,
    aliasFile,
    aliases,
    canonical,
    aliasBackend,
    addAliases,
    record,
    versions,
    version,
    approve,
    migrate,
    markExported,
    known,
    rename,
    meta,
    metas: readMeta,
  };
}

/* ------------------------------------------------------------ Guides */

const bindingSections = ["families", "negatives", "profiles", "variants"];
const bindingsId = "_bindings";
const versionedId = (id) => id === bindingsId || validPackId(id);
const bindingsOf = (store) =>
  Object.fromEntries(bindingSections.map((key) => [key, isObject(store?.[key]) ? store[key] : {}]));

/** A pack is a plain object of guidance; the store adds nothing to it. */
function cleanPack(pack) {
  if (!isObject(pack)) throw new Error("A guide pack is a JSON object.");
  if (pack.modes !== undefined && !isObject(pack.modes))
    throw new Error("A guide pack’s modes are an object.");
  return structuredClone(pack);
}

export function createGuideStore({ dataDir = currentDataDir() } = {}) {
  const file = path.join(dataDir, "guides", "prompting.json");
  const historyDir = (packId) => path.join(dataDir, "history", "guides", packId);
  const read = () => {
    try {
      const value = readJsonFile(file);
      return isObject(value) ? value : null;
    } catch {
      return null;
    }
  };

  /** Throws unless the MCP loader reads `store`; run before a version is recorded or the store replaced. */
  function check(store) {
    const { meta: _meta, ...config } = store;
    const checked = path.join(path.dirname(file), ".check-prompting.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(checked, JSON.stringify(config));
    try {
      loadMcpPrompting(checked);
    } finally {
      fs.rmSync(checked, { force: true });
    }
  }

  function writeStore(store) {
    check(store);
    writeJsonFile(file, store);
  }

  function addVersion(
    store,
    packId,
    pack,
    { by, origin, aiDrafted = false, note = "", field = "pack" },
  ) {
    const hash = hashOf(pack);
    const versions = versionsIn(historyDir(packId));
    const version = (versions.at(-1) || 0) + 1;
    const at = stamp();
    writeVersion(historyDir(packId), version, {
      packId,
      version,
      at,
      by: String(by || origin),
      origin,
      aiDrafted: Boolean(aiDrafted),
      hash,
      ...(note ? { note } : {}),
      [field]: pack,
    });
    const current = store.meta[packId] || {};
    store.meta[packId] = {
      version,
      origin,
      aiDrafted: Boolean(aiDrafted),
      editedAt: at,
      by: String(by || origin),
      seedHash: origin === "seed" ? hash : current.seedHash || "",
      exportedHash: current.exportedHash || "",
    };
  }

  /** One pack with its meta and hash, for an edit's base. */
  function pack(packId) {
    const store = read();
    if (!store?.packs?.[packId]) throw notFound("That guide was not found.");
    return {
      packId,
      pack: store.packs[packId],
      hash: hashOf(store.packs[packId]),
      meta: store.meta?.[packId] || null,
    };
  }

  /**
   * Saves a pack as a new version. `baseHash` (the pack's hash when opened) refuses a stale edit;
   * an AI draft sets aiDrafted, any other save clears it. A new packId adds a pack.
   */
  function save(
    packId,
    value,
    { by = "", origin = "studio", aiDrafted = false, baseHash = "" } = {},
  ) {
    if (!validPackId(packId)) throw new Error("Choose a valid guide id.");
    if (!versionOrigins.includes(origin)) throw new Error("Choose who made the change.");
    const store = read() || { packs: {}, meta: {} };
    store.packs = { ...(store.packs || {}) };
    store.meta = { ...(store.meta || {}) };
    if (baseHash && store.packs[packId] && hashOf(store.packs[packId]) !== baseHash)
      throw conflict(
        "This guide changed since you opened it. Reload it, then make your edit again.",
      );
    const next = cleanPack(value);
    if (
      store.packs[packId] &&
      hashOf(store.packs[packId]) === hashOf(next) &&
      Boolean(store.meta[packId]?.aiDrafted) === Boolean(aiDrafted)
    )
      return pack(packId);
    store.packs[packId] = next;
    check(store);
    addVersion(store, packId, next, { by, origin, aiDrafted });
    writeStore(store);
    return pack(packId);
  }

  /**
   * Removes a pack when `baseHash` is its current hash and no profile binding or family uses it
   * (409 otherwise). Its versions stay, the last holding it, so reverting to that version restores it.
   */
  function remove(packId, { by = "", origin = "studio", baseHash = "" } = {}) {
    const { pack: value, hash } = pack(packId);
    if (baseHash !== hash)
      throw conflict("This guide changed since you opened it. Reload it, then remove it again.");
    const store = read();
    const users = [
      ...Object.entries(store.profiles || {})
        .filter(([, binding]) => binding?.pack === packId)
        .map(([id]) => id),
      ...Object.entries(store.families || {}).flatMap(([family, kinds]) =>
        Object.entries(kinds || {})
          .filter(([, id]) => id === packId)
          .map(([kind]) => `the ${family} family (${kind})`),
      ),
    ];
    if (users.length)
      throw conflict(
        `This guide is still used by ${users.join(", ")}. Bind them to another guide first, then remove it.`,
      );
    store.meta = { ...(store.meta || {}) };
    const last = versionsIn(historyDir(packId)).at(-1);
    if (!last || readJsonFile(path.join(historyDir(packId), `${last}.json`)).hash !== hash)
      addVersion(store, packId, value, { by, origin, note: "Before removing" });
    delete store.packs[packId];
    delete store.meta[packId];
    writeStore(store);
    return { removed: packId };
  }

  function versions(packId) {
    if (!versionedId(packId)) throw notFound("That guide was not found.");
    return versionsIn(historyDir(packId))
      .reverse()
      .map((n) => {
        const {
          pack: _pack,
          bindings: _bindings,
          ...rest
        } = readJsonFile(path.join(historyDir(packId), `${n}.json`));
        return rest;
      });
  }

  function version(packId, n) {
    const target = path.join(historyDir(packId), `${Number(n)}.json`);
    if (!versionedId(packId) || !Number.isSafeInteger(Number(n)) || !fs.existsSync(target))
      throw notFound("That guide version was not found.");
    return readJsonFile(target);
  }

  /** Restores an earlier version as a new version (history only grows). */
  function revert(packId, n, { by = "", baseHash = "", origin = "studio" } = {}) {
    const old = version(packId, n);
    return save(packId, old.pack, { by, origin, baseHash });
  }

  /** The profile bindings with their hash (an edit's base) and meta. */
  function bindings() {
    const store = read() || {};
    const value = bindingsOf(store);
    return {
      bindings: value,
      hash: hashOf(value),
      meta: store.meta?.[bindingsId] || null,
    };
  }

  /**
   * Writes `next` bindings as a new version, as `save` does for a pack; the bindings before the
   * first version are recorded first, so revert can always go back. Unchanged is a no-op.
   */
  function writeBindings(store, next, { by, origin, aiDrafted, note = "" }) {
    store.meta = { ...(store.meta || {}) };
    // Studio's own moves (a drafted profile's binding, Combine Backends) keep the review state.
    aiDrafted ??= store.meta[bindingsId]?.aiDrafted === true;
    if (
      hashOf(next) === hashOf(bindingsOf(store)) &&
      Boolean(store.meta[bindingsId]?.aiDrafted) === Boolean(aiDrafted)
    )
      return bindings();
    check({ ...store, ...next });
    if (!versionsIn(historyDir(bindingsId)).length)
      addVersion(store, bindingsId, bindingsOf(store), {
        by: "seed",
        origin: "seed",
        note: "Before the first edit",
        field: "bindings",
      });
    Object.assign(store, structuredClone(next));
    addVersion(store, bindingsId, next, {
      by,
      origin,
      aiDrafted,
      note,
      field: "bindings",
    });
    writeStore(store);
    return bindings();
  }

  /**
   * Replaces the bindings (`{families, negatives, profiles, variants}`, each an object) as a new
   * version; a section `value` leaves out keeps its current entries, so restoring a version from
   * before the family map keeps it. `baseHash` refuses a stale edit; an AI draft sets aiDrafted,
   * any other save clears it.
   */
  function saveBindings(
    value,
    { by = "", origin = "studio", aiDrafted = false, baseHash = "", note = "" } = {},
  ) {
    if (!versionOrigins.includes(origin)) throw new Error("Choose who made the change.");
    if (!isObject(value) || bindingSections.some((key) => !isObject(value[key] ?? {})))
      throw new Error(
        "Guide bindings are an object of families, negatives, profiles and variants objects.",
      );
    const store = read();
    if (!store) throw notFound("There are no guides yet.");
    if (baseHash && hashOf(bindingsOf(store)) !== baseHash)
      throw conflict(
        "These guide bindings changed since you opened them. Reload them, then make your edit again.",
      );
    return writeBindings(store, bindingsOf({ ...bindingsOf(store), ...value }), {
      by,
      origin,
      aiDrafted: Boolean(aiDrafted),
      note,
    });
  }

  /** Restores an earlier version of the bindings as a new version. */
  function revertBindings(n, { by = "", baseHash = "", origin = "studio" } = {}) {
    return saveBindings(version(bindingsId, n).bindings, {
      by,
      origin,
      baseHash,
    });
  }

  /**
   * Removes every binding, variant and negatives entry keyed by one of `profileIds`
   * (`custom:<id>`), and copies `from`'s binding and negatives to `to` where `to` has none, as a new
   * version: Combine Backends gives the combined profile its default backend's and drops the ids it
   * merged; migrate-runtime drops the ids of profiles that no longer exist.
   */
  function moveProfileBindings({ remove = [], from = "", to = "" }, { by = "", note = "" } = {}) {
    const store = read();
    if (!store) return bindings();
    const next = structuredClone(bindingsOf(store));
    if (from && to)
      for (const key of ["profiles", "negatives"])
        if (isObject(next[key][from]) && !Object.hasOwn(next[key], to))
          next[key][to] = structuredClone(next[key][from]);
    for (const key of bindingSections) for (const id of remove) delete next[key][id];
    return writeBindings(store, next, { by, origin: "studio", note });
  }

  /**
   * Renames packs (`{from: to}`) with their meta and versions, and moves the bindings and
   * negatives of renamed profiles (`{"custom:<from>": "custom:<to>"}`) onto the new key (a key
   * the new id already has keeps its own), as one version of the bindings (profile/rename.js).
   * A pack whose new id is taken stays. Returns the packs it renamed and the bindings it moved.
   */
  function rename({ packs = {}, profiles = {} }, { by = "", note = "" } = {}) {
    const store = read();
    if (!store) return { packs: [], bindings: 0 };
    store.packs = { ...(store.packs || {}) };
    store.meta = { ...(store.meta || {}) };
    const renamed = [];
    for (const [from, to] of Object.entries(packs)) {
      if (!store.packs[from] || store.packs[to]) continue;
      if (!validPackId(to)) throw new Error("Choose a valid guide id.");
      store.packs[to] = store.packs[from];
      delete store.packs[from];
      if (store.meta[from]) store.meta[to] = store.meta[from];
      delete store.meta[from];
      if (fs.existsSync(historyDir(from)) && !fs.existsSync(historyDir(to)))
        fs.renameSync(historyDir(from), historyDir(to));
      renamed.push(from);
    }
    const next = structuredClone(bindingsOf(store));
    const packOf = (id) => (Object.hasOwn(packs, id) && store.packs[packs[id]] ? packs[id] : id);
    for (const kinds of Object.values(next.families))
      if (isObject(kinds)) for (const kind of Object.keys(kinds)) kinds[kind] = packOf(kinds[kind]);
    let moved = 0;
    for (const key of ["profiles", "negatives"])
      for (const [from, to] of Object.entries(profiles)) {
        if (!Object.hasOwn(next[key], from)) continue;
        next[key][to] ??= next[key][from];
        delete next[key][from];
        moved += 1;
      }
    for (const binding of Object.values(next.profiles))
      if (isObject(binding) && binding.pack) binding.pack = packOf(binding.pack);
    if (hashOf(next) !== hashOf(bindingsOf(store)))
      writeBindings(store, next, { by, origin: "studio", note });
    else if (renamed.length) writeStore(store);
    return { packs: renamed, bindings: moved };
  }

  function approve(packId, { by = "" } = {}) {
    const store = read();
    if (!store?.meta?.[packId]) throw notFound("That guide was not found.");
    if (!store.meta[packId].aiDrafted) return store.meta[packId];
    store.meta[packId] = {
      ...store.meta[packId],
      aiDrafted: false,
      approvedAt: stamp(),
      approvedBy: String(by || ""),
    };
    writeJsonFile(file, store);
    return store.meta[packId];
  }

  /**
   * Which pack guides a profile (`{id, family, kind}`), as loadMcpPrompting picks it: the
   * profile's own binding, else its family's pack for its kind. Null without one.
   */
  function resolve(profile = {}) {
    const store = read() || {};
    const binding = isObject(store.profiles?.[profile.id]) ? store.profiles[profile.id] : null;
    const packId = binding?.pack ?? store.families?.[profile.family]?.[profile.kind];
    if (!packId || !store.packs?.[packId]) return null;
    return {
      packId,
      source: binding?.pack ? "profile" : "family",
      ...(binding?.variant ? { variant: binding.variant } : {}),
      ...(binding?.mode ? { mode: binding.mode } : {}),
    };
  }

  /** Binds a profile (`custom:<id>`) to a pack, as a drafted profile's guide. */
  function bind(profileId, packId) {
    const store = read();
    if (!store?.packs?.[packId]) throw notFound("That guide was not found.");
    if (!/^[a-z0-9][a-z0-9._:-]{0,119}$/i.test(String(profileId || "")))
      throw new Error("Choose a valid profile id.");
    const next = structuredClone(bindingsOf(store));
    next.profiles[profileId] = { pack: packId };
    writeBindings(store, next, {
      by: "assistant",
      origin: "ai",
      note: `Bound ${profileId} to ${packId}`,
    });
  }

  /** Records what an export held, so the next export can say what changed since. */
  function markExported(hashes) {
    const store = read();
    if (!store?.meta) return;
    let changed = false;
    for (const [packId, hash] of Object.entries(hashes))
      if (store.meta[packId] && store.meta[packId].exportedHash !== hash) {
        store.meta[packId] = { ...store.meta[packId], exportedHash: hash };
        changed = true;
      }
    if (changed) writeJsonFile(file, store);
  }

  /** The configuration file the guide loader reads: the store once it exists, else none. */
  const configFile = () => (fs.existsSync(file) ? file : "");

  return {
    file,
    pack,
    save,
    versions,
    version,
    revert,
    remove,
    approve,
    resolve,
    bind,
    bindings,
    saveBindings,
    revertBindings,
    moveProfileBindings,
    rename,
    markExported,
    configFile,
    read,
  };
}

/**
 * The guide resolver (loadMcpPrompting) over the guide store, reloaded whenever the store changes,
 * so a saved guide applies without a restart. A store that fails to load keeps the last good guides.
 */
export function livePrompting({ dataDir = currentDataDir(), log = console } = {}) {
  const store = createGuideStore({ dataDir });
  let loaded = null;
  let signature = null;
  const current = () => {
    const target = store.configFile();
    let next = "";
    try {
      const stat = target ? fs.statSync(target) : null;
      next = stat ? `${target}:${stat.size}:${stat.mtimeMs}` : "";
    } catch {
      next = "";
    }
    if (loaded && next === signature) return loaded;
    try {
      loaded = loadMcpPrompting(target);
      signature = next;
    } catch (error) {
      if (!loaded) throw error;
      log.warn?.(`[guides] Kept the previous prompting guides: ${error.message}`);
      signature = next;
    }
    return loaded;
  };
  current();
  return (profile) => current()(profile);
}

const profileStores = new Map();
const guideStores = new Map();
/** The shared stores for a data folder: one writer per file. */
export function profileStore(options = {}) {
  const key = options.dataDir || currentDataDir();
  if (!profileStores.has(key))
    profileStores.set(key, createProfileStore({ ...options, dataDir: key }));
  return profileStores.get(key);
}
/** The id a profile goes by now in the current data folder (profile ids merged away resolve to the kept one). */
export const canonicalProfileId = (id) => profileStore().canonical(id);
/** The backend a merged per-backend profile id ran on ("" for any other id). */
export const profileAliasBackend = (id) => profileStore().aliasBackend(id);
/** A record whose settings name a merged profile, as a copy with the kept id; otherwise the record itself. */
export function withCanonicalProfile(item) {
  const id = item?.settings?.profileId;
  const kept = canonicalProfileId(id);
  return kept === id ? item : { ...item, settings: { ...item.settings, profileId: kept } };
}
export function guideStore(options = {}) {
  const key = options.dataDir || currentDataDir();
  if (!guideStores.has(key)) guideStores.set(key, createGuideStore({ ...options, dataDir: key }));
  return guideStores.get(key);
}
