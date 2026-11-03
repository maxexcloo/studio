// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One catalogue for every model file Studio knows about (LoRAs, checkpoints, diffusion models,
 * text encoders, VAEs and CLIP vision), keyed by `folder/file`, with provenance and a hash index:
 * `<data>/library/catalogue.json`.
 *
 * The `manifest` layer copies the pinned model manifest, `<data>/config/models.json`, which stays
 * where it is and is never written here: the layer is refreshed when the file changes and kept
 * when it goes, so the sync is idempotent. The other layers have no source file. `provider` holds
 * the Civitai and Hugging Face download specs, keyed by download id, which library/downloads.js
 * records here (migrate-runtime folded in the retired model-download-sources.json,
 * download-sources.js). `definitions` holds the model metadata migrate-runtime folded in from the
 * retired lora-catalogue.json `seed` and `admin` layers (lora-layers.js). Studio's own edits are a
 * layer above all of them.
 * On a conflict the more specific source wins: edits over definitions over provider details over
 * the manifest, except that provider metadata wins for links and hashes.
 *
 * This module is the catalogue's only writer; writes are atomic (json-store.js).
 */
import fs from "node:fs";
import path from "node:path";
import { currentDataDir } from "../data-dir.js";
import { readJsonFile, writeJsonFile } from "../json-store.js";

export const catalogueKinds = Object.freeze({
  loras: "lora",
  checkpoints: "checkpoint",
  diffusion_models: "diffusion_model",
  text_encoders: "text_encoder",
  vae: "vae",
  clip_vision: "clip_vision",
});
const editOrigins = new Set(["admin", "import", "ai", "chat"]);
const layerNames = ["definitions", "provider", "manifest"];
const historyLimit = 20;
const sha = (value) =>
  /^[a-f0-9]{64}$/i.test(String(value || "")) ? String(value).toLowerCase() : "";
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value, limit = 300) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";
const list = (value, limit = 30, size = 120) =>
  (Array.isArray(value) ? value : [])
    .filter((item) => typeof item === "string" && item.trim() && item.trim() !== "[]")
    .map((item) => item.trim().slice(0, size))
    .slice(0, limit);
const safeKey = (folder, file) => {
  const parts = String(file || "").split("/");
  if (
    !Object.hasOwn(catalogueKinds, folder) ||
    !file ||
    parts.some((part) => !part || part === "." || part === ".." || /[\\\x00-\x1f]/.test(part))
  )
    return "";
  return `${folder}/${file}`;
};

/** `folder/file` split back into its parts. */
export function splitCatalogueKey(key) {
  const [folder, ...rest] = String(key || "").split("/");
  return { folder, file: rest.join("/") };
}

/** Links from any URL a source gives: civitai.com, civitai.red or Hugging Face. */
function linksFrom(url) {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return {};
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return {};
  }
  if (host === "civitai.com" || host.endsWith(".civitai.com")) return { civitaiCom: url };
  if (host === "civitai.red" || host.endsWith(".civitai.red")) return { civitaiRed: url };
  if (host === "huggingface.co") return { hf: url };
  return {};
}

/** Provider source fields from a download spec's id: civitai:<version>:<file> or hf:<repo>:<revision>:<path>. */
function providerSource(spec) {
  const civitai = /^civitai:(\d+):(\d+)$/.exec(spec?.id || "");
  if (civitai) {
    const modelId = /\/models\/(\d+)/.exec(spec.sourceUrl || "")?.[1];
    return {
      provider: "civitai",
      ...(modelId ? { modelId: Number(modelId) } : {}),
      versionId: Number(civitai[1]),
      fileId: Number(civitai[2]),
    };
  }
  const hf = /^hf:([^:/\s]+\/[^:/\s]+):([a-f0-9]{40}):(.+)$/i.exec(spec?.id || "");
  if (hf) return { provider: "hf", repo: hf[1], revision: hf[2], path: hf[3] };
  return null;
}

