// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Version offers (design §4, Version Offers): other versions and variants of an imported model
 * that match it. From Civitai, the model's newer and older versions and the chosen version's
 * other files (FP8, FP16, GGUF); from Hugging Face, sibling files of the same model in another
 * precision or format. Each is filtered by family and by what the worker can run, and is an
 * offer only: nothing is queued until someone chooses it.
 *
 * Paid, early-access and restricted files stay listed but refused, with the nearest free offer
 * suggested instead.
 */
import path from "node:path";
import { civitaiFileSpec, civitaiFolder, civitaiModelFiles } from "./civitai-import.js";
import { civitaiAvailability } from "./library-availability.js";
import { nameParts } from "./library-substitutes.js";

const offerLimit = 12;

/** A file's format and precision in words: "GGUF Q4_K_M", "FP8", "BF16". */
export function variantWords(file = "", metadata = {}) {
  const parts = nameParts(file);
  const precision = String(metadata.fp || parts.precision || "")
    .toUpperCase()
    .replace(/^FP8_E4M3FN$/, "FP8")
    .replace(/^FP8_E5M2$/, "FP8 E5M2");
  const pruned = metadata.size === "pruned" ? "Pruned" : "";
  return (
    [/\.gguf$/i.test(file) ? "GGUF" : "", precision, pruned].filter(Boolean).join(" ") ||
    (/\.gguf$/i.test(file) ? "GGUF" : "SafeTensors")
  );
}

/**
 * Whether the worker can run this file: GGUF needs the GGUF loader nodes, and only diffusion
 * models and text encoders come as GGUF. `{fits, note}`.
 */
export function fileFits(file = "", folder = "", { gguf = false } = {}) {
  if (!/\.gguf$/i.test(file))
    return {
      fits: /\.safetensors$/i.test(file),
      note: /\.safetensors$/i.test(file) ? "" : "Not a SafeTensors or GGUF file",
    };
  if (!["diffusion_models", "text_encoders", "unet", "clip"].includes(folder))
    return { fits: false, note: "GGUF works only for diffusion models and text encoders" };
  return gguf ? { fits: true, note: "" } : { fits: false, note: "The worker has no GGUF loader" };
}

const shareFamily = (a = [], b = []) =>
  !a.length || !b.length || a.some((family) => b.includes(family));

/**
 * Offers from a Civitai model for the chosen version.
 *   model             the /models/:id answer (modelVersions newest first)
 *   version           the chosen version (with files and model)
 *   familiesOf(base)  family ids for a Civitai baseModel ("Flux.1 D" → ["flux1"])
 *   gguf              whether the worker has the GGUF loader
 * Each offer: {key, source, label, relation: newer|older|precision|format, fits, note, file, folder,
 * bytes, baseModel, variant, url, unavailable?: {reason, note, freeAlternative?}} plus `spec`
 * (kept on the server) when it can be downloaded.
 */
