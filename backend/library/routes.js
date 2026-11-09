/**
 * The Library's routes (UI-PATTERNS › Library), administrators only:
 *
 *   GET  /api/library/imports                 import history, newest first
 *   POST /api/library/imports {url}           import a Civitai image or model link, or a Hugging Face link
 *   GET  /api/library/imports/:id             one import, its files checked in full
 *   DELETE /api/library/imports/:id           remove one import record (its downloaded files stay)
 *   POST /api/library/imports/clear-failed    remove every failed import record: {cleared}
 *   POST /api/library/imports/:id/download    Download Missing ({indices} for chosen files)
 *   POST /api/library/imports/:id/folder      {index, folder}: where a Hugging Face file goes
 *   POST /api/library/imports/:id/draft-profile  {index?}: draft a checkpoint's profile and guide (again, after a failure)
 *   POST /api/library/lookup {url|query, type?, baseModel?}  a link's versions and files, or a Civitai search (type lora or checkpoint), without importing
 *   GET  /api/library/placement?key=          where model files live, and where one file sits
 *   PATCH /api/library/catalogue {key, patch} edit one catalogue entry; the reply has the previous values
 *   POST /api/library/catalogue/undo {key}    undo its newest change (recorded as a change of its own)
 *   POST /api/library/catalogue/remove {key}  remove an entry no profile uses and its installed file (undo restores the entry)
 *   POST /api/library/imports/image           {image: data URL, name}: a dropped PNG, WebP or JPEG
 *   GET  /api/library/imports/:id/picture     an image import's own picture
 *   POST /api/library/imports/:id/describe    describe an imported image with the vision model (a new record)
 *   POST /api/library/imports/:id/exact       {index}: Use Exact File instead of its substitute
 *   POST /api/library/imports/:id/offers      {index}: download one offered version or variant
 *   GET  /api/library/items                   installed and catalogued LoRAs and models, with provenance and updates
 *   GET  /api/library/updates                 update states; POST …/check checks now; POST …/apply {key, alternative?}
 *
 * Imports follow the Presets & Civitai Imports deployment switch, as the saved images do. MCP's admin
 * tools (mcp/admin.js) call these same routes; their imports and edits record chat as the origin.
 */
import fs from "node:fs";
import path from "node:path";
import { writeBytesFileAsync } from "../json-store.js";
import { civitaiJson } from "../civitai/access.js";
import { versionResource } from "../civitai/import.js";
import { presetsEnabled } from "../features.js";
import { hfFetch } from "../hf-access.js";
import { catalogueKinds, splitCatalogueKey } from "./catalogue.js";
import { currentDataDir } from "../data-dir.js";
import { fileStem } from "../image-metadata.js";
import { findSubstitute } from "./substitutes.js";
import { createUpdateChecker, dailyMs, hfRepositoryMetadata } from "./updates.js";
import { loadSharp } from "../sharp-loader.js";
import { startLibraryDownload } from "./downloads.js";
import { createImportEngine, importStore, publicImport } from "./imports.js";
import { detectLink, resolveCivitaiModel, resolveHuggingFace } from "./sources.js";
import { familyFromName } from "../family-catalogue.js";
import { downloadState } from "../model/downloads.js";
import { directRoute } from "../domain/direct-route.ts";
import { fromChat, localRefusal } from "../route-access.js";
import { forgetLora } from "../lora/stacks.js";
import { libraryPlacement, lookupLibrary } from "./lookup.js";
import { refreshWorkerModels, workerInventory, workerModelFile } from "../worker-models.js";