/** The retired lora-catalogue.json entry shape (lora/info.js reads it) from Entry-shaped fields. */
function rawFromEdit(edit = {}) {
  const raw = {};
  for (const key of [
    "title",
    "baseModel",
    "description",
    "note",
    "guidance",
    "role",
    "negative",
    "uncensored",
    "type",
  ])
    if (edit[key] !== undefined) raw[key] = edit[key];
  if (edit.triggers !== undefined) raw.triggers = edit.triggers;
  if (edit.tags !== undefined) raw.tags = edit.tags;
  if (edit.compatibility !== undefined) raw.compatibility = edit.compatibility;
  if (
    isObject(edit.strength) &&
    Number.isFinite(edit.strength.min) &&
    Number.isFinite(edit.strength.max) &&
    Number.isFinite(edit.strength.step)
  )
    raw.strengthRange = {
      min: edit.strength.min,
      max: edit.strength.max,
      step: edit.strength.step,
      ...(Number.isFinite(edit.strength.default) ? { default: edit.strength.default } : {}),
    };
  const link = edit.links?.civitaiCom || edit.links?.civitaiRed || edit.links?.hf;
  if (link) raw.sourceUrl = link;
  return raw;
}

const editableFields = new Set([
  "title",
  "version",
  "baseModel",
  "modelType",
  "type",
  "families",
  "role",
  "triggers",
  "strength",
  "tags",
  "negative",
  "description",
  "note",
  "guidance",
  "uncensored",
  "licence",
  "links",
  "compatibility",
  // An administrator removed the entry (library/routes.js): it stays out of the catalogue until undone.
  "removed",
]);

/** What an import knows for certain about a file; never changed by hand. */
const provenanceFields = new Set(["sha256", "bytes", "source"]);

/**
 * An edit patch reduced to the fields Studio may change, each in its stored form. Throws on
 * anything else. `provenance` (imports only) also accepts the file's hash, size and source.
 */
function cleanCataloguePatch(patch, { provenance = false } = {}) {
  if (!isObject(patch)) throw new Error("A catalogue change is an object of fields.");
  const clean = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "notes") {
      clean.note = text(value, 500);
      continue;
    }
    if (!editableFields.has(key) && !(provenance && provenanceFields.has(key)))
      throw new Error(`${key} can't be changed in the catalogue.`);
    if (value === null) {
      clean[key] = null;
      continue;
    }
    switch (key) {
      case "type":
        if (!["slider", "style", "character", "concept"].includes(value))
          throw new Error("type must be slider, style, character or concept.");
        clean.type = value;
        break;
      case "modelType":
        if (!["original", "finetune"].includes(value))
          throw new Error("modelType must be original or finetune.");
        clean.modelType = value;
        break;
      case "triggers":
      case "tags":
      case "families":
        clean[key] = list(value, key === "tags" ? 10 : 30, 80);
        break;
      case "uncensored":
        if (typeof value !== "boolean") throw new Error("uncensored must be true or false.");
        clean.uncensored = value;
        break;
      case "removed":
        if (value !== true) throw new Error("removed is true, or null to restore the entry.");
        clean.removed = true;
        break;
      case "role":
        if (!["effect", "acceleration", "supporting"].includes(value))
          throw new Error("role must be effect, acceleration or supporting.");
        clean.role = value;
        break;
      case "strength": {
        if (!isObject(value)) throw new Error("strength is {default, min, max}.");
        const strength = Object.fromEntries(
          ["default", "min", "max", "step"]
            .filter((part) => Number.isFinite(value[part]))
            .map((part) => [part, value[part]]),
        );
        if (
          strength.min !== undefined &&
          strength.max !== undefined &&
          strength.min >= strength.max
        )
          throw new Error("strength.min must be below strength.max.");
        clean.strength = strength;
        break;
      }
      case "links": {
        if (!isObject(value)) throw new Error("links is {civitaiCom, civitaiRed, hf}.");
        clean.links = Object.fromEntries(
          ["civitaiCom", "civitaiRed", "hf"]
            .filter((part) => typeof value[part] === "string" && /^https:\/\//i.test(value[part]))
            .map((part) => [part, value[part]]),
        );
        break;
      }
      case "licence": {
        if (!isObject(value)) throw new Error("licence is {name, commercial, restrictions}.");
        clean.licence = {
          name: text(value.name, 120),
          commercial: typeof value.commercial === "boolean" ? value.commercial : null,
          restrictions: list(value.restrictions, 20, 120),
        };
        break;
      }
      case "compatibility":
        if (!isObject(value)) throw new Error("compatibility is an object.");
        clean.compatibility = structuredClone(value);
        break;
      case "sha256":
        if (!sha(value)) throw new Error("sha256 is 64 hex characters.");
        clean.sha256 = sha(value);
        break;
      case "bytes":
        if (!Number.isSafeInteger(value) || value < 0) throw new Error("bytes is a whole number.");
        clean.bytes = value;
        break;
      case "source": {
        if (!isObject(value) || !["civitai", "hf", "manifest", "manual"].includes(value.provider))
          throw new Error("source is {provider: civitai|hf|manifest|manual, …}.");
        const source = { provider: value.provider };
        for (const part of ["modelId", "versionId", "fileId"])
          if (Number.isSafeInteger(value[part]) && value[part] > 0) source[part] = value[part];
        for (const part of ["repo", "revision", "path"])
          if (typeof value[part] === "string" && value[part].trim())
            source[part] = value[part].trim().slice(0, 300);
        clean.source = source;
        break;
      }
      default:
        clean[key] = text(value, key === "description" ? 10000 : key === "guidance" ? 1000 : 500);
    }
  }
  return clean;
}

