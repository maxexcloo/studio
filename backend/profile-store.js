// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Versioned generation profiles and prompting guides, owned by Studio.
 *
 * Profiles stay where they are (`<data>/workflows/<id>.json`, read by custom-workflows.js); every
 * change becomes an immutable version under `<data>/history/profiles/<id>/<n>.json`, and
 * `<data>/workflows/.studio-meta.json` records each profile's current version, origin, AI-Drafted
 * marker and who saved it. profile-editor.js still writes `.studio-edits.json` for every profile
 * Studio changed or drafted (the retired seed deploy read it to skip them).
 * `<data>/workflows/.studio-aliases.json` maps a removed profile id to the profile that replaced it
 * (`{"<old id>": {"to": "<kept id>", "backend"?, "at", "by", "reason"}}`, written by profile-merge.js
 * and profile-backends.js), so records that still name the old id resolve to the kept profile
 * through `canonical`, and a per-backend id merged into a combined profile runs on its own backend
 * (`aliasBackend`).
 *
 * Guides live in `<data>/guides/prompting.json`: the prompting.json schema (families, packs,
 * profiles, variants, negatives) plus `meta.<packId>`. Pack versions go under
 * `<data>/history/guides/<packId>/<n>.json`. The deployment's STUDIO_MCP_PROMPTING_PATH is seed input
 * only: it fills a new install and adds packs and bindings Studio doesn't have, and never
 * replaces one Studio holds. Studio is the only writer of live profiles and guides; the profiles
 * repository (`ai/profiles/`) is their seed and backup, fed by Settings › Profiles › Export.
 *
 * Origins: "seed" (a sample profile or an older seed), "studio" (an administrator in Studio), "ai"
 * (assistant drafts) and "chat" (MCP admin tools). An AI-drafted save sets aiDrafted; an
 * administrator's edit or Approve clears it. Each store has one writer (this module) and writes
 * atomically (json-store.js).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { currentDataDir } from "./data-dir.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { loadMcpPrompting } from "./mcp-prompting.js";

const versionOrigins = Object.freeze(["seed", "studio", "ai", "chat"]);
const validId = (id) =>
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
    meta: (id) => readMeta()[id] || null,
    metas: readMeta,
  };
}

/* ------------------------------------------------------------ Guides */

const sections = ["reviewed_on", "families", "profiles", "variants", "negatives"];

/** A pack is a plain object of guidance; the store adds nothing to it. */
function cleanPack(pack) {
  if (!isObject(pack)) throw new Error("A guide pack is a JSON object.");
  if (pack.modes !== undefined && !isObject(pack.modes))
    throw new Error("A guide pack’s modes are an object.");
  return structuredClone(pack);
}

/** The guides' seed, STUDIO_MCP_PROMPTING_PATH, or "". */
export const guideSeedFile = (environment = process.env) =>
  environment.STUDIO_MCP_PROMPTING_PATH || "";

