// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Library link resolvers (design §2.3, Resolve): a Civitai model or version link, or a Hugging
 * Face file or repository link, becomes the files it names, each with its download spec (or why
 * it can't be downloaded) and the metadata a catalogue entry needs.
 */
import path from "node:path";
import { civitaiJson, isCivitaiHost, limitedBody } from "./civitai-access.js";
import { civitaiLink, versionResource } from "./civitai-import.js";
import { catalogueKinds } from "./library-catalogue.js";
import { hfFetch } from "./hf-access.js";
import { civitaiAvailability } from "./library-availability.js";
import { civitaiOffers, hfOffers } from "./library-offers.js";

export { civitaiAvailability };

const modelFolders = new Set(Object.keys(catalogueKinds));
/** Plain text from a Civitai description (HTML), for the catalogue. */
export function plainDescription(html, limit = 10000) {
  if (typeof html !== "string") return "";
  return html
    .replace(/<(br|\/p|\/li|\/h\d)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, limit);
}

/** Civitai's NSFW marker, or true when it says nothing (never assumed safe). */
export function civitaiNsfw(model = {}) {
  if (typeof model?.nsfw === "boolean" && model.nsfw) return true;
  if (Number.isFinite(model?.nsfwLevel)) return (model.nsfwLevel & ~3) !== 0;
  if (typeof model?.nsfw === "boolean") return model.nsfw;
  return true;
}

/** Both Civitai links for one version. */
export function civitaiLinks(modelId, versionId) {
  const query = versionId ? `?modelVersionId=${versionId}` : "";
  return {
    civitaiCom: `https://civitai.com/models/${modelId}${query}`,
    civitaiRed: `https://civitai.red/models/${modelId}${query}`,
  };
}

/** Which kind of link this is, without fetching anything. */
export function detectLink(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Paste a Civitai or Hugging Face link.");
  }
  if (isCivitaiHost(url.hostname)) {
    if (/^\/images\//.test(url.pathname)) return "civitai-image";
    if (/^\/models\//.test(url.pathname)) return "civitai-model";
    throw new Error("Use a Civitai image or model link.");
  }
  if (url.hostname === "huggingface.co" || url.hostname === "www.huggingface.co") {
    const operation = url.pathname.split("/").filter(Boolean)[2];
    return ["blob", "resolve"].includes(operation) ? "hf-file" : "hf-repo";
  }
  throw new Error("Paste a link from civitai.com, civitai.red or huggingface.co.");
}

const roleOf = (folder) => catalogueKinds[folder] || "model";

/**
 * A Civitai model or version link: the version's primary file as one resource, the catalogue
 * patch for a LoRA, a free version to suggest when this one is paid or in early access, and the
 * model's other versions and files that fit (library-offers.js). `familiesOf(baseModel)` gives
 * family ids; `gguf` says whether the worker has the GGUF loader.
 */
export async function resolveCivitaiModel(
  value,
  { json = civitaiJson, now = Date.now(), familiesOf = () => [], gguf = false } = {},
) {
  const { id, versionId } = civitaiLink(value, "models");
  const model = await json(`models/${id}`);
  if (!model || Number(model.id) !== id) throw new Error("That Civitai model is unavailable.");
  const versions = Array.isArray(model.modelVersions) ? model.modelVersions : [];
  const chosenId = versionId || versions[0]?.id;
  if (!chosenId) throw new Error("This model has no available versions.");
  const fetched = await json(`model-versions/${chosenId}`);
  if (Number(fetched?.modelId ?? id) !== id)
    throw new Error("That version belongs to another model. Check the link.");
  const version = {
    ...fetched,
    modelId: id,
    model: {
      ...(fetched?.model || {}),
      name: fetched?.model?.name || model.name,
      type: fetched?.model?.type || model.type,
      mode: model.mode ?? fetched?.model?.mode,
      nsfw: model.nsfw ?? fetched?.model?.nsfw,
    },
  };
  const resource = versionResource(version, null, { now });
  let freeAlternative;
  if (resource.unavailable && ["paid", "early-access"].includes(resource.unavailable.reason)) {
    const free = versions.find(
      (candidate) =>
        candidate.id !== version.id &&
        civitaiAvailability({ ...candidate, model: version.model }, null, { now }).available,
    );
    if (free)
      freeAlternative = {
        versionId: free.id,
        name: String(free.name || free.id),
        url: civitaiLinks(id, free.id).civitaiCom,
      };
  }
  const folder = resource.folder;
  const file = (version.files || []).find((item) => item.name === resource.file);
  const strength =
    version.settings && typeof version.settings === "object"
      ? Number(version.settings.strength)
      : NaN;
  const nsfw = civitaiNsfw(model);
  const entry =
    folder === "loras" && resource.file
      ? {
          title: String(model.name || resource.name).slice(0, 300),
          version: String(version.name || "").slice(0, 200),
          baseModel: String(version.baseModel || "").slice(0, 100),
          triggers: resource.trainedWords,
          ...(Number.isFinite(strength) && strength >= -5 && strength <= 5
            ? { strength: { default: strength } }
            : {}),
          description: [plainDescription(model.description), plainDescription(version.description)]
            .filter(Boolean)
            .join("\n\n"),
          links: civitaiLinks(id, version.id),
          nsfw,
          ...(resource.sha256 ? { sha256: resource.sha256 } : {}),
          ...(resource.bytes ? { bytes: resource.bytes } : {}),
          source: {
            provider: "civitai",
            modelId: id,
            versionId: version.id,
            ...(file?.id ? { fileId: file.id } : {}),
          },
        }
      : null;
  return {
    title: String(model.name || resource.name),
    version: resource.version,
    baseModel: resource.baseModel,
    type: resource.type,
    nsfw,
    links: civitaiLinks(id, version.id),
    // A checkpoint's page, for its drafted profile and guide (profile-drafts.js).
    sourceText:
      folder === "loras"
        ? ""
        : [
            plainDescription(model.description),
            plainDescription(version.description),
            resource.trainedWords?.length
              ? `Trigger words: ${resource.trainedWords.join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n\n")
            .slice(0, 12000),
    offers: civitaiOffers({ model, version, familiesOf, gguf, now }),
    resources: [
      {
        role: roleOf(folder),
        name: String(model.name || resource.name),
        version: resource.version,
        want: {
          file: resource.file,
          folder,
          sha256: resource.sha256,
          bytes: resource.bytes,
          source: {
            provider: "civitai",
            modelId: id,
            versionId: version.id,
            ...(file?.id ? { fileId: file.id } : {}),
            url: civitaiLinks(id, version.id).civitaiCom,
          },
        },
        supported: Boolean(resource.spec),
        spec: resource.spec,
        note: resource.note,
        ...(resource.unavailable
          ? {
              unavailable: {
                ...resource.unavailable,
                ...(freeAlternative ? { freeAlternative } : {}),
              },
            }
          : {}),
      },
    ],
    entry,
  };
}

/** Where a Hugging Face file most likely belongs, and whether that is only a guess. */
export function hfFolder(filePath, { tags = [], card = {} } = {}) {
  const name = filePath.toLowerCase();
  const lora =
    tags.some((tag) => /^lora$|^base_model:adapter:/i.test(String(tag))) ||
    typeof card.instance_prompt === "string";
  if (/(^|[/_.-])loras?([/_.-]|$)/.test(name) || (lora && !/vae|text[_-]?encoder/.test(name)))
    return { folder: "loras", guessed: !/(^|[/_.-])loras?([/_.-]|$)/.test(name) && !lora };
  if (/clip[_-]?vision|siglip/.test(name)) return { folder: "clip_vision", guessed: false };
  if (/(^|[/_.-])vae([/_.-]|$)|^ae\.safetensors$|[/]ae\.safetensors$/.test(name))
    return { folder: "vae", guessed: false };
  if (
    /text[_-]?encoders?|(^|[/_.-])(t5|umt5|t5xxl|clip_[lg]|gemma|qwen[^/]*vl)([/_.-]|$)/.test(name)
  )
    return { folder: "text_encoders", guessed: false };
  if (/(^|[/_.-])(unet|transformer|diffusion[_-]?models?)([/_.-]|$)/.test(name))
    return { folder: "diffusion_models", guessed: false };
  return { folder: "diffusion_models", guessed: true };
}

/** A Hugging Face link split into owner, repo, revision and (for a file) its path. */
export function parseHfLink(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Paste a Hugging Face link.");
  }
  if (
    url.protocol !== "https:" ||
    !["huggingface.co", "www.huggingface.co"].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    [...url.searchParams.keys()].some((key) => key !== "download")
  )
    throw new Error("Use a Hugging Face link without credentials.");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.some((part) => part === "." || part === ".." || /[\\\x00-\x1f]/.test(part)))
    throw new Error("That Hugging Face link has an invalid path.");
  const [owner, repo, operation, revision, ...rest] = parts;
  if (!owner || !repo || ["datasets", "spaces", "api", "docs", "models"].includes(owner))
    throw new Error("Use a Hugging Face model link.");
  if (operation && !["blob", "resolve", "tree"].includes(operation))
    throw new Error("Use a Hugging Face model, folder or file link.");
  if (operation && !revision) throw new Error("That Hugging Face link has no revision.");
  const filePath = ["blob", "resolve"].includes(operation) ? rest.join("/") : "";
  if (["blob", "resolve"].includes(operation) && !filePath)
    throw new Error("Choose a specific Hugging Face model file.");
  return {
    owner,
    repo,
    revision: revision || "main",
    filePath,
    folder: operation === "tree" ? rest.join("/") : "",
  };
}

/**
 * A Hugging Face file link imports that file; a repository (or folder) link lists its SafeTensors
 * and GGUF files, each optional unless there is only one. Gated repositories use the saved token.
 */
export async function resolveHuggingFace(value, { request = hfFetch, gguf = false } = {}) {
  const link = parseHfLink(value);
  const { owner, repo } = link;
  const response = await request(
    `https://huggingface.co/api/models/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/revision/${encodeURIComponent(link.revision)}?blobs=true`,
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      response.status === 401 || response.status === 403
        ? "This repository is gated or private. Accept its terms on Hugging Face and add a token to the deployment."
        : response.status === 404
          ? "That Hugging Face repository or revision doesn’t exist."
          : `Hugging Face metadata is unavailable (HTTP ${response.status}).`,
    );
  }
  const metadata = JSON.parse((await limitedBody(response, 8 * 1024 * 1024)).toString());
  if (!/^[a-f0-9]{40}$/i.test(metadata.sha || ""))
    throw new Error("Hugging Face didn’t return an exact revision.");
  const tags = Array.isArray(metadata.tags) ? metadata.tags.map(String) : [];
  const card = metadata.cardData && typeof metadata.cardData === "object" ? metadata.cardData : {};
  const baseModel = String(
    Array.isArray(card.base_model) ? card.base_model[0] || "" : card.base_model || "",
  ).slice(0, 200);
  const siblings = (Array.isArray(metadata.siblings) ? metadata.siblings : []).filter(
    (item) => typeof item?.rfilename === "string" && /\.(safetensors|gguf)$/i.test(item.rfilename),
  );
  const files = link.filePath
    ? siblings.filter((item) => item.rfilename === link.filePath)
    : siblings
        .filter((item) => !link.folder || item.rfilename.startsWith(`${link.folder}/`))
        .slice(0, 200);
  if (link.filePath && !files.length)
    throw new Error(
      /\.(safetensors|gguf)$/i.test(link.filePath)
        ? "That file isn’t in this repository revision."
        : "Choose a SafeTensors or GGUF file.",
    );
  if (!files.length) throw new Error("This repository has no SafeTensors or GGUF files.");
  const nsfw = tags.includes("not-for-all-audiences") ? true : null;
  const repoUrl = `https://huggingface.co/${owner}/${repo}`;
  const resources = files.map((item) => {
    const file = path.posix.basename(item.rfilename);
    const sha256 = /^[a-f0-9]{64}$/i.test(item.lfs?.sha256 || "")
      ? item.lfs.sha256.toLowerCase()
      : "";
    const bytes = Number(item.lfs?.size || item.size || 0);
    const { folder, guessed } = hfFolder(item.rfilename, { tags, card });
    const url = `${repoUrl}/resolve/${metadata.sha}/${item.rfilename.split("/").map(encodeURIComponent).join("/")}`;
    const spec =
      sha256 && modelFolders.has(folder)
        ? {
            id: `hf:${owner}/${repo}:${metadata.sha}:${item.rfilename}`,
            file,
            folder,
            label: file,
            url,
            sha256,
            bytes,
            baseModel,
            sourceUrl: `${repoUrl}/blob/${metadata.sha}/${item.rfilename}`,
          }
        : null;
    return {
      role: roleOf(folder),
      name: file,
      version: metadata.sha.slice(0, 7),
      want: {
        file,
        folder,
        sha256,
        bytes,
        source: {
          provider: "hf",
          repo: `${owner}/${repo}`,
          revision: metadata.sha,
          path: item.rfilename,
          url: `${repoUrl}/blob/${metadata.sha}/${item.rfilename}`,
        },
      },
      supported: Boolean(spec),
      spec,
      folderGuessed: guessed,
      optional: !link.filePath && files.length > 1,
      note: spec ? "" : "Hugging Face publishes no SHA-256 for this file.",
      ...(spec
        ? {}
        : {
            unavailable: {
              reason: "no-checksum",
              note: "Hugging Face publishes no SHA-256 for this file.",
            },
          }),
    };
  });
  // A file link offers the same model's other precisions and formats from the repository.
  const offers =
    link.filePath && resources[0]
      ? hfOffers({
          siblings,
          chosenPath: link.filePath,
          repo: `${owner}/${repo}`,
          revision: metadata.sha,
          folder: resources[0].want.folder,
          gguf,
        })
      : [];
  const instance =
    typeof card.instance_prompt === "string"
      ? card.instance_prompt
          .split(",")
          .map((word) => word.trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];
  return {
    title: `${owner}/${repo}`,
    version: metadata.sha.slice(0, 7),
    baseModel,
    type: resources.length === 1 ? resources[0].role : "repository",
    nsfw,
    sourceText: [
      typeof card.description === "string" ? plainDescription(card.description) : "",
      baseModel ? `Base model: ${baseModel}` : "",
      tags.length ? `Tags: ${tags.slice(0, 30).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 12000),
    links: { hf: link.filePath ? `${repoUrl}/blob/${metadata.sha}/${link.filePath}` : repoUrl },
    gated: Boolean(metadata.gated),
    resources,
    offers,
    /** A LoRA file's catalogue patch, built per resource when it is written. */
    entryFor: (resource) =>
      resource.want.folder !== "loras"
        ? null
        : {
            title: `${repo}${resources.length > 1 ? ` · ${resource.want.file}` : ""}`.slice(0, 300),
            version: metadata.sha.slice(0, 7),
            baseModel,
            ...(instance.length ? { triggers: instance } : {}),
            description: plainDescription(
              typeof card.description === "string" ? card.description : "",
            ),
            links: { hf: resource.want.source.url },
            nsfw: nsfw ?? true,
            ...(resource.want.sha256 ? { sha256: resource.want.sha256 } : {}),
            ...(resource.want.bytes ? { bytes: resource.want.bytes } : {}),
            source: {
              provider: "hf",
              repo: `${owner}/${repo}`,
              revision: metadata.sha,
              path: resource.want.source.path,
            },
          },
  };
}
