// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Library imports as durable job records (design §2.3): one file per import,
 * `<data>/library/imports/<id>.json`, indexed when first read; the 500 newest are kept. A record
 * that was still resolving when Studio stopped is marked failed on the next start (the
 * job-recovery pattern), so nothing waits forever.
 *
 * The engine resolves a link (library-sources.js), matches its files against what is installed,
 * grades it (library-grade.js), writes catalogue entries for LoRAs and queues Download Missing
 * through the worker model API (library-downloads.js → model-downloads.js → worker-models.js).
 * Nothing downloads on its own. A checkpoint or diffusion model import drafts a profile and guide
 * (profile-drafts.js, through the injected `draftProfile`), adding the parts it needs as files.
 *
 * Dropped image files (PNG, WebP, JPEG) are read by image-metadata.js: their prompt, settings and
 * files become the record's preset and resources, matched by hash first, then by name. An image
 * without metadata is described by the assistant's vision model (graded Partial). A missing file
 * gets the nearest installed stand-in (library-substitutes.js), marked and lowering the grade,
 * with Use Exact File once the exact one is installed. Offers (library-offers.js) are other
 * versions and variants that fit; one is downloaded only when chosen.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { currentDataDir } from "./data-dir.js";
import { readJsonFile, removeJsonFile, writeJsonFile } from "./json-store.js";
import { gradeImport, presetGrade } from "./library-grade.js";
import { catalogueKinds } from "./library-catalogue.js";
import { imageRecipe, readImageMetadata } from "./image-metadata.js";
import { publicOffers } from "./library-offers.js";

export const importLimit = 500;
const idPattern = /^imp-[a-z0-9]{6,40}$/;
const states = new Set(["resolving", "needs-files", "downloading", "ready", "failed", "cancelled"]);
const folders = new Set(Object.keys(catalogueKinds));
const now = () => new Date().toISOString();

/** A new record id: time-ordered, never reused. */
export function importId(at = Date.now()) {
  return `imp-${at.toString(36)}${crypto.randomBytes(4).toString("hex")}`;
}

