// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read-only Library answers for MCP's admin tools (mcp-admin.js), behind the Library's routes:
 *
 *   lookup     a Civitai model or Hugging Face link, or a Civitai search: its versions and files with
 *              availability, licence and whether a profile here fits, without importing or writing
 *   placement  where model files live: the worker's inventory, free space and whether it is
 *              writable, or the local folders; for one catalogue key, where that file sits
 *
 * Nothing here downloads, writes or deletes. Dependencies are injected so tests run offline.
 */
import fs from "node:fs";
import path from "node:path";
import { civitaiLink } from "./civitai-import.js";
import {
  civitaiAvailability,
  civitaiLinks,
  civitaiNsfw,
  detectLink,
  resolveCivitaiModel,
  resolveHuggingFace,
} from "./library-sources.js";
import { catalogueKinds, splitCatalogueKey } from "./library-catalogue.js";

const maxSearchResults = 5;
const maxVersions = 12;

/** Civitai's licence fields as one small record (unknown stays null). */
export function civitaiLicence(model = {}) {
  const commercial = model.allowCommercialUse;
  const uses = Array.isArray(commercial)
    ? commercial.map(String)
    : typeof commercial === "string"
      ? [commercial]
      : [];
  return {
    commercial: uses.length ? uses.some((use) => use !== "None") : null,
    ...(uses.length ? { commercialUses: uses } : {}),
    creditRequired: typeof model.allowNoCredit === "boolean" ? !model.allowNoCredit : null,
    derivatives: typeof model.allowDerivatives === "boolean" ? model.allowDerivatives : null,
  };
}

/** A resolved file as a lookup lists it: where it goes, whether it is here and whether it may download. */
async function lookupFile(resource, inspect) {
  const found = await inspect(resource.want, {}).catch(() => ({ status: "missing" }));
  return {
    name: resource.want.file || resource.name,
    folder: resource.want.folder,
    role: resource.role,
    version: resource.version || "",
    ...(resource.want.bytes ? { bytes: resource.want.bytes } : {}),
    ...(resource.want.sha256 ? { sha256: resource.want.sha256 } : {}),
    status:
      found.status === "installed"
        ? "installed"
        : found.status === "conflict"
          ? "conflict"
          : "missing",
    downloadable: Boolean(resource.spec) && !resource.unavailable,
    ...(resource.unavailable ? { unavailable: resource.unavailable } : {}),
    ...(resource.folderGuessed ? { folderGuessed: true } : {}),
    ...(resource.note ? { note: resource.note } : {}),
  };
}

/** Profiles here whose family the base model names. */
const fitting = (families, profiles) =>
  profiles
    .filter((profile) => profile.family && families.includes(profile.family))
    .map((profile) => profile.id)
    .slice(0, 8);

/**
 * Looks up a link or a search without importing it.
 *   json(path)              Civitai REST (civitai-access.js civitaiJson)
 *   hfRequest(url, init)    Hugging Face (hf-access.js hfFetch)
 *   inspect(want)           whether a file is installed (library-routes.js inspectInstalled)
 *   families(baseModel)     families a base model names (lora-info.js familiesFromMetadata)
 *   profiles()              ready profiles [{id, family}]
 */
