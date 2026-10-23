import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { comfyUrl, modelFolders } from "./comfy.js";
import { remoteModelsEnabled, refreshWorkerModels, workerModelFile } from "./worker-models.js";
import {
  civitaiAssetUrl,
  civitaiGenerationData,
  civitaiJson,
  isCivitaiHost,
} from "./civitai-access.js";
import { sameResourceFilename, workflowModelSources } from "./civitai-workflow.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { civitaiAvailability } from "./library-availability.js";
import { a1111Samplers, a1111Schedules } from "./image-metadata.js";

const samplers = a1111Samplers;
const schedules = a1111Schedules;
const folders = {
  Checkpoint: "checkpoints",
  "Diffusion Model": "diffusion_models",
  LORA: "loras",
  LoCon: "loras",
  "Text Encoder": "text_encoders",
  VAE: "vae",
};
const hashes = new Map();

export function civitaiLink(value, kind = "images") {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error(`Paste a Civitai ${kind === "images" ? "image" : "model"} link.`);
  }
  const match = url.pathname.match(new RegExp(`^/${kind}/([1-9]\\d*)(?:/[^/]*)?/?$`));
  if (
    url.protocol !== "https:" ||
    !isCivitaiHost(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !match ||
    [...url.searchParams.keys()].some((key) => key !== "modelVersionId")
  )
    throw new Error(
      `Use a link from civitai.com/${kind}/… or civitai.red/${kind}/… without credentials.`,
    );
  const id = Number(match[1]);
  const versionId = url.searchParams.has("modelVersionId")
    ? Number(url.searchParams.get("modelVersionId"))
    : null;
  if (
    !Number.isSafeInteger(id) ||
    (versionId !== null && (!Number.isSafeInteger(versionId) || versionId < 1))
  )
    throw new Error("The Civitai link has an invalid ID.");
  return { id, versionId };
}

function number(value, min, max) {
  if (value === null || value === undefined || value === "") return undefined;
  const result = Number(value);
  return Number.isFinite(result) && result >= min && result <= max ? result : undefined;
}