function readSource(file) {
  try {
    const stat = fs.statSync(file);
    return {
      signature: `${stat.size}:${stat.mtimeMs}`,
      value: JSON.parse(fs.readFileSync(file, "utf8")),
    };
  } catch (error) {
    return error.code === "ENOENT"
      ? { signature: "", value: undefined }
      : { signature: "unreadable", value: undefined };
  }
}

/** A catalogue store over one data folder. `familiesFromMetadata` (lora/info.js) fills each entry's families. */
export function createCatalogueStore({
  dataDir = currentDataDir(),
  environment = process.env,
  familiesFromMetadata = () => [],
  log = console,
} = {}) {
  const file = path.join(dataDir, "library", "catalogue.json");
  const manifestPrefix = () =>
    String(environment.STUDIO_MODEL_MANIFEST_PREFIX || "").replace(/^\/+/, "");
  const sources = { manifest: () => path.join(dataDir, "config", "models.json") };
  let state = null;
  let hashIndex = null;
  let checkedAt = 0;

  const empty = () => ({
    version: 1,
    entries: {},
    layers: Object.fromEntries(layerNames.map((name) => [name, {}])),
    signatures: {},
    edits: {},
  });
  function load() {
    if (state) return state;
    try {
      const saved = readJsonFile(file);
      state =
        isObject(saved) && saved.version === 1
          ? { ...empty(), ...saved, layers: { ...empty().layers, ...(saved.layers || {}) } }
          : empty();
    } catch {
      state = empty();
    }
    // Entries derive from the layers and edits, so a saved field Studio no longer keeps drops out.
    rebuild(state);
    return state;
  }

  /** The manifest's content as its layer stores it, keyed by catalogue key. */
  function layerFrom(value) {
    if (!Array.isArray(value)) return null;
    const layer = {};
    const prefix = manifestPrefix();
    for (const entry of value) {
      if (
        !isObject(entry) ||
        typeof entry.path !== "string" ||
        !sha(entry.sha256) ||
        !entry.path.startsWith(prefix)
      )
        continue;
      const { folder, file: name } = splitCatalogueKey(entry.path.slice(prefix.length));
      const key = safeKey(folder, name);
      if (key)
        layer[key] = {
          path: entry.path,
          sha256: sha(entry.sha256),
          size: Number(entry.size) || 0,
          ...(typeof entry.url === "string" && /^https:\/\//.test(entry.url)
            ? { url: entry.url }
            : {}),
          ...(typeof entry.source === "string" ? { source: entry.source } : {}),
        };
    }
    return layer;
  }

  /** Rebuilds one key's entry after an edit, leaving it out while it is removed. */
  function place(current, key) {
    if (current.edits[key]?.fields?.removed) delete current.entries[key];
    else current.entries[key] = build(key, current);
  }

  /** The merged entry for one key, from every layer and Studio's edits. */
  function build(key, current) {
    const { folder, file: name } = splitCatalogueKey(key);
    const { layers, edits } = current;
    const definition = layers.definitions[key] || null;
    const providers = Object.values(layers.provider).filter(
      (spec) => safeKey(spec.folder, spec.file) === key,
    );
    const provider = providers.at(-1) || null;
    const manifest = layers.manifest[key] || null;
    const edit = edits[key] || null;
    const fields = { ...(definition || {}), ...(edit?.fields || {}) };
    const pick = (field, ...values) =>
      fields[field] !== undefined && fields[field] !== null
        ? fields[field]
        : values.find((value) => value !== undefined && value !== "" && value !== null);
    const providerTitle = provider
      ? [provider.label, provider.version]
          .filter((value) => typeof value === "string" && value.trim())
          .join(" · ")
      : "";
    const baseModel = pick("baseModel", text(provider?.baseModel, 100)) || "";
    const range = isObject(provider?.strengthRange) ? provider.strengthRange : null;
    const providerLinks = provider ? linksFrom(provider.sourceUrl) : {};
    const source = provider
      ? providerSource(provider)
      : manifest
        ? { provider: "manifest", path: manifest.path }
        : { provider: "manual" };
    const origin = edit?.origin || (definition ? "seed" : provider ? "import" : "manifest");
    const entry = {
      kind: catalogueKinds[folder],
      folder,
      file: name,
      sha256: pick("sha256", sha(provider?.sha256), manifest?.sha256) || "",
      bytes: Number(fields.bytes) || Number(provider?.bytes) || manifest?.size || 0,
      title: pick("title", providerTitle) || "",
      version: pick("version", text(provider?.version, 200)) || "",
      baseModel,
      ...(pick("type") ? { type: pick("type") } : {}),
      ...(["original", "finetune"].includes(pick("modelType", provider?.modelType))
        ? { modelType: pick("modelType", provider?.modelType) }
        : {}),
      families:
        fields.families ||
        familiesFromMetadata({
          base_model: baseModel.replace(/^qwen\s+2\.1$/i, "Qwen-Image 2.1"),
        }) ||
        [],
      ...(pick("role", provider?.role) ? { role: pick("role", provider?.role) } : {}),
      triggers: fields.triggers || list(provider?.trainedWords),
      strength:
        fields.strength ||
        (range
          ? Object.fromEntries(
              ["default", "min", "max", "step"]
                .filter((part) => Number.isFinite(range[part]))
                .map((part) => [part, range[part]]),
            )
          : {}),
      ...(fields.tags?.length ? { tags: fields.tags } : {}),
      ...(pick("negative") ? { negative: pick("negative") } : {}),
      description: pick("description", text(provider?.description, 10000)) || "",
      ...(pick("note", text(provider?.note, 500))
        ? { note: pick("note", text(provider?.note, 500)) }
        : {}),
      ...(pick("guidance") ? { guidance: pick("guidance") } : {}),
      ...(pick("compatibility", provider?.compatibility)
        ? { compatibility: pick("compatibility", provider?.compatibility) }
        : {}),
      // Unknown until a source or an administrator says: null, never assumed safe.
      uncensored:
        typeof fields.uncensored === "boolean"
          ? fields.uncensored
          : typeof provider?.uncensored === "boolean"
            ? provider.uncensored
            : null,
      licence: fields.licence || { name: "", commercial: null, restrictions: [] },
      source: fields.source || source,
      // Provider metadata wins for links, then the manifest's address.
      links: {
        ...linksFrom(manifest?.url),
        ...providerLinks,
        ...(fields.links || {}),
      },
      origin,
      ...(edit?.aiDrafted ? { aiDrafted: true } : {}),
      editedAt: edit?.editedAt || current.migratedAt || "",
      by: edit?.by || (origin === "seed" ? "seed" : ""),
      history: edit?.history || [],
    };
    return entry;
  }

  function rebuild(current) {
    const keys = new Set([
      ...Object.keys(current.layers.definitions),
      ...Object.keys(current.layers.manifest),
      ...Object.keys(current.edits),
    ]);
    for (const spec of Object.values(current.layers.provider))
      keys.add(safeKey(spec.folder, spec.file));
    keys.delete("");
    current.entries = Object.fromEntries(
      [...keys]
        .filter((key) => !current.edits[key]?.fields?.removed)
        .sort()
        .map((key) => [key, build(key, current)]),
    );
    hashIndex = null;
  }

  /** What syncing would change, without writing: per source, whether it changed and how many keys it holds. */
  function plan() {
    const current = load();
    const changes = {};
    for (const [name, source] of Object.entries(sources)) {
      const read = readSource(source());
      if (
        !read.signature ||
        read.signature === "unreadable" ||
        read.signature === current.signatures[name]
      )
        continue;
      const layer = layerFrom(read.value);
      if (layer) changes[name] = { signature: read.signature, layer };
    }
    return changes;
  }

  /**
   * Brings the catalogue up to date with the manifest: a changed manifest replaces its layer, a
   * missing one keeps its last layer. Writes only when something changed. Returns whether it did.
   */
  function sync({ dryRun = false } = {}) {
    const current = load();
    const changes = plan();
    const first = !fs.existsSync(file);
    if (dryRun)
      return {
        changed: Object.keys(changes),
        counts: Object.fromEntries(
          Object.entries(changes).map(([name, item]) => [name, Object.keys(item.layer).length]),
        ),
      };
    if (!Object.keys(changes).length && !first) return false;
    for (const [name, item] of Object.entries(changes)) {
      current.layers[name] = item.layer;
      current.signatures[name] = item.signature;
    }
    current.migratedAt ||= new Date().toISOString();
    rebuild(current);
    current.syncedAt = new Date().toISOString();
    writeJsonFile(file, current);
    return true;
  }

  /** Re-syncs at most every `throttleMs`; 0 checks the manifest on every read. */
  const fresh = (throttleMs = 0) => {
    if (!throttleMs || Date.now() - checkedAt >= throttleMs) {
      checkedAt = Date.now();
      sync();
    }
    return load();
  };

  /** The boot migration: logs its dry run, then syncs. Safe to run on every start. */
  function migrate() {
    const preview = sync({ dryRun: true });
    if (preview.changed.length || !fs.existsSync(file))
      log.info?.(
        `[library] Catalogue: merging ${preview.changed.map((name) => `${name} (${preview.counts[name]})`).join(", ") || "nothing new"} into library/catalogue.json; the manifest stays as it is.`,
      );
    return sync();
  }

  /**
   * Changes one entry as Studio (`origin` admin, import, ai or chat), keeping the previous edit
   * values in its history (last 20) so the change can be undone. A null field clears an edit.
   */
  function edit(
    key,
    patch,
    { by = "", origin = "admin", aiDrafted = false, provenance = false } = {},
  ) {
    const { folder, file: name } = splitCatalogueKey(key);
    if (!safeKey(folder, name))
      throw new Error("A catalogue key is folder/file, in a model folder.");
    if (!editOrigins.has(origin)) throw new Error("Choose who made the change.");
    const clean = cleanCataloguePatch(patch, { provenance: provenance && origin !== "admin" });
    const current = fresh();
    const previous = current.edits[key] || { fields: {}, history: [] };
    const fields = { ...previous.fields };
    const undo = {};
    for (const [field, value] of Object.entries(clean)) {
      undo[field] = Object.hasOwn(previous.fields, field) ? previous.fields[field] : null;
      if (value === null) delete fields[field];
      else fields[field] = value;
    }
    const at = new Date().toISOString();
    current.edits[key] = {
      fields,
      origin,
      by: String(by || ""),
      editedAt: at,
      ...(aiDrafted ? { aiDrafted: true } : {}),
      history: [...previous.history, { at, by: String(by || ""), patch: undo }].slice(
        -historyLimit,
      ),
    };
    place(current, key);
    hashIndex = null;
    writeJsonFile(file, current);
    return { entry: current.entries[key], previous: undo };
  }

  /** The provider download spec recorded under `id`, or null. */
  function download(id) {
    const { provider } = load().layers;
    return Object.hasOwn(provider, id) ? provider[id] : null;
  }

  /** Records a provider download's spec under its id; its file's entry gains the provider details. */
  function rememberDownload(spec) {
    const current = load();
    current.layers.provider[spec.id] = structuredClone(spec);
    const key = safeKey(spec.folder, spec.file);
    if (key) place(current, key);
    hashIndex = null;
    writeJsonFile(file, current);
  }

  /** Undoes the newest change to an entry, recorded as a change of its own. */
  function undo(key, { by = "" } = {}) {
    const current = fresh();
    const previous = current.edits[key];
    const last = previous?.history?.at(-1);
    if (!last) throw new Error("That entry has no change to undo.");
    const fields = { ...previous.fields };
    for (const [field, value] of Object.entries(last.patch)) {
      if (value === null) delete fields[field];
      else fields[field] = value;
    }
    current.edits[key] = {
      ...previous,
      fields,
      by: String(by || ""),
      editedAt: new Date().toISOString(),
      history: previous.history.slice(0, -1),
    };
    place(current, key);
    hashIndex = null;
    writeJsonFile(file, current);
    return current.entries[key];
  }

  /** Clears AI-Drafted on an entry (an administrator reviewed it). */
  function approve(key, { by = "" } = {}) {
    const current = fresh();
    if (!current.edits[key]?.aiDrafted) return current.entries[key] || null;
    const { aiDrafted: _drafted, ...rest } = current.edits[key];
    current.edits[key] = { ...rest, by: String(by || ""), editedAt: new Date().toISOString() };
    place(current, key);
    writeJsonFile(file, current);
    return current.entries[key];
  }

  const entries = ({ throttleMs = 0 } = {}) => fresh(throttleMs).entries;
  const entry = (key) => entries()[key] || null;
  /** Catalogue keys whose recorded SHA-256 is `hex`. */
  function byHash(hex) {
    const current = fresh(1000);
    if (!hashIndex) {
      hashIndex = new Map();
      for (const [key, item] of Object.entries(current.entries))
        if (item.sha256) hashIndex.set(item.sha256, [...(hashIndex.get(item.sha256) || []), key]);
    }
    return hashIndex.get(sha(hex)) || [];
  }

  /**
   * The LoRA view in the old shapes lora/info.js reads, so /api/loras/info keeps its response:
   * `sources` as the provider layer holds them (by download id), `catalogue` by LoRA name as the
   * definitions with Studio's edits over them.
   */
  function loraView() {
    const current = fresh();
    const catalogue = {};
    for (const key of new Set([
      ...Object.keys(current.layers.definitions),
      ...Object.keys(current.edits),
    ])) {
      const { folder, file: name } = splitCatalogueKey(key);
      if (folder !== "loras") continue;
      catalogue[name] = {
        ...rawFromEdit(current.layers.definitions[key]),
        ...rawFromEdit(current.edits[key]?.fields),
      };
    }
    return { sources: current.layers.provider, catalogue };
  }

  return {
    file,
    sync,
    migrate,
    entries,
    entry,
    byHash,
    edit,
    undo,
    approve,
    download,
    rememberDownload,
    loraView,
    manifestFile: () => sources.manifest(),
    plan: () => sync({ dryRun: true }),
  };
}

const stores = new Map();
/** The shared store for a data folder: one writer per catalogue file. */
export function catalogueStore(options = {}) {
  const dir = options.dataDir || currentDataDir();
  if (!stores.has(dir)) stores.set(dir, createCatalogueStore({ ...options, dataDir: dir }));
  return stores.get(dir);
}