export function createGuideStore({
  dataDir = currentDataDir(),
  seedFile = guideSeedFile(),
  log = console,
} = {}) {
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
  const readSeed = () => {
    if (!seedFile) return null;
    try {
      const value = JSON.parse(fs.readFileSync(seedFile, "utf8"));
      return isObject(value) ? value : null;
    } catch {
      return null;
    }
  };

  function writeStore(store) {
    // Checked as the MCP loader reads it before it replaces the good copy.
    const { meta: _meta, ...config } = store;
    const checked = path.join(path.dirname(file), ".check-prompting.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(checked, JSON.stringify(config));
    try {
      loadMcpPrompting(checked);
    } finally {
      fs.rmSync(checked, { force: true });
    }
    writeJsonFile(file, store);
  }

  function addVersion(store, packId, pack, { by, origin, aiDrafted = false, note = "" }) {
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
      pack,
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

  /**
   * The boot migration, safe on every start, seed-only: the first time it copies the seed into the
   * store (each pack version 1, origin seed); later it adds only packs and bindings the store
   * doesn't have yet. A pack or binding Studio holds is never replaced, whoever last changed it.
   * The seed file is never written.
   */
  function migrate() {
    const seed = readSeed();
    const existing = read();
    if (!seed && !existing) return { packs: 0, versions: 0 };
    const store = existing
      ? { ...existing, meta: isObject(existing.meta) ? { ...existing.meta } : {} }
      : { packs: {}, meta: {} };
    store.packs = isObject(store.packs) ? { ...store.packs } : {};
    let added = 0;
    let bindings = false;
    if (seed) {
      for (const key of sections) {
        if (seed[key] === undefined) continue;
        if (store[key] === undefined) {
          store[key] = structuredClone(seed[key]);
          bindings = true;
          continue;
        }
        if (!isObject(seed[key]) || !isObject(store[key])) continue;
        const missing = Object.keys(seed[key]).filter((name) => !Object.hasOwn(store[key], name));
        if (!missing.length) continue;
        store[key] = {
          ...store[key],
          ...Object.fromEntries(missing.map((name) => [name, structuredClone(seed[key][name])])),
        };
        bindings = true;
      }
      for (const [packId, pack] of Object.entries(isObject(seed.packs) ? seed.packs : {})) {
        if (!validPackId(packId) || !isObject(pack) || store.packs[packId]) continue;
        store.packs[packId] = structuredClone(pack);
        addVersion(store, packId, store.packs[packId], { by: "seed", origin: "seed" });
        added += 1;
      }
    }
    if (added || bindings || !existing) {
      writeStore(store);
      log.info?.(
        `[guides] ${existing ? "Added" : "Copied"} ${added} prompting guide pack${added === 1 ? "" : "s"} ${existing ? "missing from guides/prompting.json" : "into guides/prompting.json"} from the seed; packs Studio holds stay as they are.`,
      );
    }
    return { packs: Object.keys(store.packs).length, versions: added };
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
    addVersion(store, packId, next, { by, origin, aiDrafted });
    writeStore(store);
    return pack(packId);
  }

  function versions(packId) {
    if (!validPackId(packId)) throw notFound("That guide was not found.");
    return versionsIn(historyDir(packId))
      .reverse()
      .map((n) => {
        const { pack: _pack, ...rest } = readJsonFile(path.join(historyDir(packId), `${n}.json`));
        return rest;
      });
  }

  function version(packId, n) {
    const target = path.join(historyDir(packId), `${Number(n)}.json`);
    if (!validPackId(packId) || !Number.isSafeInteger(Number(n)) || !fs.existsSync(target))
      throw notFound("That guide version was not found.");
    return readJsonFile(target);
  }

  /** Restores an earlier version as a new version (history only grows). */
  function revert(packId, n, { by = "", baseHash = "", origin = "studio" } = {}) {
    const old = version(packId, n);
    return save(packId, old.pack, { by, origin, baseHash });
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
    const store = read() || readSeed() || {};
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
    if (store.profiles?.[profileId]?.pack === packId) return;
    store.profiles = { ...(store.profiles || {}), [profileId]: { pack: packId } };
    writeStore(store);
  }

  /**
   * Gives profile `to` (`custom:<id>`) the guide binding and negatives profile `from` has, where
   * `to` has none of its own, as a combined profile takes its default backend's.
   */
  function copyProfileGuide(from, to) {
    const store = read();
    if (!store) return;
    let changed = false;
    for (const key of ["profiles", "negatives"])
      if (isObject(store[key]?.[from]) && !Object.hasOwn(store[key], to)) {
        store[key] = { ...store[key], [to]: structuredClone(store[key][from]) };
        changed = true;
      }
    if (changed) writeStore(store);
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

  /** The configuration file the guide loader reads: the store once it exists, else the seed. */
  const configFile = () =>
    fs.existsSync(file) ? file : seedFile && fs.existsSync(seedFile) ? seedFile : "";

  return {
    file,
    migrate,
    pack,
    save,
    versions,
    version,
    revert,
    approve,
    resolve,
    bind,
    copyProfileGuide,
    markExported,
    configFile,
    read,
  };
}

/**
 * The MCP guide loader (loadMcpPrompting) over the guide store, falling back to the seed file, and
 * reloaded whenever the store changes, so a saved guide applies without a restart. A store that
 * fails to load keeps the last good guides. With `negatives` (the prompt assistant), a profile's
 * `negatives` entry also becomes its guide's `negative` when the guide has none; MCP leaves it off,
 * so its guides stay exactly as loadMcpPrompting gives them.
 */
export function livePrompting({
  dataDir = currentDataDir(),
  seedFile = guideSeedFile(),
  log = console,
  negatives: fillNegatives = false,
} = {}) {
  const store = createGuideStore({ dataDir, seedFile, log });
  let loaded = null;
  let negatives = {};
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
      negatives = next ? readObject(target).negatives || {} : {};
      signature = next;
    } catch (error) {
      if (!loaded) throw error;
      log.warn?.(`[guides] Kept the previous prompting guides: ${error.message}`);
      signature = next;
    }
    return loaded;
  };
  current();
  return (profile, detailed = false) => {
    const guide = current()(profile, detailed);
    if (
      !fillNegatives ||
      !detailed ||
      !guide ||
      guide.negative ||
      !isObject(negatives[profile?.id])
    )
      return guide;
    return { ...guide, negative: structuredClone(negatives[profile.id]) };
  };
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