export function imagePreset(image) {
  if (
    !image ||
    !Number.isSafeInteger(image.id) ||
    image.id < 1 ||
    (image.type && !["image", "video"].includes(image.type))
  )
    throw new Error("Choose an image or video on Civitai.");
  const metadata = image.meta && typeof image.meta === "object" ? image.meta : {};
  const meta = Object.hasOwn(metadata, "meta")
    ? metadata.meta && typeof metadata.meta === "object"
      ? metadata.meta
      : {}
    : metadata;
  const warnings = [];
  const settings = {};
  for (const [key, raw, min, max] of [
    ["cfg", meta.cfgScale ?? meta["CFG scale"], 0, 100],
    ["height", String(meta.Size || "").split("x")[1] ?? image.height, 64, 16384],
    ["steps", meta.steps ?? meta.Steps, 1, 10000],
    ["width", String(meta.Size || "").split("x")[0] || image.width, 64, 16384],
  ]) {
    const value = number(raw, min, max);
    if (value !== undefined) settings[key] = value;
  }
  const seed = meta.seed ?? meta.Seed;
  if (image.type === "video") {
    for (const [key, raw, min, max] of [
      ["fps", meta.fps ?? meta.frameRate, 1, 240],
      ["frames", meta.frames ?? meta.frameCount, 1, 100000],
    ]) {
      const value = number(raw, min, max);
      if (value !== undefined) settings[key] = value;
    }
  }
  if (
    /^\d{1,20}$/.test(String(seed ?? "")) &&
    (typeof seed !== "number" || Number.isSafeInteger(seed))
  )
    settings.seed = String(seed);
  else if (seed !== undefined)
    warnings.push("The source seed could not be read exactly; a random seed will be used.");
  const rawSampler = String(meta.sampler || meta.Sampler || "");
  const sampler = rawSampler.replace(/ (Karras|Exponential)$/i, "");
  if (Object.hasOwn(samplers, sampler)) settings.sampler = samplers[sampler];
  else if (sampler) warnings.push(`Sampler “${sampler}” needs a manual choice.`);
  const schedule = String(
    meta["Schedule type"] ||
      meta.scheduler ||
      rawSampler.match(/ (Karras|Exponential)$/i)?.[1] ||
      "",
  );
  const scheduler = Object.entries(schedules).find(
    ([name]) => name.toLowerCase() === schedule.toLowerCase(),
  )?.[1];
  if (scheduler) settings.scheduler = scheduler;
  else if (schedule) warnings.push(`Schedule “${schedule}” needs a manual choice.`);
  if (!Object.keys(meta).length)
    warnings.push(
      "This image has no generation metadata. You can save its source, but its settings cannot be recovered.",
    );
  const resources = (Array.isArray(meta.civitaiResources) ? meta.civitaiResources : [])
    .filter((item) => Number.isSafeInteger(item?.modelVersionId) && item.modelVersionId > 0)
    .map((item) => ({
      versionId: item.modelVersionId,
      weight: number(item.weight, -100, 100) ?? null,
    }));
  for (const item of Array.isArray(meta.resources) ? meta.resources : []) {
    const versionId = Number(item?.modelVersionId);
    if (
      Number.isSafeInteger(versionId) &&
      versionId > 0 &&
      !resources.some((entry) => entry.versionId === versionId)
    )
      resources.push({ versionId, weight: number(item.weight, -100, 100) ?? null });
    else if (/^[a-f0-9]{8,64}$/i.test(item?.hash || ""))
      resources.push({ hash: item.hash, weight: number(item.weight, -100, 100) ?? null });
  }
  // Some upload tools retain only the flattened version IDs.
  for (const versionId of Array.isArray(image.modelVersionIds) ? image.modelVersionIds : []) {
    if (
      Number.isSafeInteger(versionId) &&
      versionId > 0 &&
      !resources.some((item) => item.versionId === versionId)
    )
      resources.push({ versionId, weight: null });
  }
  if (resources.length > 24) throw new Error("This image references too many resources to import.");
  if (!resources.length)
    warnings.push(
      "No exact model versions were supplied. Choose a model before using this preset.",
    );
  if (meta.clipSkip && Number(meta.clipSkip) !== 1)
    warnings.push(`CLIP skip ${meta.clipSkip} needs a matching workflow.`);
  if (!resources.length) {
    const named = [
      ...(Array.isArray(meta.models) ? meta.models : meta.Model ? [meta.Model] : []).map(
        (name) => ({ name, type: "Checkpoint" }),
      ),
      ...(Array.isArray(meta.vaes) ? meta.vaes : []).map((name) => ({ name, type: "VAE" })),
      ...(Array.isArray(meta.additionalResources) ? meta.additionalResources : []),
      ...String(meta.prompt || "").matchAll(/<lora:([^:>]+):([^>]+)>/gi),
    ];
    for (const item of named) {
      const rawName = Array.isArray(item) ? item[1] : item?.name;
      if (typeof rawName !== "string" || !rawName.trim()) continue;
      const file = path.basename(path.win32.basename(rawName.trim()));
      const rawType = Array.isArray(item) ? "lora" : String(item.type || "").toLowerCase();
      const type = ["lora", "locon"].includes(rawType)
        ? "LORA"
        : rawType === "vae"
          ? "VAE"
          : rawType === "checkpoint" || rawType === "model"
            ? "Checkpoint"
            : "Unknown";
      const folder = folders[type] || "";
      if (
        !folder ||
        resources.some((resource) => resource.folder === folder && resource.file === file)
      )
        continue;
      resources.push({
        versionId: `name:${folder}:${file}`,
        file,
        folder,
        name: file,
        nameOnly: true,
        supported: false,
        type,
        weight:
          type === "LORA"
            ? (number(Array.isArray(item) ? item[2] : (item.strength ?? item.weight), -100, 100) ??
              null)
            : null,
        note: "No exact source version or checksum was supplied. Match a local filename or supply a model link to download it.",
      });
    }
    if (resources.length)
      warnings.push(
        "Some source files are identified only by name. Filename matches do not verify the exact version.",
      );
  }
  if (resources.length > 24) throw new Error("This image references too many resources to import.");
  if (Object.keys(meta).some((key) => /hires|controlnet|adetailer|denois/i.test(key)))
    warnings.push(
      "Additional processing was recorded. Its workflow is not included in this preset.",
    );
  const originalPrompt = String(meta.prompt || "").slice(0, 50000);
  if (/<lora:/i.test(originalPrompt) && !resources.length)
    warnings.push("LoRA tags were found without exact resource versions; resolve them manually.");
  let previewUrl = "";
  try {
    previewUrl = civitaiAssetUrl(image.url).href;
  } catch {
    /* No preview is still an importable preset. */
  }
  if (meta.sampler && !settings.scheduler && !schedule)
    warnings.push(
      "No sampling schedule was recorded; the selected workflow’s default will be used.",
    );
  return {
    id: String(image.id),
    name: `Civitai ${image.id}`,
    sourceUrl: `https://civitai.com/images/${image.id}`,
    type: image.type || "image",
    previewUrl,
    creator: String(image.username || "").slice(0, 100),
    baseModel: String(image.baseModel || "").slice(0, 100),
    prompt: originalPrompt.replace(/<lora:[^>]+>/gi, "").trim(),
    negative: String(meta.negativePrompt || "").slice(0, 50000),
    resources,
    settings,
    sourceMetadata: meta,
    warnings,
  };
}