export function civitaiOffers({
  model = {},
  version = {},
  familiesOf = () => [],
  gguf = false,
  now = Date.now(),
  limit = offerLimit,
} = {}) {
  const versions = Array.isArray(model.modelVersions) ? model.modelVersions : [];
  const at = versions.findIndex((item) => item.id === version.id);
  const wanted = familiesOf(version.baseModel || "");
  const shell = { name: model.name, type: model.type, mode: model.mode, nsfw: model.nsfw };
  const chosenFile = (() => {
    const files = civitaiModelFiles({ ...version, model: { ...shell, ...(version.model || {}) } });
    return files.find((item) => item.primary) || files[0];
  })();
  const offers = [];
  const offer = (candidate, file, relation) => {
    const full = {
      ...candidate,
      modelId: model.id ?? version.modelId,
      model: { ...shell, ...(candidate.model || {}) },
    };
    const folder = civitaiFolder(full, file);
    if (!folder) return;
    const fit = fileFits(file.name, folder, { gguf });
    if (!fit.fits) return;
    const access = civitaiAvailability(full, file, { now });
    const spec = civitaiFileSpec(full, file, { now });
    const url = `https://civitai.com/models/${full.modelId}?modelVersionId=${candidate.id}`;
    offers.push({
      key: `civitai:${candidate.id}:${file.id}`,
      source: {
        provider: "civitai",
        modelId: full.modelId,
        versionId: candidate.id,
        fileId: file.id,
        url,
      },
      label: String(candidate.name || candidate.id),
      relation,
      fits: true,
      note: fit.note,
      file: file.name,
      folder,
      bytes: Number(file.sizeKB || 0) * 1024,
      baseModel: String(candidate.baseModel || ""),
      variant: variantWords(file.name, file.metadata || {}),
      url,
      ...(access.available ? {} : { unavailable: { reason: access.reason, note: access.note } }),
      ...(access.available && !spec
        ? {
            unavailable: {
              reason: "no-checksum",
              note: "Civitai publishes no SHA-256 for this file.",
            },
          }
        : {}),
      ...(spec ? { spec } : {}),
    });
  };
  // Other files of the chosen version: another precision or format.
  for (const file of civitaiModelFiles({
    ...version,
    model: { ...shell, ...(version.model || {}) },
  })) {
    if (file === chosenFile || file.id === chosenFile?.id) continue;
    offer(
      version,
      file,
      /\.gguf$/i.test(file.name) !== /\.gguf$/i.test(chosenFile?.name || "")
        ? "format"
        : "precision",
    );
  }
  // Other versions of the same family: their primary file.
  versions.forEach((candidate, index) => {
    if (candidate.id === version.id || !shareFamily(wanted, familiesOf(candidate.baseModel || "")))
      return;
    if (
      !wanted.length &&
      candidate.baseModel &&
      version.baseModel &&
      candidate.baseModel !== version.baseModel
    )
      return;
    const files = civitaiModelFiles({ ...candidate, model: shell });
    const file = files.find((item) => item.primary) || files[0];
    if (file) offer(candidate, file, at >= 0 && index > at ? "older" : "newer");
  });
  // A refused file suggests the nearest free one of the same kind (another newer version for a newer one).
  for (const item of offers.filter(
    (entry) => entry.unavailable && ["paid", "early-access"].includes(entry.unavailable.reason),
  )) {
    const free = offers.find((entry) => !entry.unavailable && entry.relation === item.relation);
    if (free)
      item.unavailable.freeAlternative = {
        versionId: free.source.versionId,
        name: free.label,
        url: free.url,
        key: free.key,
      };
  }
  return offers.slice(0, limit);
}

/**
 * Offers from a Hugging Face repository for one file: the same model's other files in another
 * precision or format (`siblings`: [{rfilename, lfs: {sha256, size}}]).
 */
export function hfOffers({
  siblings = [],
  chosenPath = "",
  repo = "",
  revision = "",
  folder = "",
  gguf = false,
  limit = offerLimit,
} = {}) {
  const chosen = nameParts(path.posix.basename(chosenPath));
  if (!chosen.model) return [];
  const offers = [];
  for (const item of siblings) {
    const filePath = String(item?.rfilename || "");
    if (!filePath || filePath === chosenPath || !/\.(safetensors|gguf)$/i.test(filePath)) continue;
    const file = path.posix.basename(filePath);
    const parts = nameParts(file);
    if (parts.model !== chosen.model) continue;
    const fit = fileFits(file, folder, { gguf });
    if (!fit.fits) continue;
    const sha256 = /^[a-f0-9]{64}$/i.test(item.lfs?.sha256 || "")
      ? item.lfs.sha256.toLowerCase()
      : "";
    const bytes = Number(item.lfs?.size || item.size || 0);
    const url = `https://huggingface.co/${repo}/blob/${revision}/${filePath}`;
    const spec = sha256
      ? {
          id: `hf:${repo}:${revision}:${filePath}`,
          file,
          folder,
          label: file,
          url: `https://huggingface.co/${repo}/resolve/${revision}/${filePath.split("/").map(encodeURIComponent).join("/")}`,
          sha256,
          bytes,
          sourceUrl: url,
        }
      : null;
    offers.push({
      key: `hf:${repo}:${filePath}`,
      source: { provider: "hf", repo, revision, path: filePath, url },
      label: file,
      relation: parts.gguf !== chosen.gguf ? "format" : "precision",
      fits: true,
      note: fit.note,
      file,
      folder,
      bytes,
      baseModel: "",
      variant: variantWords(file),
      url,
      ...(spec
        ? { spec }
        : {
            unavailable: {
              reason: "no-checksum",
              note: "Hugging Face publishes no SHA-256 for this file.",
            },
          }),
    });
  }
  return offers.sort((a, b) => a.bytes - b.bytes).slice(0, limit);
}

/** Offers as the browser sees them: no download specs. */
export const publicOffers = (offers = []) =>
  offers.map(({ spec, ...offer }) => ({ ...offer, downloadable: Boolean(spec) }));