const pictureEdge = 1280;
const maxImageBytes = 24 * 1024 * 1024;
const imageDataUrl = /^data:image\/(png|webp|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/;

/** A dropped image from its data URL, or an error saying why not. */
export function imageFromUpload(value) {
  const match = imageDataUrl.exec(String(value || ""));
  if (!match) throw new Error("Drop a PNG, WebP or JPEG image.");
  const data = Buffer.from(match[2], "base64");
  if (!data.length || data.length > maxImageBytes)
    throw new Error("That image is too large to import (24 MB at most).");
  return data;
}

/**
 * A dropped image's recorded file, found in this order: a catalogue entry with its checksum
 * (SHA-256 or its AutoV2 prefix), the exact file name installed, the exact Civitai version (by
 * version id or hash, which also gives its download), then the same name installed. Otherwise it
 * is unsourced: named, but with nothing to download it from.
 */
export async function matchImageResource(item, { installed = {}, entries = {}, json = null } = {}) {
  const folders = ["checkpoint", "diffusion_model"].includes(item.role)
    ? ["checkpoints", "diffusion_models"]
    : [item.folder];
  const label = item.name || item.file;
  const fromEntry = (key, matchedBy, extra = {}) => {
    const { folder, file } = splitCatalogueKey(key);
    const entry = entries[key] || {};
    const url = entry.links?.civitaiCom || entry.links?.hf || "";
    return {
      name: entry.title || label,
      version: entry.version || "",
      baseModel: entry.baseModel || "",
      want: {
        file,
        folder,
        sha256: entry.sha256 || "",
        bytes: entry.bytes || 0,
        source: { ...(entry.source || {}), ...(url ? { url } : {}) },
      },
      matchedBy,
      note: "",
      ...extra,
    };
  };
  if (item.hash) {
    const key = Object.keys(entries).find(
      (candidate) =>
        folders.includes(splitCatalogueKey(candidate).folder) &&
        entries[candidate]?.sha256?.startsWith(item.hash),
    );
    if (key) return fromEntry(key, "hash");
  }
  for (const folder of folders) {
    if (item.file && (installed[folder] || []).includes(item.file)) {
      const entry = entries[`${folder}/${item.file}`];
      const differs = item.hash && entry?.sha256 && !entry.sha256.startsWith(item.hash);
      if (!differs)
        return fromEntry(`${folder}/${item.file}`, "name", entry?.sha256 ? {} : { nameOnly: true });
    }
  }
  if (json && (item.versionId || item.hash)) {
    try {
      const version = await json(
        item.versionId ? `model-versions/${item.versionId}` : `model-versions/by-hash/${item.hash}`,
      );
      const resource = versionResource(version, item.strength ?? 1);
      if (resource.folder && resource.file)
        return {
          name: resource.name,
          version: resource.version,
          baseModel: resource.baseModel,
          want: {
            file: resource.file,
            folder: resource.folder,
            sha256: resource.sha256,
            bytes: resource.bytes,
            source: {
              provider: "civitai",
              modelId: version.modelId,
              versionId: version.id,
              url: resource.sourceUrl,
            },
          },
          spec: resource.spec,
          supported: Boolean(resource.spec),
          note: resource.note,
          matchedBy: item.versionId ? "version" : "hash",
          ...(resource.unavailable ? { unavailable: resource.unavailable } : {}),
        };
    } catch {
      /* Not on Civitai, or offline: try the name. */
    }
  }
  const stem = fileStem(item.file || item.name);
  for (const folder of folders) {
    const found = stem && (installed[folder] || []).find((name) => fileStem(name) === stem);
    if (found)
      return fromEntry(
        `${folder}/${found}`,
        "name",
        entries[`${folder}/${found}`]?.sha256 ? {} : { nameOnly: true },
      );
  }
  return {
    name: label,
    want: { file: item.file || "", folder: folders[0], sha256: "" },
    unsourced: true,
    nameOnly: true,
    note: "No download source was recorded. Install it by name, or import its model link.",
  };
}

/** Removes an installed model file, only when it is still the one recorded (by checksum when known). */
async function removeInstalled(want) {
  if (!want?.file || !Object.hasOwn(catalogueKinds, want.folder))
    throw new Error("That isn’t a model file Studio manages.");
  const names = subfolders[want.folder] || [want.folder];
  await refreshWorkerModels({ force: true });
  const file = workerInventory().files.find((item) =>
    names.some((folder) => item.path === `${folder}/${want.file}`),
  );
  if (!file) return { removed: false };
  await workerModelFile(
    { folder: file.path.split("/")[0], file: want.file, sha256: want.sha256 || "" },
    "remove",
  );
  await refreshWorkerModels({ force: true });
  return { removed: true };
}

/** Each import's own picture (longest edge 1280 px, WebP), beside the records. */
function importPictures({ dataDir = currentDataDir(), sharp = loadSharp } = {}) {
  const dir = path.join(dataDir, "library", "import-pictures");
  const fileFor = (id) =>
    /^imp-[a-z0-9]{6,40}$/.test(String(id)) ? path.join(dir, `${id}.webp`) : "";
  return {
    file: fileFor,
    async save(id, buffer) {
      const target = fileFor(id);
      const library = await sharp();
      if (!target || !library) return false;
      const data = await library(buffer, { limitInputPixels: 80_000_000 })
        .rotate()
        .resize({
          width: pictureEdge,
          height: pictureEdge,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer();
      await writeBytesFileAsync(target, data, { mode: 0o600 });
      // Pictures of pruned imports go too.
      const records = path.join(dataDir, "library", "imports");
      const names = await fs.promises.readdir(dir).catch(() => []);
      if (names.length > 520)
        for (const name of names)
          if (
            name.endsWith(".webp") &&
            !fs.existsSync(path.join(records, name.replace(/\.webp$/, ".json")))
          )
            await fs.promises.rm(path.join(dir, name), { force: true });
      return true;
    },
    async copy(from, to) {
      if (!fileFor(from) || !fileFor(to)) return false;
      await fs.promises.copyFile(fileFor(from), fileFor(to));
      return true;
    },
  };
}

const subfolders = {
  diffusion_models: ["diffusion_models", "unet"],
  text_encoders: ["text_encoders", "clip"],
};

/** Whether a wanted file is installed: by checksum when known (or `verify`), else by name and size. */
export async function inspectInstalled(want, { verify = false } = {}) {
  if (!want?.file || !Object.hasOwn(catalogueKinds, want.folder)) return { status: "missing" };
  const names = subfolders[want.folder] || [want.folder];
  const sized = (size) => !want.bytes || Math.abs(size - want.bytes) <= 2048;
  await refreshWorkerModels();
  const file = workerInventory().files.find((item) =>
    names.some((folder) => item.path === `${folder}/${want.file}`),
  );
  if (!file) return { status: "missing" };
  if (!want.sha256) return { status: "installed", unverified: true };
  if (verify) {
    const hash = (
      await workerModelFile({ folder: file.path.split("/")[0], file: want.file }, "hash")
    ).sha256;
    return hash === want.sha256 ? { status: "installed" } : { status: "conflict" };
  }
  return sized(file.size) ? { status: "installed", unverified: true } : { status: "conflict" };
}

const itemFields = [
  "modelType",
  "kind",
  "title",
  "version",
  "baseModel",
  "families",
  "role",
  "type",
  "triggers",
  "strength",
  "note",
  "uncensored",
  "links",
  "source",
  "origin",
  "sha256",
  "bytes",
  "aiDrafted",
];

// Model files whose name alone can say their family when no profile uses them.
const namedSources = { checkpoints: "checkpoint", diffusion_models: "unet" };

/**
 * The families of an uncatalogued model file: those of the profiles whose definition names it
 * (`profiles`: [{family, text}]), else a family read from a checkpoint's or diffusion model's name.
 */
function modelFileFamilies(folder, file, profiles) {
  const quoted = JSON.stringify(file);
  const used = profiles.filter((profile) => profile.family && profile.text.includes(quoted));
  if (used.length) return [...new Set(used.map((profile) => profile.family))].sort();
  if (!namedSources[folder]) return [];
  const named = familyFromName(file, namedSources[folder]);
  if (named === "sdxl_or_sd15") return [/1[._]?5|sd15|v1[-_]5/i.test(file) ? "sd15" : "sdxl"];
  return named ? [named] : [];
}

/**
 * Installed files (`installed`: {folder: names}) joined with the catalogue (`entries`), plus
 * catalogue entries that aren't installed. `loraInfo` fills a LoRA's role and base from its file;
 * `profiles` ([{family, text}], each saved profile's definition) the families of other model files.
 */
export function libraryItems({ installed = {}, entries = {}, loraInfo = {}, profiles = [] }) {
  const items = new Map();
  const add = (folder, file, isInstalled) => {
    const key = `${folder}/${file}`;
    const entry = entries[key] || {};
    const info = folder === "loras" ? loraInfo[file] || {} : {};
    const item = items.get(key) || {
      key,
      folder,
      file,
      kind: catalogueKinds[folder],
      installed: false,
    };
    for (const field of itemFields)
      if (entry[field] !== undefined && entry[field] !== "") item[field] = entry[field];
    if (!item.title && info.title) item.title = info.title;
    if (!item.role && info.role) item.role = info.role;
    if (!item.type && info.type) item.type = info.type;
    if (!item.baseModel && info.base) item.baseModel = info.base;
    if ((!item.families || !item.families.length) && info.families?.length)
      item.families = info.families;
    if ((!item.triggers || !item.triggers.length) && info.triggers?.length)
      item.triggers = info.triggers;
    if (folder !== "loras" && !item.families?.length) {
      const found = modelFileFamilies(folder, file, profiles);
      if (found.length) item.families = found;
    }
    if (!item.note && info.note) item.note = info.note;
    if (entry.description) item.description = String(entry.description).slice(0, 600);
    if (!item.links?.civitaiCom && !item.links?.hf && info.sourceUrl)
      item.links = { ...(item.links || {}), civitaiCom: info.sourceUrl };
    item.installed ||= isInstalled;
    items.set(key, item);
  };
  for (const [folder, names] of Object.entries(installed))
    for (const name of names || []) if (typeof name === "string" && name) add(folder, name, true);
  for (const key of Object.keys(entries)) {
    const [folder, ...rest] = key.split("/");
    if (!items.has(key)) add(folder, rest.join("/"), false);
  }
  return [...items.values()].sort((a, b) => (a.title || a.file).localeCompare(b.title || b.file));
}

/**
 * `presets` is what registerPresetRoutes returns (importImage, resolvePreset); `installed()` the
 * files ComfyUI lists per folder; `loraInfo(names)` the LoRA metadata (lora/info.js);
 * `catalogue()` the catalogue store.
 */
export function registerLibraryRoutes(
  app,
  {
    presets,
    installed,
    /** {files, current}: the files `installed` lists as last known, without waiting on the worker. */
    latestInstalled = async () => ({ files: await installed(), current: true }),
    loraInfo,
    catalogue,
    json = civitaiJson,
    hfRequest = hfFetch,
    inspect = inspectInstalled,
    downloads = downloadState,
    startDownload = startLibraryDownload,
    store = importStore(),
    /** [{id, label, kind, family, familyName, model}]: the image profiles and the base model each runs. */
    profiles = async () => [],
    /** Drafts a checkpoint import's profile and guide (profile/drafts.js), or null. */
    draftProfile = null,
    /** Lookup: the family ids for a base model, and the ready profiles [{id, family}] it may fit. */
    families = () => [],
    readyProfiles = async () => [],
    /** Family ids for a base model name ("Flux.1 D", "sdxl"). */
    familiesOf = () => [],
    /** Whether the worker has the GGUF loader nodes. */
    gguf = async () => false,
    /** The prompt assistant engine (assistant.js), or null while it is unset. */
    assistant = () => null,
    /** Each saved profile's family and definition text, [{family, text}]: which model files it names. */
    profileDefinitions = async () => [],
    /** Moves profiles from an updated file's old name to its new one: the names it moved. */
    repoint = async () => [],
    /** What still uses a model file: ['the Flux Dev profile', …] (update clean-up, Decision 4). */
    references = async () => [],
    removeFile = removeInstalled,
    /** Takes a removed LoRA out of every account's stacks, strengths, ratings and recents (lora/stacks.js). */
    forget = forgetLora,
    pictures = importPictures(),
    schedule = true,
  },
) {
  // One answer for a burst of reads (a list of imports asks for every file's stand-in).
  const recent = (load, ms = 5000) => {
    let at = 0;
    let value = null;
    return async () => {
      if (!value || Date.now() - at > ms) {
        value = load();
        at = Date.now();
        value.catch(() => {
          value = null;
        });
      }
      return value;
    };
  };
  const installedNow = recent(() => installed());
  const profilesNow = recent(() => profiles());
  const visionNow = async () => {
    const engine = assistant();
    if (!engine)
      return {
        available: false,
        reason: "Set up the prompt assistant in Settings › Integrations to describe images.",
      };
    try {
      return (await engine.supportsVision())
        ? { available: true, reason: "" }
        : {
            available: false,
            reason:
              "The running text model can’t read images. Start one that does in Settings › Workers.",
          };
    } catch {
      return { available: false, reason: "The prompt assistant is unavailable." };
    }
  };
  const describePicture = async ({ id }) => {
    const engine = assistant();
    if (!engine) throw new Error("The prompt assistant isn’t set up.");
    const file = pictures.file(id);
    const data = (await fs.promises.readFile(file)).toString("base64");
    const offered = await profilesNow().catch(() => []);
    const loras = ((await installedNow().catch(() => ({}))).loras || []).map((name) => ({ name }));
    const result = await engine.describe({
      images: [{ mime: "image/webp", data }],
      profiles: offered.map(({ id: profileId, label }) => ({ id: profileId, label })),
      loras,
    });
    if (!result.available)
      throw new Error(result.reason || "The running text model can’t read images.");
    return {
      ...result,
      profileLabel: offered.find((item) => item.id === result.profileId)?.label || "",
      loras: result.loras || [],
    };
  };
  const engine = createImportEngine({
    store,
    detect: detectLink,
    inspect,
    downloads,
    startDownload,
    catalogue: { edit: (...args) => catalogue().edit(...args) },
    draftProfile,
    resolveCivitai: async (url) =>
      resolveCivitaiModel(url, { json, familiesOf, gguf: await gguf().catch(() => false) }),
    resolveHf: async (url) =>
      resolveHuggingFace(url, { request: hfRequest, gguf: await gguf().catch(() => false) }),
    importImage: (url) => presets.importImage(url),
    resolvePreset: (id, options) => presets.resolvePreset(id, options),
    matchImage: async (item) =>
      matchImageResource(item, {
        installed: await installedNow().catch(() => ({})),
        entries: catalogue().entries({ throttleMs: 5000 }),
        json,
      }),
    substituteFor: async (resource, record) => {
      const files = Object.entries(await installedNow().catch(() => ({}))).flatMap(
        ([folder, names]) => (names || []).map((file) => ({ folder, file })),
      );
      const list = (await profilesNow().catch(() => [])).filter((item) => item.kind !== "video");
      const [family] = familiesOf(
        resource.baseModel || record?.baseModel || resource.want.file || resource.name || "",
      );
      return findSubstitute(
        {
          file: resource.want.file,
          name: resource.want.file ? "" : resource.name,
          folder: resource.want.folder,
        },
        files,
        {
          role: resource.role,
          family,
          familyName: list.find((item) => item.family === family)?.familyName || "",
          profiles: list,
        },
      );
    },
    profileFor: async (file) =>
      (await profilesNow().catch(() => [])).find(
        (item) => item.kind !== "video" && item.model === file,
      )?.id || "",
    pictures,
    describe: describePicture,
    vision: visionNow,
  });
  const installedKeys = async () =>
    new Set(
      Object.entries(await installedNow().catch(() => ({}))).flatMap(([folder, names]) =>
        (names || []).map((file) => `${folder}/${file}`),
      ),
    );
  const updates = createUpdateChecker({
    catalogue: {
      entries: () => catalogue().entries({ throttleMs: 5000 }),
      edit: (...args) => catalogue().edit(...args),
    },
    installed: installedKeys,
    json,
    hfMetadata: (repo) => hfRepositoryMetadata(repo, { request: hfRequest }),
    familiesOf,
    startDownload,
    downloads,
    inspect,
    repoint,
    references,
    removeFile,
  });
  if (schedule) {
    const check = () =>
      updates
        .check()
        .catch((error) => console.warn(`[library] The update check failed: ${error.message}`));
    setTimeout(check, 10 * 60 * 1000).unref?.();
    setInterval(check, dailyMs).unref?.();
    setInterval(() => {
      updates.settle().catch(() => undefined);
    }, 30 * 1000).unref?.();
  }
  const by = (account) => String(account?.userId || account?.id || account?.username || "");
  const origin = (account, other) => (fromChat(account) ? "chat" : other);
  const ok = (payload) => ({ status: 200, payload: { ok: true, ...payload } });
  const refusal = (account, imports) => {
    const refused = localRefusal(account);
    if (refused) return refused;
    if (imports && !presetsEnabled())
      return { status: 404, payload: { ok: false, error: "Imports are off for this deployment." } };
    return null;
  };
  /** A Library route: administrators only, imports' routes only while imports are on; a failure answers 400. */
  const route = (method, path, run, { imports = true } = {}) =>
    directRoute(app, method, path, async (account, input) => {
      const refused = refusal(account, imports);
      if (refused) return refused;
      try {
        return await run(account, input);
      } catch (error) {
        return { status: 400, payload: { ok: false, error: error.message } };
      }
    });
  app.use(
    [
      "/api/library/imports",
      "/api/library/items",
      "/api/library/lookup",
      "/api/library/placement",
      "/api/library/catalogue",
      "/api/library/updates",
    ],
    (_req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      next();
    },
  );

  route("GET", "/api/library/imports", async () =>
    ok({ imports: (await engine.list()).map(publicImport), vision: await visionNow() }),
  );
  route("POST", "/api/library/imports/image", async (account, { body }) => {
    const record = await engine.createFromImage({
      data: imageFromUpload(body?.image),
      name: String(body?.name || ""),
      by: by(account),
      origin: origin(account, "ui"),
    });
    return ok({ import: publicImport(record) });
  });
  app.get("/api/library/imports/:id/picture", (req, res) => {
    const refused = refusal(req.studioAccount, true);
    if (refused) return res.status(refused.status).json(refused.payload);
    const file = store.get(req.params.id)?.picture ? pictures.file(req.params.id) : "";
    if (!file || !fs.existsSync(file)) return res.sendStatus(404);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.type("webp").sendFile(file, { dotfiles: "allow" });
  });
  route("POST", "/api/library/imports/:id/describe", async (account, { params }) =>
    ok({
      import: publicImport(
        await engine.describeImport(params.id, { by: by(account), origin: origin(account, "ui") }),
      ),
    }),
  );
  route("POST", "/api/library/imports/:id/exact", async (_account, { params, body }) =>
    ok({ import: publicImport(await engine.useExact(params.id, Number(body?.index))) }),
  );
  route("POST", "/api/library/imports/:id/offers", async (account, { params, body }) => {
    const result = await engine.acceptOffer(params.id, Number(body?.index), { by: by(account) });
    return ok({
      import: publicImport(result.record),
      queued: result.queued,
      failures: result.failures,
    });
  });
  route("POST", "/api/library/imports", async (account, { body }) => {
    const record = await engine.create(String(body?.url || ""), {
      by: by(account),
      origin: origin(account, "ui"),
    });
    // A failed resolve is still a record (with its reason), so it answers like any other.
    return ok({ import: publicImport(record) });
  });
  /** Forgets a record and its picture; downloaded model files stay. */
  const forgetImport = (id) => {
    if (!store.remove(id)) return false;
    const picture = pictures.file(id);
    if (picture) fs.rmSync(picture, { force: true });
    return true;
  };
  route("POST", "/api/library/imports/clear-failed", async () => {
    const failed = store.list().filter((record) => record.state === "failed");
    return ok({ cleared: failed.filter((record) => forgetImport(record.id)).length });
  });
  route("DELETE", "/api/library/imports/:id", async (_account, { params }) =>
    forgetImport(params.id)
      ? ok({})
      : { status: 404, payload: { ok: false, error: "That import is gone." } },
  );
  route("GET", "/api/library/imports/:id", async (_account, { params }) => {
    const record = await engine.open(params.id);
    if (!record) return { status: 404, payload: { ok: false, error: "That import is gone." } };
    return ok({ import: publicImport(record) });
  });
  route("POST", "/api/library/imports/:id/download", async (account, { params, body }) => {
    const indices = Array.isArray(body?.indices)
      ? body.indices.filter((value) => Number.isSafeInteger(value) && value >= 0)
      : null;
    const result = await engine.downloadMissing(params.id, { indices, by: by(account) });
    return ok({
      import: publicImport(result.record),
      queued: result.queued,
      failures: result.failures,
    });
  });
  route("POST", "/api/library/imports/:id/folder", async (_account, { params, body }) =>
    ok({
      import: publicImport(
        await engine.setFolder(params.id, Number(body?.index), String(body?.folder || "")),
      ),
    }),
  );
  route("POST", "/api/library/imports/:id/draft-profile", async (account, { params, body }) => {
    const index = Number.isSafeInteger(body?.index) && body.index >= 0 ? body.index : null;
    return ok({ import: publicImport(await engine.draft(params.id, { by: by(account), index })) });
  });
  route(
    "GET",
    "/api/library/items",
    async () => {
      const { files, current } = await latestInstalled().catch(() => ({
        files: {},
        current: false,
      }));
      const [info, definitions] = await Promise.all([
        // A worker that isn't answering is not asked for each LoRA's metadata.
        loraInfo(files.loras || [], { remote: current }).catch(() => ({})),
        profileDefinitions().catch(() => []),
      ]);
      const state = await updates.settle().catch(() => updates.summary());
      const items = libraryItems({
        installed: files,
        entries: catalogue().entries({ throttleMs: 5000 }),
        loraInfo: info,
        profiles: definitions,
      }).map((item) => {
        const update = item.installed ? state.byEntry[item.key] : null;
        const applied = state.applied[item.key];
        return { ...item, ...(update ? { update } : {}), ...(applied ? { applied } : {}) };
      });
      return ok({ items, updates: { checkedAt: state.checkedAt, available: state.available } });
    },
    { imports: false },
  );
  route(
    "POST",
    "/api/library/lookup",
    async (_account, { body }) => {
      const found = await lookupLibrary(
        {
          url: String(body?.url || "").trim(),
          query: String(body?.query || ""),
          type: ["lora", "checkpoint"].includes(body?.type) ? body.type : "",
          baseModel: String(body?.baseModel || ""),
        },
        { json, hfRequest, inspect, families, profiles: readyProfiles },
      );
      return ok({ lookup: found });
    },
    { imports: false },
  );
  route(
    "GET",
    "/api/library/placement",
    async (_account, { query }) => {
      await refreshWorkerModels().catch(() => null);
      return ok({
        placement: libraryPlacement(
          { key: String(query.key || "") },
          { inventory: workerInventory },
        ),
      });
    },
    { imports: false },
  );
  // One entry's edit, as Studio's catalogue keeps it: the previous values come back, so it can be undone.
  route(
    "PATCH",
    "/api/library/catalogue",
    async (account, { body }) => {
      const key = String(body?.key || "");
      const { entry, previous } = catalogue().edit(key, body?.patch, {
        by: by(account),
        origin: origin(account, "admin"),
      });
      return ok({ key, entry, previous });
    },
    { imports: false },
  );
  route(
    "POST",
    "/api/library/catalogue/undo",
    async (account, { body }) => {
      const key = String(body?.key || "");
      return ok({ key, entry: catalogue().undo(key, { by: by(account) }) });
    },
    { imports: false },
  );
  // Removes an entry and its installed file, unless a profile still uses it; a LoRA leaves every
  // account's stacks, strengths, ratings and recents first.
  route(
    "POST",
    "/api/library/catalogue/remove",
    async (account, { body }) => {
      const key = String(body?.key || "");
      const entry = catalogue().entry(key);
      if (!entry)
        return { status: 404, payload: { ok: false, error: "That entry isn’t in the catalogue." } };
      const { folder, file } = splitCatalogueKey(key);
      if (folder === "loras") forget(file);
      const users = await references({ folder, file });
      if (users.length)
        return {
          status: 409,
          payload: { ok: false, error: `Still used by ${users.join(", ")}.`, users },
        };
      const { removed } = await removeFile({ folder, file, sha256: entry.sha256 || "" });
      catalogue().edit(
        key,
        { removed: true },
        { by: by(account), origin: origin(account, "admin") },
      );
      return ok({ key, fileRemoved: removed });
    },
    { imports: false },
  );
  route(
    "GET",
    "/api/library/updates",
    async () => ok(await updates.settle().catch(() => updates.summary())),
    { imports: false },
  );
  route(
    "POST",
    "/api/library/updates/check",
    async (_account, { body }) => {
      const keys = Array.isArray(body?.keys) ? body.keys.map(String).slice(0, 300) : null;
      return ok(await updates.check({ keys }));
    },
    { imports: false },
  );
  route("POST", "/api/library/updates/apply", async (account, { body }) => {
    const applied = await updates.apply(String(body?.key || ""), {
      alternative: body?.alternative === true,
      by: by(account),
    });
    // `applied` is this key's record; the summary's map of every applied update would hide it.
    return ok({ ...updates.summary(), applied });
  });
  return { engine, updates };
}