/** Model files of a version that Studio can download: SafeTensors or GGUF, plain names only. */
export function civitaiModelFiles(version) {
  const fileTypes = [
    "Model",
    ...(version?.model?.type === "Checkpoint" ? ["Diffusion Model"] : []),
    ...(["Diffusion Model", "Text Encoder", "VAE"].includes(version?.model?.type)
      ? [version.model.type]
      : []),
  ];
  return (version?.files || []).filter(
    (file) =>
      fileTypes.includes(file.type) &&
      /\.(safetensors|gguf)$/i.test(file.name || "") &&
      path.basename(file.name) === file.name &&
      !file.name.includes("\\") &&
      !/[\x00-\x1f]/.test(file.name),
  );
}

/** The folder a version's file goes to, or '' when Studio has no loader for its type. */
export function civitaiFolder(version, file) {
  if (file?.type === "Diffusion Model") return "diffusion_models";
  return Object.hasOwn(folders, version?.model?.type) ? folders[version.model.type] : "";
}

/** One file of a version as a download spec, or null when it has no checksum or isn't free. */
export function civitaiFileSpec(version, file, { now = Date.now() } = {}) {
  const folder = civitaiFolder(version, file);
  const sha256 = /^[a-f0-9]{64}$/i.test(file?.hashes?.SHA256 || "")
    ? file.hashes.SHA256.toLowerCase()
    : "";
  if (!folder || !file || !sha256 || !civitaiAvailability(version, file, { now }).available)
    return null;
  return {
    id: `civitai:${version.id}:${file.id}`,
    file: file.name,
    folder,
    label: String(version.model?.name || file.name).slice(0, 200),
    // Construct the endpoint from IDs rather than trusting a URL from metadata.
    url: `https://civitai.com/api/download/models/${version.id}?type=${encodeURIComponent(file.type)}&format=${/\.gguf$/i.test(file.name) ? "GGUF" : "SafeTensor"}${file.metadata?.fp ? `&fp=${encodeURIComponent(file.metadata.fp)}` : ""}${file.metadata?.size ? `&size=${encodeURIComponent(file.metadata.size)}` : ""}`,
    baseModel: String(version.baseModel || "").slice(0, 100),
    sourceUrl: `https://civitai.com/models/${version.modelId}?modelVersionId=${version.id}`,
    trainedWords: (Array.isArray(version.trainedWords) ? version.trainedWords : [])
      .map(String)
      .slice(0, 30),
    version: String(version.name || "").slice(0, 200),
    sha256,
    bytes: Number(file.sizeKB || 0) * 1024,
  };
}

