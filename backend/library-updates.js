// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Update checks (design §4, Updates; Decision 4): a daily check, and Check Updates on demand,
 * for installed catalogue entries with a Civitai model or a Hugging Face file. An update shows
 * as Update Available (and puts a dot on the Library's dock icon); nothing downloads on its own.
 *
 * Update downloads the new file under its own name. Once it is installed and verified, the
 * catalogue entry and every profile that named the old file move to the new one. If nothing
 * references the old file any more (no profile, no saved LoRA stack), the old file is removed
 * through the worker model API; otherwise it stays, and the update says what still uses it.
 *
 * Paid and early-access versions are never downloaded: they show with the reason and the newest
 * free version, when there is one, to update to instead.
 *
 * State lives in `<data>/library/updates.json`:
 *   {checkedAt, byEntry: {key: {state: available|current|error, latest?, freeAlternative?, note, checkedAt}},
 *    applied: {key: {downloadId, from, to, state: downloading|kept|removed|failed, note, startedAt, finishedAt?}}}
 */
import path from "node:path";
import { currentDataDir } from "./data-dir.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { civitaiFileSpec, civitaiModelFiles } from "./civitai-import.js";
import { civitaiAvailability } from "./library-availability.js";
import { splitCatalogueKey } from "./library-catalogue.js";
import { limitedBody } from "./civitai-access.js";

export const dailyMs = 24 * 60 * 60 * 1000;
const checkLimit = 300;
const shareFamily = (a = [], b = []) =>
  !a.length || !b.length || a.some((family) => b.includes(family));
const iso = (at) => new Date(at).toISOString();

/** The newest same-family Civitai version above the installed one, from the model's versions. */
export function civitaiUpdate(entry, model, { familiesOf = () => [], now = Date.now() } = {}) {
  const versions = Array.isArray(model?.modelVersions) ? model.modelVersions : [];
  const at = versions.findIndex((item) => item.id === entry.source?.versionId);
  if (at < 0)
    return { state: "error", note: "The installed version is no longer listed on Civitai." };
  const families = familiesOf(entry.baseModel || versions[at].baseModel || "");
  const shell = { name: model.name, type: model.type, mode: model.mode, nsfw: model.nsfw };
  const newer = versions
    .slice(0, at)
    .filter(
      (item) =>
        shareFamily(families, familiesOf(item.baseModel || "")) &&
        (families.length || !item.baseModel || item.baseModel === versions[at].baseModel),
    );
  const describe = (version) => {
    const full = { ...version, modelId: model.id, model: shell };
    const files = civitaiModelFiles(full);
    const file = files.find((item) => item.primary) || files[0];
    if (!file) return null;
    const access = civitaiAvailability(full, file, { now });
    const spec = civitaiFileSpec(full, file, { now });
    return {
      versionId: version.id,
      name: String(version.name || version.id),
      file: file.name,
      bytes: Number(file.sizeKB || 0) * 1024,
      baseModel: String(version.baseModel || ""),
      url: `https://civitai.com/models/${model.id}?modelVersionId=${version.id}`,
      trainedWords: (Array.isArray(version.trainedWords) ? version.trainedWords : [])
        .map(String)
        .slice(0, 30),
      ...(spec
        ? { spec }
        : {
            unavailable: access.available
              ? { reason: "no-checksum", note: "Civitai publishes no SHA-256 for this file." }
              : { reason: access.reason, note: access.note },
          }),
    };
  };
  const candidates = newer.map(describe).filter(Boolean);
  if (!candidates.length) return { state: "current", note: "" };
  const [latest] = candidates;
  const free = latest.unavailable ? candidates.find((item) => item.spec) : null;
  return {
    state: "available",
    latest,
    ...(free ? { freeAlternative: free } : {}),
    note: latest.unavailable
      ? `${latest.name} ${latest.unavailable.reason === "paid" ? "is paid" : latest.unavailable.reason === "early-access" ? "is in early access" : "can’t be downloaded"}${free ? `; ${free.name} is free` : ""}.`
      : `${latest.name} is newer than ${versions[at].name || "the installed version"}.`,
  };
}

/** A Hugging Face file changed upstream: the same path with another checksum on main. */
export function hfUpdate(entry, metadata) {
  const filePath = entry.source?.path;
  const sibling = (Array.isArray(metadata?.siblings) ? metadata.siblings : []).find(
    (item) => item?.rfilename === filePath,
  );
  if (!sibling) return { state: "error", note: "The file is no longer in the repository." };
  const sha256 = /^[a-f0-9]{64}$/i.test(sibling.lfs?.sha256 || "")
    ? sibling.lfs.sha256.toLowerCase()
    : "";
  if (!sha256 || !/^[a-f0-9]{40}$/i.test(metadata.sha || ""))
    return { state: "error", note: "Hugging Face publishes no checksum for this file." };
  if (!entry.sha256 || sha256 === entry.sha256) return { state: "current", note: "" };
  const revision = metadata.sha;
  const base = path.posix.basename(filePath);
  const extension = path.posix.extname(base);
  // The new file gets its own name, so the old one stays until the new one verifies.
  const file = `${base.slice(0, -extension.length)}-${revision.slice(0, 7)}${extension}`;
  const repo = entry.source.repo;
  const url = `https://huggingface.co/${repo}/resolve/${revision}/${filePath.split("/").map(encodeURIComponent).join("/")}`;
  const bytes = Number(sibling.lfs?.size || sibling.size || 0);
  return {
    state: "available",
    note: `The repository has a new revision of ${base}.`,
    latest: {
      revision,
      name: revision.slice(0, 7),
      file,
      path: filePath,
      bytes,
      url: `https://huggingface.co/${repo}/blob/${revision}/${filePath}`,
      spec: {
        id: `hf:${repo}:${revision}:${filePath}`,
        file,
        folder: "",
        label: base,
        url,
        sha256,
        bytes,
        sourceUrl: `https://huggingface.co/${repo}/blob/${revision}/${filePath}`,
      },
    },
  };
}

const publicChoice = (item) =>
  item ? (({ spec, ...rest }) => ({ ...rest, downloadable: Boolean(spec) }))(item) : undefined;
/** An update as the browser sees it: no download specs. */
export function publicUpdate(item) {
  if (!item) return null;
  return {
    ...item,
    ...(item.latest ? { latest: publicChoice(item.latest) } : {}),
    ...(item.freeAlternative ? { freeAlternative: publicChoice(item.freeAlternative) } : {}),
  };
}

/**
 * The checker over one data folder. Dependencies are injected so tests run offline:
 *   catalogue                   library-catalogue.js store (entries, edit)
 *   installed()                 Set of installed catalogue keys
 *   json(path)                  Civitai API; hfMetadata(repo) the repository's main revision
 *   familiesOf(baseModel)       family ids
 *   startDownload(spec)         library-downloads.js; downloads() model-downloads.js state
 *   inspect(want, {verify})     library-routes.js inspectInstalled
 *   repoint(from, to)           moves profiles from the old file to the new one: their names
 *   references({folder, file})  what still uses a file: ['Profile Flux Dev', …]
 *   removeFile(want)            removes an installed file (the worker model API), checking its hash
 */
export function createUpdateChecker({
  dataDir = currentDataDir(),
  catalogue,
  installed = async () => new Set(),
  json,
  hfMetadata,
  familiesOf = () => [],
  startDownload,
  downloads = () => ({ active: null, queued: [], recent: [] }),
  inspect,
  repoint = async () => [],
  references = async () => [],
  removeFile,
  now = Date.now,
  log = console,
} = {}) {
  const file = path.join(dataDir, "library", "updates.json");
  let state = null;
  let checking = null;
  const load = () => {
    if (state) return state;
    try {
      const saved = readJsonFile(file);
      state =
        saved && typeof saved === "object"
          ? { checkedAt: "", byEntry: {}, applied: {}, ...saved }
          : null;
    } catch {
      state = null;
    }
    state ||= { checkedAt: "", byEntry: {}, applied: {} };
    return state;
  };
  const save = () => writeJsonFile(file, load());

  async function latestFor(key, entry) {
    const source = entry.source || {};
    if (
      source.provider === "civitai" &&
      Number.isSafeInteger(source.modelId) &&
      Number.isSafeInteger(source.versionId)
    ) {
      const model = await json(`models/${source.modelId}`);
      return civitaiUpdate(entry, model, { familiesOf, now: now() });
    }
    if (source.provider === "hf" && source.repo && source.path) {
      const result = hfUpdate(entry, await hfMetadata(source.repo));
      if (result.latest?.spec) result.latest.spec.folder = splitCatalogueKey(key).folder;
      return result;
    }
    return null;
  }

  /** Checks every installed entry with a source (or just `keys`). One at a time, so providers aren't flooded. */
  async function check({ keys = null } = {}) {
    if (checking) return checking;
    checking = (async () => {
      const current = load();
      const have = await installed().catch(() => new Set());
      const entries = Object.entries(catalogue.entries())
        .filter(
          ([key, entry]) =>
            have.has(key) &&
            (!keys || keys.includes(key)) &&
            ["civitai", "hf"].includes(entry.source?.provider),
        )
        .slice(0, checkLimit);
      for (const [key, entry] of entries) {
        // An update on its way, or done with the old file kept for what still uses it, isn't offered again.
        if (["downloading", "kept"].includes(current.applied[key]?.state)) continue;
        try {
          const result = await latestFor(key, entry);
          if (result) current.byEntry[key] = { ...result, checkedAt: iso(now()) };
        } catch (error) {
          current.byEntry[key] = {
            ...(current.byEntry[key] || {}),
            state: current.byEntry[key]?.state === "available" ? "available" : "error",
            note: `The check failed: ${error.message}`,
            checkedAt: iso(now()),
          };
        }
      }
      // Forget entries that are no longer installed.
      for (const key of Object.keys(current.byEntry))
        if (!have.has(key) && !keys) delete current.byEntry[key];
      if (!keys) current.checkedAt = iso(now());
      save();
      return summary();
    })().finally(() => {
      checking = null;
    });
    return checking;
  }

  /** Updates for the browser: every entry's state, the applied ones, and how many are available. */
  function summary() {
    const current = load();
    const byEntry = Object.fromEntries(
      Object.entries(current.byEntry).map(([key, item]) => [key, publicUpdate(item)]),
    );
    return {
      checkedAt: current.checkedAt,
      available: Object.values(current.byEntry).filter((item) => item.state === "available").length,
      byEntry,
      applied: current.applied,
    };
  }

  /** Download an update (or its free alternative) under its own name. */
  async function apply(key, { alternative = false, by = "" } = {}) {
    const current = load();
    const item = current.byEntry[key];
    if (item?.state !== "available")
      throw new Error("No update is available for that file. Check Updates first.");
    const choice = alternative ? item.freeAlternative : item.latest;
    if (!choice) throw new Error("That update has no free version.");
    if (!choice.spec)
      throw new Error(choice.unavailable?.note || "That update can’t be downloaded.");
    const { folder, file: oldFile } = splitCatalogueKey(key);
    const spec = { ...choice.spec, folder: choice.spec.folder || folder };
    const download = await startDownload(spec);
    const entry = catalogue.entries()[key] || {};
    current.applied[key] = {
      downloadId: download?.id || spec.id,
      by: String(by || ""),
      startedAt: iso(now()),
      state: "downloading",
      note: `Downloading ${choice.name}.`,
      from: { folder, file: oldFile, sha256: entry.sha256 || "" },
      to: {
        folder: spec.folder,
        file: spec.file,
        sha256: spec.sha256,
        bytes: spec.bytes,
        name: choice.name,
        versionId: choice.versionId,
        revision: choice.revision,
        path: choice.path,
        url: choice.url,
        trainedWords: choice.trainedWords,
      },
    };
    save();
    return current.applied[key];
  }

  /**
   * Finishes updates whose download has landed: the catalogue moves to the new file, then the
   * old file is removed when nothing references it (Decision 4), or kept with the reason.
   */
  async function settle() {
    const current = load();
    const queue = downloads();
    const running = new Set(
      [queue.active, ...(queue.queued || [])].filter(Boolean).map((item) => item.id),
    );
    const recent = new Map((queue.recent || []).map((item) => [item.id, item]));
    let changed = false;
    for (const [key, applied] of Object.entries(current.applied)) {
      if (applied.state !== "downloading" || running.has(applied.downloadId)) continue;
      const finished = recent.get(applied.downloadId);
      if (finished && ["error", "canceled"].includes(finished.status)) {
        Object.assign(applied, {
          state: "failed",
          note: finished.error || "The download stopped. Update again to retry.",
          finishedAt: iso(now()),
        });
        changed = true;
        continue;
      }
      const found = await inspect(
        {
          folder: applied.to.folder,
          file: applied.to.file,
          sha256: applied.to.sha256,
          bytes: applied.to.bytes,
        },
        { verify: true },
      ).catch(() => ({ status: "missing" }));
      if (found.status !== "installed" || found.unverified) {
        if (found.status === "conflict") {
          Object.assign(applied, {
            state: "failed",
            note: "The new file didn’t match its checksum.",
            finishedAt: iso(now()),
          });
          changed = true;
        }
        continue;
      }
      const old = catalogue.entries()[key] || {};
      const newKey = `${applied.to.folder}/${applied.to.file}`;
      const source =
        old.source?.provider === "civitai"
          ? { provider: "civitai", modelId: old.source.modelId, versionId: applied.to.versionId }
          : { ...old.source, revision: applied.to.revision };
      const links =
        source.provider === "civitai"
          ? {
              civitaiCom: applied.to.url,
              civitaiRed: String(applied.to.url).replace("://civitai.com/", "://civitai.red/"),
            }
          : { hf: applied.to.url };
      const patch = {
        ...Object.fromEntries(
          [
            "title",
            "baseModel",
            "role",
            "triggers",
            "strength",
            "promptStyle",
            "tags",
            "negative",
            "description",
            "nsfw",
            "licence",
            "compatibility",
          ]
            .filter((field) => old[field] !== undefined && old[field] !== null && old[field] !== "")
            .map((field) => [field, old[field]]),
        ),
        version: String(applied.to.name || ""),
        sha256: applied.to.sha256,
        ...(applied.to.bytes ? { bytes: applied.to.bytes } : {}),
        source,
        links,
        ...(applied.to.trainedWords?.length ? { triggers: applied.to.trainedWords } : {}),
      };
      try {
        catalogue.edit(newKey, patch, {
          by: applied.by || "update",
          origin: "import",
          provenance: true,
        });
      } catch (error) {
        log.warn?.(`[library] Couldn’t move the catalogue entry for ${key}: ${error.message}`);
      }
      const moved = await Promise.resolve(repoint(applied.from, applied.to)).catch((error) => {
        log.warn?.(`[library] Couldn’t move profiles off ${applied.from.file}: ${error.message}`);
        return [];
      });
      const movedNote = moved.length
        ? ` Moved ${moved.length === 1 ? `the ${moved[0]} profile` : `${moved.length} profiles`} to it.`
        : "";
      const users = await references(applied.from).catch(() => ["an unreadable reference"]);
      if (users.length)
        Object.assign(applied, {
          state: "kept",
          note: `The old file stays: ${users.slice(0, 3).join(", ")}${users.length > 3 ? ` and ${users.length - 3} more` : ""} still use${users.length === 1 ? "s" : ""} it.`,
        });
      else {
        try {
          await removeFile(applied.from);
          Object.assign(applied, {
            state: "removed",
            note: `Updated to ${applied.to.name}.${movedNote} The old file was removed.`,
          });
        } catch (error) {
          Object.assign(applied, {
            state: "kept",
            note: `Updated to ${applied.to.name}.${movedNote} The old file couldn’t be removed: ${error.message}`,
          });
        }
      }
      try {
        catalogue.edit(
          key,
          { note: `Replaced by ${applied.to.file}.` },
          { by: "update", origin: "import" },
        );
      } catch {
        /* Only a note. */
      }
      applied.finishedAt = iso(now());
      applied.newKey = newKey;
      current.byEntry[newKey] = { state: "current", note: "", checkedAt: iso(now()) };
      delete current.byEntry[key];
      changed = true;
    }
    if (changed) save();
    return summary();
  }

  return {
    file,
    check,
    summary,
    apply,
    settle,
    reload: () => {
      state = null;
      return load();
    },
  };
}

/** A Hugging Face repository's main revision with its files, through the saved token. */
export async function hfRepositoryMetadata(repo, { request }) {
  const [owner, name] = String(repo).split("/");
  const response = await request(
    `https://huggingface.co/api/models/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/revision/main?blobs=true`,
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Hugging Face answered HTTP ${response.status}`);
  }
  return JSON.parse((await limitedBody(response, 8 * 1024 * 1024)).toString());
}