/** The record store over one data folder; the only writer of library/imports. */
export function createImportStore({
  dataDir = currentDataDir(),
  limit = importLimit,
  log = console,
} = {}) {
  const dir = path.join(dataDir, "library", "imports");
  let index = null;

  function load() {
    if (index) return index;
    index = new Map();
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
    } catch {
      /* No imports yet. */
    }
    for (const name of names) {
      const id = name.slice(0, -5);
      if (!idPattern.test(id)) continue;
      try {
        const record = readJsonFile(path.join(dir, name));
        if (record?.id !== id || !states.has(record.state)) continue;
        // Interrupted while resolving: say so instead of resolving forever.
        if (record.state === "resolving") {
          record.state = "failed";
          record.error = "Studio restarted before this import finished. Import the link again.";
          record.updatedAt = now();
          writeJsonFile(path.join(dir, name), record);
        }
        index.set(id, record);
      } catch (error) {
        log.warn?.(`[library] Skipped unreadable import ${name}: ${error.message}`);
      }
    }
    prune();
    return index;
  }

  /** Newest first. */
  const list = () =>
    [...load().values()].sort(
      (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.id.localeCompare(a.id),
    );

  function prune() {
    const sorted = [...index.values()].sort(
      (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.id.localeCompare(a.id),
    );
    for (const record of sorted.slice(limit)) {
      index.delete(record.id);
      try {
        removeJsonFile(path.join(dir, `${record.id}.json`));
      } catch {
        /* Gone already. */
      }
    }
  }

  function put(record) {
    if (!idPattern.test(record?.id || "")) throw new Error("An import needs a valid id.");
    if (!states.has(record.state)) throw new Error(`Unknown import state ${record.state}.`);
    load();
    record.updatedAt = now();
    fs.mkdirSync(dir, { recursive: true });
    writeJsonFile(path.join(dir, `${record.id}.json`), record);
    index.set(record.id, record);
    prune();
    return record;
  }

  const get = (id) => (idPattern.test(String(id || "")) ? load().get(String(id)) || null : null);
  return {
    dir,
    list,
    get,
    put,
    reload: () => {
      index = null;
      return load();
    },
  };
}

const stores = new Map();
/** The shared store for a data folder. */
export function importStore(options = {}) {
  const dataDir = options.dataDir || currentDataDir();
  if (!stores.has(dataDir)) stores.set(dataDir, createImportStore({ ...options, dataDir }));
  return stores.get(dataDir);
}

/* ---------------------------------------------------------------- Views */

/** A record as the browser and MCP see it: no download specs. */
export function publicImport(record) {
  if (!record) return null;
  const { pendingEntries: _pending, entryBase: _entry, sourceText: _source, ...rest } = record;
  return {
    ...rest,
    resources: (record.resources || []).map(({ spec, ...resource }) => resource),
    offers: publicOffers(record.offers || []),
  };
}

/** The import's state from its resources. */
export function importState(record) {
  if (record.state === "failed" || record.state === "cancelled" || record.state === "resolving")
    return record.state;
  const resources = record.resources || [];
  if (resources.some((resource) => resource.status === "downloading")) return "downloading";
  if (record.input?.kind === "described") return "ready";
  // A recipe is ready once every file it needs is there, a stand-in included.
  if (record.recipe)
    return resources
      .filter((resource) => !resource.optional)
      .every((resource) => ["installed", "substitute"].includes(resource.status))
      ? "ready"
      : "needs-files";
  const required = resources.filter((resource) => !resource.optional);
  const counted = required.length
    ? required
    : resources.filter((resource) => resource.status === "installed");
  if (counted.length && counted.every((resource) => resource.status === "installed"))
    return "ready";
  return "needs-files";
}

const modelRoles = new Set(["checkpoint", "diffusion_model"]);

/** Grade a model-file import (no prompt to grade), a saved image (its preset), a dropped image (its recipe) or a described one. */
export function gradeRecord(record, preset = null) {
  if (preset) return presetGrade(preset);
  const resources = (record.resources || []).map((resource) => ({
    ...resource,
    name: resource.name || resource.want?.file,
  }));
  if (record.input?.kind === "described") {
    // Always Partial: nothing was recorded, so nothing can be matched exactly.
    const notes = [
      record.suggestion?.profileLabel ? `Suggested profile: ${record.suggestion.profileLabel}` : "",
      resources.length
        ? `Suggested LoRAs: ${resources.map((resource) => resource.name).join(", ")}`
        : "",
    ].filter(Boolean);
    return {
      value: "partial",
      reasons: ["Described by AI; no recorded settings", ...notes],
      missingFields: [],
    };
  }
  if (record.recipe) {
    const models = resources.filter(
      (resource) => modelRoles.has(resource.role) && !resource.optional,
    );
    const model = models.find(
      (resource) => resource.status === "installed" || resource.status === "substitute",
    );
    const settings = record.preset?.settings || {};
    return gradeImport({
      resources,
      recipe: {
        ...settings,
        prompt: record.preset?.prompt,
        negative: record.preset?.negative,
        negativeUsed: record.recipe.negativeUsed,
        cfgUsed: true,
      },
      approximate: record.recipe.approximate || [],
      extraProcessing: Boolean(record.recipe.extraProcessing),
      baseModel: {
        required: models.length > 0,
        installed: Boolean(model),
        profile: Boolean(
          model?.status === "substitute"
            ? model.substitute?.profileId || model.profileId
            : model?.profileId,
        ),
      },
    });
  }
  return gradeImport({ resources });
}

const fileTitle = (name) =>
  String(name || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/\.(png|webp|jpe?g)$/i, "")
    .trim()
    .slice(0, 200);

/* --------------------------------------------------------------- Engine */

/**
 * The import engine. Dependencies are injected so tests run without providers or workers:
 *   resolveCivitai(url), resolveHf(url)   library-sources.js resolvers
 *   inspect(want, {verify})               {status: installed|missing|conflict, unverified?}
 *   downloads()                           model-downloads.js downloadState()
 *   startDownload(spec)                   library-downloads.js startLibraryDownload
 *   catalogue                             library-catalogue.js store (edit)
 *   importImage(url)                      a saved image: the matched preset (preset-routes.js)
 *   resolvePreset(id, {verify})           a saved image again, matched
 *   matchImage(item)                      a dropped image's recipe resource → {name, version, want, spec?, unavailable?, nameOnly?, unsourced?, note}
 *   substituteFor(resource, record)       the nearest installed stand-in (library-substitutes.js), or null
 *   profileFor(file)                      the profile id that runs an installed base model, or '' (may be async)
 *   pictures                              {save(id, buffer), copy(from, to)}: the import's own picture
 *   describe({id})                        the vision model's prompt for the import's picture
 *   vision()                              {available, reason}: whether the assistant can read images
 *   draftProfile(record, {by})            optional: drafts a checkpoint's profile and guide in place
 */
export function createImportEngine({
  store = importStore(),
  resolveCivitai,
  resolveHf,
  detect,
  inspect,
  downloads,
  startDownload,
  catalogue,
  importImage,
  resolvePreset,
  matchImage = async (item) => ({
    name: item.name || item.file,
    want: { file: item.file || "", folder: item.folder || "", sha256: "" },
    unsourced: true,
  }),
  substituteFor = async () => null,
  profileFor = () => "",
  pictures = { save: async () => false, copy: async () => false },
  describe = async () => {
    throw new Error("The prompt assistant isn’t set up.");
  },
  vision = async () => ({ available: false, reason: "The prompt assistant isn’t set up." }),
  draftProfile = null,
}) {
  /** Each resource's status from the files and the download queue, then the grade and state. */
  async function refresh(record, { verify = false } = {}) {
    if (record.state === "failed" || record.state === "resolving") return record;
    if (record.input.kind === "civitai-image") {
      const preset = record.input.presetId
        ? await resolvePreset(record.input.presetId, { verify }).catch(() => null)
        : null;
      if (preset) {
        record.grade = presetGrade(preset);
        record.title = preset.name || record.title;
        record.resources = (preset.resources || []).map((resource) => ({
          role: ["checkpoints", "diffusion_models"].includes(resource.folder)
            ? "checkpoint"
            : catalogueKinds[resource.folder] || "model",
          name: resource.name,
          version: resource.version || "",
          want: {
            file: resource.file || "",
            folder: resource.folder || "",
            sha256: resource.sha256 || "",
            bytes: resource.bytes || 0,
            source: { provider: "civitai", url: resource.sourceUrl || "" },
          },
          status:
            resource.status === "installed"
              ? "installed"
              : resource.status === "conflict"
                ? "conflict"
                : resource.unavailable
                  ? "unavailable"
                  : resource.status === "unsupported"
                    ? "unsupported"
                    : "missing",
          ...(resource.unavailable ? { unavailable: resource.unavailable } : {}),
          ...(resource.unverified ? { unverified: true } : {}),
          ...(resource.nameOnly ? { nameOnly: true } : {}),
          note: resource.note || "",
        }));
        record.state = importState(record);
      }
      return record;
    }
    const state = downloads();
    const running = new Map(
      [state.active, ...(state.queued || [])].filter(Boolean).map((item) => [item.id, item]),
    );
    const recent = new Map((state.recent || []).map((item) => [item.id, item]));
    for (const resource of record.resources) {
      const download = resource.downloadId ? running.get(resource.downloadId) : null;
      if (download) {
        resource.status = "downloading";
        resource.progress = {
          receivedBytes: download.receivedBytes || 0,
          totalBytes: download.totalBytes || resource.want.bytes || 0,
        };
        continue;
      }
      delete resource.progress;
      if (resource.downloadId && recent.get(resource.downloadId)?.status === "error")
        resource.downloadError = recent.get(resource.downloadId).error || "The download stopped.";
      const found = resource.want.file
        ? await inspect(resource.want, { verify }).catch(() => ({ status: "missing" }))
        : { status: "missing" };
      // A stand-in stays in use until Use Exact File, which appears once the exact file is installed.
      if (resource.substitute) {
        resource.status = "substitute";
        resource.exactInstalled = found.status === "installed";
        continue;
      }
      if (found.status === "installed") {
        resource.status = "installed";
        delete resource.downloadError;
        if (found.unverified) resource.unverified = true;
        else delete resource.unverified;
        if (modelRoles.has(resource.role))
          resource.profileId =
            (await Promise.resolve(profileFor(resource.want.file)).catch(() => "")) || "";
      } else if (resource.unavailable) resource.status = "unavailable";
      else if (!resource.spec) resource.status = resource.unsourced ? "missing" : "unsupported";
      else resource.status = found.status === "conflict" ? "conflict" : "missing";
      if (
        record.recipe &&
        !resource.optional &&
        resource.status !== "installed" &&
        resource.status !== "conflict"
      ) {
        const stand = await Promise.resolve(substituteFor(resource, record)).catch(() => null);
        if (stand?.file) {
          resource.substitute = stand;
          resource.status = "substitute";
          resource.exactInstalled = false;
          if (stand.profileId) resource.profileId = stand.profileId;
          else if (modelRoles.has(resource.role))
            resource.profileId =
              (await Promise.resolve(profileFor(stand.file)).catch(() => "")) || "";
        }
      }
    }
    record.grade = gradeRecord(record);
    record.state = importState(record);
    return record;
  }

  /** Catalogue entries for every LoRA in the import, with the previous values kept for Undo. */
  function writeCatalogue(record, entries, by) {
    const keys = [];
    for (const { resource, patch } of entries) {
      if (!patch || resource.want.folder !== "loras" || !resource.want.file) continue;
      const key = `loras/${resource.want.file}`;
      try {
        catalogue.edit(key, patch, {
          by,
          origin: record.origin === "chat" ? "chat" : "import",
          provenance: true,
        });
        keys.push(key);
      } catch (error) {
        record.warnings = [
          ...(record.warnings || []),
          `Couldn’t write the catalogue entry for ${resource.want.file}: ${error.message}`,
        ];
      }
    }
    return keys;
  }

  /** Resolve one link into a new record, written before and after resolving. */
  async function create(url, { by = "", origin = "ui" } = {}) {
    const kind = detect(url);
    const record = store.put({
      id: importId(),
      createdAt: now(),
      by: String(by || ""),
      origin,
      input: { kind, url: String(url).trim() },
      state: "resolving",
      title: "",
      resources: [],
      offers: [],
      grade: { value: "partial", reasons: ["Resolving"], missingFields: [] },
      results: { catalogueKeys: [] },
    });
    try {
      if (kind === "civitai-image") {
        const preset = await importImage(record.input.url);
        Object.assign(record, {
          title: preset.name,
          input: { ...record.input, presetId: preset.id },
          results: { ...record.results, galleryItemId: preset.galleryItemId || "" },
          links: {
            civitaiCom: preset.sourceUrl,
            civitaiRed: String(preset.sourceUrl || "").replace(
              "://civitai.com/",
              "://civitai.red/",
            ),
          },
          baseModel: preset.baseModel || "",
          state: "needs-files",
        });
        await refresh(record);
        return store.put(record);
      }
      const resolved =
        kind === "civitai-model"
          ? await resolveCivitai(record.input.url)
          : await resolveHf(record.input.url);
      Object.assign(record, {
        title: resolved.title,
        version: resolved.version || "",
        baseModel: resolved.baseModel || "",
        modelType: resolved.type || "",
        nsfw: resolved.nsfw ?? null,
        links: resolved.links || {},
        resources: resolved.resources.map((resource) => ({ ...resource, status: "missing" })),
        offers: resolved.offers || [],
        state: "needs-files",
        ...(resolved.entry ? { entryBase: resolved.entry } : {}),
        ...(resolved.sourceText ? { sourceText: String(resolved.sourceText).slice(0, 12000) } : {}),
      });
      await refresh(record);
      const entries =
        kind === "civitai-model"
          ? [{ resource: record.resources[0], patch: resolved.entry }]
          : record.resources.map((resource) => ({
              resource,
              patch: resolved.entryFor?.(resource),
            }));
      // A repository's many optional files are catalogued when one is downloaded, not all up front.
      record.results.catalogueKeys = writeCatalogue(
        record,
        entries.filter(({ resource }) => !resource.optional),
        by,
      );
      if (kind !== "civitai-model")
        record.pendingEntries = Object.fromEntries(
          entries
            .filter(({ resource, patch }) => resource.optional && patch)
            .map(({ resource, patch }) => [resource.want.file, patch]),
        );
      if (draftProfile && draftable(record)) await draftInto(record, { by });
      return store.put(record);
    } catch (error) {
      record.state = "failed";
      record.error = error.message || "Couldn’t import that link.";
      record.grade = { value: "partial", reasons: [record.error], missingFields: [] };
      return store.put(record);
    }
  }

  /** The model file a profile could be drafted for: one required checkpoint or diffusion model. */
  const draftTarget = (record, index = null) => {
    const models = (record.resources || [])
      .map((resource, at) => ({ resource, at }))
      .filter(({ resource }) => ["checkpoint", "diffusion_model"].includes(resource.role));
    if (index !== null) return models.find(({ at }) => at === index) || null;
    const required = models.filter(({ resource }) => !resource.optional);
    return required.length === 1 ? required[0] : null;
  };
  const draftable = (record) =>
    ["civitai-model", "hf-file"].includes(record.input.kind) &&
    Boolean(draftTarget(record)) &&
    !record.results?.profileId;

  /** Drafts the profile and guide; a failure is a warning on the record, never a failed import. */
  async function draftInto(record, { by = "", index = null, rethrow = false } = {}) {
    const target = draftTarget(record, index);
    if (!target) throw new Error("Choose the model file to draft a profile for.");
    try {
      await draftProfile(record, { by, index: target.at });
      record.warnings = (record.warnings || []).filter(
        (warning) => !warning.startsWith("No profile drafted"),
      );
    } catch (error) {
      record.warnings = [
        ...(record.warnings || []).filter((warning) => !warning.startsWith("No profile drafted")),
        `No profile drafted: ${error.message}`,
      ];
      if (rethrow) {
        await refresh(record);
        throw error;
      }
    }
    await refresh(record);
  }

  /** Drafts (or redrafts after a failure) the profile for a checkpoint import, on request. */
  async function draft(id, { by = "", index = null } = {}) {
    const record = store.get(id);
    if (!record) throw new Error("That import is gone. Import the link again.");
    if (!draftProfile) throw new Error("Profile drafts are unavailable here.");
    if (record.state === "failed") throw new Error("This import failed. Import the link again.");
    if (record.results?.profileId)
      throw new Error("This import already drafted a profile. Review it in Settings › Profiles.");
    try {
      await draftInto(record, { by, index, rethrow: true });
    } finally {
      store.put(record);
    }
    return record;
  }

  /** Queue the missing files (or the chosen ones by index); unavailable files are never queued. */
  async function downloadMissing(id, { indices = null, by = "" } = {}) {
    const record = store.get(id);
    if (!record) throw new Error("That import is gone. Import the link again.");
    if (record.input.kind === "civitai-image")
      throw new Error("Saved images download their files from Images.");
    await refresh(record);
    const chosen = record.resources.filter((resource, index) =>
      indices ? indices.includes(index) : !resource.optional,
    );
    // A stand-in's exact file downloads only when chosen.
    const queue = chosen.filter(
      (resource) =>
        (resource.status === "missing" ||
          (indices && resource.status === "substitute" && !resource.exactInstalled)) &&
        resource.spec &&
        !resource.unavailable,
    );
    if (!queue.length)
      throw new Error(
        chosen.some((resource) => resource.unavailable)
          ? "Those files can’t be downloaded."
          : "Nothing is missing.",
      );
    const failures = [];
    for (const resource of queue) {
      try {
        const download = await startDownload(resource.spec);
        resource.downloadId = download?.id || resource.spec.id;
        delete resource.downloadError;
        const pending = record.pendingEntries?.[resource.want.file];
        if (pending) {
          record.results.catalogueKeys = [
            ...new Set([
              ...(record.results.catalogueKeys || []),
              ...writeCatalogue(record, [{ resource, patch: pending }], by),
            ]),
          ];
          delete record.pendingEntries[resource.want.file];
        }
      } catch (error) {
        resource.downloadError = error.message;
        failures.push(`${resource.want.file}: ${error.message}`);
      }
    }
    await refresh(record);
    store.put(record);
    if (failures.length === queue.length) throw new Error(failures[0]);
    return { record, queued: queue.length - failures.length, failures };
  }

  /** Change where a Hugging Face file goes before it downloads (its folder was only a guess). */
  async function setFolder(id, index, folder) {
    const record = store.get(id);
    const resource = record?.resources?.[index];
    if (!resource) throw new Error("That file isn’t in this import.");
    if (record.input.kind === "civitai-model" || record.input.kind === "civitai-image")
      throw new Error("Civitai files choose their folder on their own.");
    if (!folders.has(folder)) throw new Error("Choose a supported model folder.");
    if (resource.status === "downloading" || resource.status === "installed")
      throw new Error("That file is already on its way.");
    resource.want = { ...resource.want, folder };
    resource.role = catalogueKinds[folder];
    resource.folderGuessed = false;
    if (resource.spec) resource.spec = { ...resource.spec, folder };
    await refresh(record);
    return store.put(record);
  }

  /** Every record, newest first, each brought up to date cheaply (names and sizes only). */
  async function list({ limit = 100 } = {}) {
    const records = store.list().slice(0, limit);
    const changed = [];
    for (const record of records) {
      const before = JSON.stringify([
        record.state,
        record.grade,
        record.resources.map((resource) => resource.status),
      ]);
      await refresh(record).catch(() => record);
      if (
        JSON.stringify([
          record.state,
          record.grade,
          record.resources.map((resource) => resource.status),
        ]) !== before
      )
        changed.push(record);
    }
    for (const record of changed) store.put(record);
    return records;
  }

  /** One record, its files checked in full. */
  async function open(id) {
    const record = store.get(id);
    if (!record) return null;
    await refresh(record, { verify: true });
    return store.put(record);
  }

  /** Prompt, settings and files read from a dropped image; without metadata, the vision model describes it. */
  async function createFromImage({ data, name = "", by = "", origin = "ui" } = {}) {
    const metadata = Buffer.isBuffer(data) ? readImageMetadata(data) : null;
    if (!metadata) throw new Error("Drop a PNG, WebP or JPEG image.");
    const recipe = imageRecipe(metadata);
    const record = store.put({
      id: importId(),
      createdAt: now(),
      by: String(by || ""),
      origin,
      input: {
        kind: "image-file",
        fileName: String(name || "").slice(0, 200),
        format: metadata.format,
      },
      state: "resolving",
      title: fileTitle(name) || "Dropped Image",
      resources: [],
      offers: [],
      grade: { value: "partial", reasons: ["Resolving"], missingFields: [] },
      results: { catalogueKeys: [] },
    });
    try {
      record.picture = Boolean(await pictures.save(record.id, data).catch(() => false));
      if (!recipe) {
        const sight = await vision().catch(() => ({
          available: false,
          reason: "The assistant couldn’t be reached.",
        }));
        if (!sight.available) {
          record.state = "failed";
          record.error = `This image has no generation metadata. ${sight.reason || "The assistant model can’t read images."}`;
          record.grade = { value: "partial", reasons: [record.error], missingFields: [] };
          return store.put(record);
        }
        return await describeInto(record);
      }
      record.recipe = {
        source: recipe.source,
        negativeUsed: recipe.negativeUsed,
        approximate: recipe.approximate,
        extraProcessing: recipe.extraProcessing,
      };
      record.preset = {
        prompt: recipe.prompt,
        negative: recipe.negative,
        settings: recipe.settings,
        warnings: recipe.warnings,
      };
      record.warnings = recipe.warnings;
      if (recipe.resources.length > 24)
        throw new Error("This image references too many files to import.");
      for (const item of recipe.resources) {
        const matched = await matchImage(item).catch((error) => ({
          name: item.name || item.file,
          want: { file: item.file || "", folder: item.folder, sha256: "" },
          unsourced: true,
          note: error.message,
        }));
        record.resources.push({
          role: item.role,
          ...(item.role === "lora" ? { strength: item.strength ?? null } : {}),
          ...matched,
          status: "missing",
        });
      }
      record.state = "needs-files";
      await refresh(record);
      return store.put(record);
    } catch (error) {
      record.state = "failed";
      record.error = error.message || "Couldn’t read that image.";
      record.grade = { value: "partial", reasons: [record.error], missingFields: [] };
      return store.put(record);
    }
  }

  /** The vision model's prompt, negative, profile and LoRAs for the record's picture. */
  async function describeInto(record) {
    try {
      const result = await describe({ id: record.id });
      record.input = { ...record.input, kind: "described" };
      record.preset = {
        prompt: result.prompt,
        negative: result.negative || "",
        settings: {},
        warnings: [],
      };
      record.suggestion = {
        profileId: result.profileId || "",
        profileLabel: result.profileLabel || "",
        model: result.model || "",
      };
      record.resources = (result.loras || []).map((lora) => ({
        role: "lora",
        name: lora.title || lora.name || lora,
        want: { file: lora.name || lora, folder: "loras", sha256: "" },
        strength: lora.strength ?? null,
        suggested: true,
        optional: true,
        unsourced: true,
        note: "Suggested by the assistant",
        status: "missing",
      }));
      delete record.recipe;
      delete record.error;
      record.state = "ready";
      await refresh(record);
      return store.put(record);
    } catch (error) {
      record.state = "failed";
      record.error = `The assistant couldn’t describe this image: ${error.message}`;
      record.grade = { value: "partial", reasons: [record.error], missingFields: [] };
      return store.put(record);
    }
  }

  /** Describe an imported image with the vision model, as a new record beside the original. */
  async function describeImport(id, { by = "", origin = "ui" } = {}) {
    const source = store.get(id);
    if (!source?.picture) throw new Error("Only an imported image can be described.");
    const sight = await vision();
    if (!sight.available) throw new Error(sight.reason || "The assistant model can’t read images.");
    const record = store.put({
      id: importId(),
      createdAt: now(),
      by: String(by || ""),
      origin,
      input: { kind: "described", fileName: source.input.fileName || "", fromId: source.id },
      state: "resolving",
      title: source.title,
      resources: [],
      offers: [],
      grade: { value: "partial", reasons: ["Resolving"], missingFields: [] },
      results: { catalogueKeys: [] },
    });
    record.picture = Boolean(await pictures.copy(source.id, record.id).catch(() => false));
    return describeInto(record);
  }

  /** Swap a stand-in back for the exact file, once it is installed. */
  async function useExact(id, index) {
    const record = store.get(id);
    const resource = record?.resources?.[index];
    if (!resource?.substitute) throw new Error("That file isn’t using a substitute.");
    await refresh(record, { verify: true });
    if (!resource.exactInstalled)
      throw new Error(
        `${resource.want.file || resource.name} isn’t installed yet. Download it first.`,
      );
    delete resource.substitute;
    delete resource.exactInstalled;
    await refresh(record, { verify: true });
    return store.put(record);
  }

  /** Download one offered version or variant: it joins the import as an optional file. */
  async function acceptOffer(id, index, { by = "" } = {}) {
    const record = store.get(id);
    const offer = record?.offers?.[index];
    if (!offer) throw new Error("That offer is gone. Open the import again.");
    if (!offer.spec) throw new Error(offer.unavailable?.note || "That file can’t be downloaded.");
    let at = record.resources.findIndex((resource) => resource.spec?.id === offer.spec.id);
    if (at < 0) {
      const { url, ...source } = offer.source || {};
      record.resources.push({
        role: catalogueKinds[offer.folder] || "model",
        name: record.title || offer.file,
        version: offer.label,
        want: {
          file: offer.file,
          folder: offer.folder,
          sha256: offer.spec.sha256,
          bytes: offer.bytes,
          source: { ...source, url },
        },
        supported: true,
        spec: offer.spec,
        optional: true,
        offered: offer.relation,
        note: `${offer.variant}${offer.baseModel ? ` · ${offer.baseModel}` : ""}`,
        status: "missing",
      });
      at = record.resources.length - 1;
      if (offer.folder === "loras" && record.entryBase && source.provider) {
        const links =
          source.provider === "civitai"
            ? {
                civitaiCom: url,
                civitaiRed: String(url).replace("://civitai.com/", "://civitai.red/"),
              }
            : { hf: url };
        record.pendingEntries = {
          ...(record.pendingEntries || {}),
          [offer.file]: {
            ...record.entryBase,
            version: offer.label,
            sha256: offer.spec.sha256,
            ...(offer.bytes ? { bytes: offer.bytes } : {}),
            links,
            source,
          },
        };
      }
      store.put(record);
    }
    offer.taken = true;
    return downloadMissing(id, { indices: [at], by });
  }

  return {
    create,
    createFromImage,
    describeImport,
    useExact,
    acceptOffer,
    list,
    open,
    refresh,
    downloadMissing,
    setFolder,
    draft,
  };
}