/** A version's primary file as a resource. Paid, early-access and restricted files get no download spec. */
export function versionResource(version, weight = 1, { now = Date.now() } = {}) {
  if (!Number.isSafeInteger(version?.id) || version.id < 1)
    throw new Error("Civitai did not return a model version.");
  const files = civitaiModelFiles(version);
  const file = files.find((item) => item.primary) || files[0];
  const folder = file ? civitaiFolder(version, file) : civitaiFolder(version, null);
  const sha256 = /^[a-f0-9]{64}$/i.test(file?.hashes?.SHA256 || "")
    ? file.hashes.SHA256.toLowerCase()
    : "";
  const access = file ? civitaiAvailability(version, file, { now }) : { available: true };
  const spec = file ? civitaiFileSpec(version, file, { now }) : null;
  return {
    versionId: version.id,
    weight,
    name: String(version.model?.name || version.name || version.id).slice(0, 200),
    version: String(version.name || "").slice(0, 200),
    type: String(version.model?.type || "Unknown"),
    baseModel: String(version.baseModel || ""),
    sourceUrl: `https://civitai.com/models/${version.modelId}?modelVersionId=${version.id}`,
    file: file?.name || "",
    folder,
    sha256,
    bytes: spec?.bytes || Number(file?.sizeKB || 0) * 1024,
    supported: Boolean(spec),
    spec,
    note: !folder
      ? "This resource type needs a separate workflow."
      : !access.available
        ? access.note
        : !spec
          ? "No supported file with a published SHA-256 is available."
          : "",
    ...(folder && !access.available
      ? { unavailable: { reason: access.reason, note: access.note } }
      : {}),
    trainedWords: (Array.isArray(version.trainedWords) ? version.trainedWords : [])
      .map(String)
      .slice(0, 30),
  };
}

export async function importCivitaiImage(
  value,
  {
    generation = civitaiGenerationData,
    json = civitaiJson,
    resolveSource = async (url, folder) =>
      (await import("./library-downloads.js")).resolveModelLink(url, folder),
  } = {},
) {
  const { id } = civitaiLink(value);
  const response = await json(`images?imageId=${id}&withMeta=true&nsfw=true`);
  const image = response.items?.find((item) => item.id === id);
  if (!image) throw new Error("That image is unavailable. Check its link and your Civitai token.");
  const preset = imagePreset(image);
  const resources = [];
  const sourceFiles = workflowModelSources(preset.sourceMetadata);
  for (const source of sourceFiles) {
    try {
      const spec = await resolveSource(source.url, source.folder);
      if (
        spec.file !== source.file ||
        spec.folder !== source.folder ||
        !/^[a-f0-9]{64}$/i.test(spec.sha256 || "")
      )
        throw new Error("The source file identity could not be verified.");
      resources.push({
        versionId: spec.id,
        file: spec.file,
        folder: spec.folder,
        sha256: spec.sha256,
        bytes: spec.bytes,
        name: spec.file,
        type: Object.keys(folders).find((type) => folders[type] === spec.folder) || "Unknown",
        baseModel: preset.baseModel,
        sourceUrl: spec.url,
        supported: true,
        weight: null,
        spec,
      });
    } catch {
      preset.warnings.push(
        `The recorded ${source.file} source could not be verified. Supply its model link or retry later.`,
      );
    }
  }
  let associations = preset.resources.filter((resource) => !resource.nameOnly);
  if (!associations.length) {
    try {
      const data = await generation(id);
      associations = (Array.isArray(data?.resources) ? data.resources : [])
        .filter(
          (resource) =>
            Number.isSafeInteger(resource.modelVersionId) && resource.modelVersionId > 0,
        )
        .map((resource) => ({
          versionId: resource.modelVersionId,
          weight: number(resource.strength, -100, 100) ?? null,
        }));
      if (associations.length > 24)
        throw new Error("This image references too many resources to import.");
    } catch {
      preset.warnings.push(
        "The source page’s exact model associations could not be recovered. Filename-only entries need review.",
      );
    }
  }
  // Keep provider requests bounded and avoid bursting a large LoRA stack.
  for (const item of associations.slice(0, 24)) {
    try {
      const version = await json(
        item.hash ? `model-versions/by-hash/${item.hash}` : `model-versions/${item.versionId}`,
      );
      const resource = versionResource(version, item.weight);
      const named = preset.resources.find(
        (entry) =>
          entry.nameOnly &&
          entry.folder === resource.folder &&
          sameResourceFilename(entry.file, resource.file),
      );
      if (resource.weight === null && named) resource.weight = named.weight;
      // The workflow records the actual variant; a model-version primary may be a different precision.
      const recordedModels = resources.filter((entry) =>
        ["checkpoints", "diffusion_models"].includes(entry.folder),
      );
      if (["checkpoints", "diffusion_models"].includes(resource.folder) && recordedModels.length) {
        if (
          version.files?.some((file) =>
            recordedModels.some((entry) => entry.sha256 === file.hashes?.SHA256?.toLowerCase()),
          )
        )
          continue;
        resource.supported = false;
        resource.spec = null;
        resource.note =
          "The linked model version does not match the recorded workflow weights. Review this association before downloading.";
      }
      if (!resources.some((entry) => entry.versionId === resource.versionId))
        resources.push(resource);
    } catch {
      resources.push({
        ...item,
        versionId: item.versionId || `hash:${item.hash}`,
        name: item.versionId ? `Version ${item.versionId}` : "Unresolved Resource",
        type: "Unknown",
        supported: false,
        note: "This resource is unavailable or requires access.",
      });
    }
  }
  for (const named of preset.resources.filter((resource) => resource.nameOnly)) {
    const covered = resources.some(
      (resource) =>
        (resource.folder === named.folder ||
          (named.folder === "checkpoints" && resource.folder === "diffusion_models")) &&
        sameResourceFilename(named.file, resource.file),
    );
    if (!covered) resources.push(named);
  }
  if (resources.some((resource) => resource.supported))
    preset.warnings = preset.warnings.filter(
      (warning) => !warning.startsWith("No exact model versions were supplied."),
    );
  if (!resources.some((resource) => resource.nameOnly))
    preset.warnings = preset.warnings.filter(
      (warning) => !warning.startsWith("Some source files are identified only by name."),
    );
  if (resources.length > 24) throw new Error("This image references too many resources to import.");
  return { ...preset, resources };
}