export async function lookupLibrary(
  { url = "", query = "" } = {},
  { json, hfRequest, inspect, families = () => [], profiles = async () => [] },
) {
  const ready = await profiles().catch(() => []);
  const fit = (baseModel) => {
    const named = baseModel ? families(baseModel) : [];
    return { families: named, profiles: fitting(named, ready) };
  };
  if (!url) {
    const words = String(query || "")
      .trim()
      .slice(0, 120);
    if (!words) throw new Error("Pass a Civitai or Hugging Face link, or a query.");
    const found = await json(`models?limit=${maxSearchResults}&query=${encodeURIComponent(words)}`);
    const models = (Array.isArray(found?.items) ? found.items : []).slice(0, maxSearchResults);
    return {
      query: words,
      results: models.map((model) => ({
        provider: "civitai",
        modelId: model.id,
        title: String(model.name || model.id),
        type: String(model.type || ""),
        nsfw: civitaiNsfw(model),
        licence: civitaiLicence(model),
        links: civitaiLinks(model.id),
        versions: (Array.isArray(model.modelVersions) ? model.modelVersions : [])
          .slice(0, 4)
          .map((version) => {
            const availability = civitaiAvailability({ ...version, model });
            return {
              versionId: version.id,
              name: String(version.name || version.id),
              baseModel: String(version.baseModel || ""),
              available: availability.available,
              ...(availability.available
                ? {}
                : { reason: availability.reason, note: availability.note }),
              ...fit(String(version.baseModel || "")),
            };
          }),
      })),
    };
  }
  const kind = detectLink(url);
  if (kind === "civitai-image")
    throw new Error("That is a Civitai image: Import it to read its settings and files.");
  if (kind === "civitai-model") {
    // One fetch of the model serves both its version list and the chosen version's files.
    const cache = new Map();
    const cached = (pathname) => {
      if (!cache.has(pathname)) cache.set(pathname, json(pathname));
      return cache.get(pathname);
    };
    const { id } = civitaiLink(url, "models");
    const [model, resolved] = await Promise.all([
      cached(`models/${id}`),
      resolveCivitaiModel(url, { json: cached }),
    ]);
    const chosen = resolved.resources[0]?.want?.source?.versionId;
    return {
      provider: "civitai",
      modelId: id,
      title: resolved.title,
      type: resolved.type,
      baseModel: resolved.baseModel,
      nsfw: resolved.nsfw,
      links: resolved.links,
      licence: civitaiLicence(model),
      ...fit(resolved.baseModel),
      versions: (Array.isArray(model?.modelVersions) ? model.modelVersions : [])
        .slice(0, maxVersions)
        .map((version) => {
          const availability = civitaiAvailability({ ...version, model });
          return {
            versionId: version.id,
            name: String(version.name || version.id),
            baseModel: String(version.baseModel || ""),
            current: version.id === chosen,
            available: availability.available,
            ...(availability.available
              ? {}
              : { reason: availability.reason, note: availability.note }),
          };
        }),
      files: await Promise.all(resolved.resources.map((resource) => lookupFile(resource, inspect))),
    };
  }
  const resolved = await resolveHuggingFace(url, { request: hfRequest });
  return {
    provider: "hf",
    title: resolved.title,
    version: resolved.version,
    type: resolved.type,
    baseModel: resolved.baseModel,
    nsfw: resolved.nsfw,
    links: resolved.links,
    gated: resolved.gated,
    ...fit(resolved.baseModel),
    files: await Promise.all(resolved.resources.map((resource) => lookupFile(resource, inspect))),
  };
}

const workerFolders = {
  diffusion_models: ["diffusion_models", "unet"],
  text_encoders: ["text_encoders", "clip"],
};

/**
 * Where model files live. `remote` says whether a worker holds the library; `inventory()` is its
 * cached inventory (worker-models.js workerInventory) and `foldersFor(folder, names)` the local
 * folders (comfy.js modelFolders). With `key` (folder/file), where that one file sits.
 */
export function libraryPlacement({ key = "" } = {}, { remote, inventory, foldersFor }) {
  const target = key ? splitCatalogueKey(key) : null;
  if (
    target &&
    (!Object.hasOwn(catalogueKinds, target.folder) ||
      !target.file ||
      target.file.split("/").some((part) => !part || part === ".."))
  )
    throw new Error("A key is folder/file in a model folder, such as loras/glow.safetensors.");
  const names = target ? workerFolders[target.folder] || [target.folder] : [];
  if (remote) {
    const { files = [], paused = [], space = {}, writable = false } = inventory();
    const file = target
      ? files.find((item) => names.some((folder) => item.path === `${folder}/${target.file}`))
      : null;
    const counts = {};
    for (const item of files) {
      const folder = String(item.path || "").split("/")[0];
      counts[folder] = (counts[folder] || 0) + 1;
    }
    return {
      storage: "worker",
      writable,
      space,
      files: counts,
      paused: paused.length,
      ...(target
        ? {
            file: file
              ? { key, found: true, path: file.path, bytes: file.size || 0 }
              : { key, found: false },
          }
        : {}),
    };
  }
  const folders = Object.keys(catalogueKinds).map((folder) => ({
    folder,
    locations: foldersFor(folder, workerFolders[folder] || [folder]).length,
  }));
  if (!target) return { storage: "local", folders };
  for (const [index, dir] of foldersFor(target.folder, names).entries()) {
    let stat;
    try {
      stat = fs.statSync(path.join(dir, target.file));
    } catch {
      continue;
    }
    if (stat.isFile())
      return {
        storage: "local",
        folders,
        file: {
          key,
          found: true,
          location: index === 0 ? target.folder : `${target.folder} (extra model path ${index})`,
          bytes: stat.size,
        },
      };
  }
  return { storage: "local", folders, file: { key, found: false } };
}