/*
 * Model checksums. Hashing a checkpoint means reading every byte of a file that
 * can run to tens of gigabytes on network storage, so a hash is worked out once
 * per file version (path, size and modified time) and, once the Library names a
 * file for it (useModelHashCache), kept on disk across restarts.
 */
let hashCacheFile = "";
let savedHashes = new Map();
let saveTimer = null;
const hashKey = (file, stat) => `${file}|${stat.size}|${stat.mtimeMs}`;

/** Keeps worked-out model checksums in `file`, so a restart doesn't read every model again. */
export function useModelHashCache(file) {
  hashCacheFile = file;
  try {
    const saved = readJsonFile(file);
    savedHashes = new Map(
      Object.entries(
        saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {},
      ).filter(([, value]) => /^[a-f0-9]{64}$/.test(String(value))),
    );
  } catch {
    savedHashes = new Map();
  }
}

function rememberHash(key, hex) {
  savedHashes.set(key, hex);
  while (savedHashes.size > 2000) savedHashes.delete(savedHashes.keys().next().value);
  if (!hashCacheFile || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      writeJsonFile(hashCacheFile, Object.fromEntries(savedHashes), { compact: true });
    } catch {
      /* A lost cache only costs a rehash. */
    }
  }, 500);
  saveTimer.unref?.();
}

/** A checksum already worked out for this exact file version, or '' without reading the file. */
async function knownHash(file) {
  const key = hashKey(file, await fs.promises.stat(file));
  if (savedHashes.has(key)) return savedHashes.get(key);
  const pending = hashes.get(key);
  return pending ? await pending.catch(() => "") : "";
}

/** Only candidate files are hashed; cached hashes are invalidated when the file changes. */
async function hashFile(file) {
  const stat = await fs.promises.stat(file);
  const key = hashKey(file, stat);
  if (savedHashes.has(key)) return savedHashes.get(key);
  if (!hashes.has(key)) {
    const promise = (async () => {
      const hash = crypto.createHash("sha256");
      for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
      const hex = hash.digest("hex");
      rememberHash(key, hex);
      return hex;
    })();
    hashes.set(key, promise);
    promise.catch(() => hashes.delete(key));
    if (hashes.size > 512) hashes.delete(hashes.keys().next().value);
  }
  return hashes.get(key);
}

/** A local model file's SHA-256: worked out in full with `verify`, else only one already known ('' if none). */
export async function modelChecksum(file, { verify = false } = {}) {
  return verify ? hashFile(file) : knownHash(file);
}

/**
 * Finds each resource's file among the installed models. `verify: false` (the
 * Library's list) never reads a model: a known checksum decides, otherwise the
 * same file name and size count as installed (marked `unverified`); opening one
 * image checks its checksums in full.
 */
export async function matchResources(
  preset,
  { profiles = [], loras = [], textEncoders = [], vaes = [] } = {},
  { foldersFor = modelFolders, verify = true } = {},
) {
  const workerUrl = comfyUrl;
  const remote = remoteModelsEnabled() ? await refreshWorkerModels({ workerUrl }) : null;
  const resources = [];
  for (const resource of preset.resources) {
    let localName = "";
    let profileId = "";
    let conflict = false;
    let unverified = false;
    const candidates =
      resource.folder === "loras"
        ? loras
        : resource.folder === "vae"
          ? vaes
          : resource.folder === "text_encoders"
            ? textEncoders
            : profiles
                .filter((item) => item.kind === (preset.type || "image"))
                .flatMap((item) => [item.defaults?.model, item.model, item.baseModel])
                .filter(Boolean);
    for (const name of [...new Set(candidates)]) {
      if (typeof name !== "string" || path.isAbsolute(name) || name.split(/[\\/]/).includes(".."))
        continue;
      if (remote) {
        const folders = ["checkpoints", "diffusion_models"].includes(resource.folder)
          ? ["checkpoints", "diffusion_models"]
          : [resource.folder];
        for (const folder of folders) {
          const file = remote.files.find((item) => item.path === `${folder}/${name}`);
          if (!file) continue;
          const sameName = resource.nameOnly
            ? sameResourceFilename(name, resource.file)
            : path.basename(name) === resource.file;
          const sameSize = Boolean(resource.bytes) && Math.abs(file.size - resource.bytes) <= 2048;
          if (!sameName && !sameSize) continue;
          if (resource.nameOnly && sameName) {
            localName = name;
            break;
          }
          if (resource.sha256) {
            const hash = verify
              ? (await workerModelFile({ folder, file: name, workerUrl }, "hash")).sha256
              : "";
            if (hash === resource.sha256) {
              localName = name;
              break;
            }
            if (!hash && sameName && sameSize) {
              localName = name;
              unverified = true;
              break;
            }
          }
          if (sameName) conflict = true;
        }
        if (localName) break;
        continue;
      }
      const modelDirs = ["checkpoints", "diffusion_models"].includes(resource.folder)
        ? [
            ...foldersFor("checkpoints", ["checkpoints"]),
            ...foldersFor("diffusion_models", ["diffusion_models", "unet"]),
          ]
        : resource.folder
          ? foldersFor(resource.folder, [resource.folder])
          : [];
      for (const dir of modelDirs) {
        const file = path.join(dir, name);
        try {
          const stat = await fs.promises.stat(file);
          const sameName = resource.nameOnly
            ? sameResourceFilename(name, resource.file)
            : path.basename(name) === resource.file;
          const sameSize = Boolean(resource.bytes) && Math.abs(stat.size - resource.bytes) <= 2048;
          // Civitai rounds sizeKB; use a small tolerance to find renamed files.
          if (!stat.isFile() || (!sameName && !sameSize)) continue;
          if (resource.nameOnly && sameName) {
            localName = name;
            break;
          }
          if (resource.sha256) {
            const hash = verify ? await hashFile(file) : await knownHash(file);
            if (hash === resource.sha256) {
              localName = name;
              unverified = false;
              break;
            }
            if (!hash && sameName && sameSize) {
              localName = name;
              unverified = true;
              break;
            }
          }
          if (sameName) conflict = true;
        } catch {
          /* Try another configured model folder. */
        }
      }
      if (localName) break;
    }
    if (localName) conflict = false;
    if (localName && ["checkpoints", "diffusion_models"].includes(resource.folder))
      profileId =
        profiles.find(
          (item) =>
            item.kind === (preset.type || "image") &&
            [item.defaults?.model, item.model, item.baseModel].includes(localName),
        )?.id || "";
    const { spec, ...publicResource } = resource;
    resources.push({
      ...publicResource,
      conflict,
      localName,
      profileId,
      ...(unverified ? { unverified: true } : {}),
      ...(resource.nameOnly && localName
        ? { note: "Matched by filename only; the exact version is unverified." }
        : {}),
      status: localName
        ? "installed"
        : conflict
          ? "conflict"
          : resource.supported
            ? "missing"
            : "unsupported",
    });
  }
  return { ...preset, resources };
}
