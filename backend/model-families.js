import path from "node:path";
import { comfy } from "./comfy.js";
import { dataDir } from "./gallery-store.js";
import {
  families,
  familyFromName,
  quantFromHeader,
  refinedFamily,
  variantFor,
} from "./family-catalog.js";
import { readJsonFile } from "./json-store.js";

/**
 * Which family (and variant) a model file belongs to. Studio never reads the
 * weights themselves: they live on the worker.
 *
 * Resolution order, strongest first:
 *   1. choice   - the user picked "Use as …" for this file
 *   2. metadata - modelspec fields via ComfyUI's /view_metadata
 *   3. name     - filename patterns
 *   4. default  - SD checkpoints the name cannot place fall back to the SD
 *                 family, which loads itself
 */

const modelSources = ["unet", "checkpoint"];

// ComfyUI's /view_metadata folder names for the same sources.
const metadataFolders = { unet: "diffusion_models", checkpoint: "checkpoints" };

/* ------------------------------------------------------------ Choices */

const choicesPath = () => path.join(dataDir, "model-types.json");
let choicesCache = null;

// Earlier builds stored coarser type names; read them as today's families.
const legacyChoices = { "z-image": "zimage", wan: "wan22_5b", checkpoint: "" };

function choiceKey(source, name) {
  return `${source}:${name}`;
}

function loadModelChoices() {
  if (choicesCache) return choicesCache;
  try {
    const raw = readJsonFile(choicesPath());
    choicesCache = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    choicesCache = {};
  }
  return choicesCache;
}

/** "family" or "family/variant", checked against what that folder can load. */
function parseChoice(value, source) {
  if (typeof value !== "string") return null;
  const raw = Object.hasOwn(legacyChoices, value) ? legacyChoices[value] : value;
  if (!raw) return null;
  const [familyId, variantId = ""] = raw.split("/");
  const family = families[familyId];
  if (!family || !family.sources.includes(source)) return null;
  if (variantId && !family.variants.some((variant) => variant.id === variantId)) return null;
  return { family: familyId, variant: variantId };
}

/* ------------------------------------------------------------ ComfyUI metadata */

// source:name -> __metadata__ block ({} when the file carries none).
const metadataCache = new Map();

/** A family from safetensors metadata (modelspec, kohya ss_* fields), or "". */
function familyFromMetadata(metadata = {}) {
  const text = [
    metadata["modelspec.architecture"],
    metadata["modelspec.title"],
    metadata.ss_base_model_version,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!text) return "";
  if (/krea[-_ .]?2/.test(text)) return "krea2";
  if (/z[-_ ]?image/.test(text)) return "zimage";
  if (/qwen[-_ ]?image/.test(text)) return "qwen_image";
  if (/chroma/.test(text)) return "chroma";
  if (/hidream/.test(text)) return "hidream";
  if (/flux[-_. ]?2|klein/.test(text)) return "";
  if (/flux/.test(text)) return "flux1";
  if (/stable-diffusion-v3|sd3/.test(text)) return "sd3";
  if (/xl/.test(text)) return "sdxl";
  if (/stable-diffusion-v2|sd_?v?2/.test(text)) return "sd2";
  if (/stable-diffusion-v1|sd_?v?1/.test(text)) return "sd15";
  return "";
}

/**
 * Fetch safetensors metadata for the worker's models, so they get better than
 * filename guesses. Only the __metadata__ block comes back (no tensor names).
 */
export async function primeModelMetadata(lists = {}, { concurrency = 6, signal } = {}) {
  const queue = [];
  for (const source of modelSources) {
    for (const name of lists[source] || []) {
      const key = choiceKey(source, name);
      if (metadataCache.has(key) || !/\.safetensors$/i.test(name)) continue;
      queue.push({ source, name, key });
    }
  }
  async function worker() {
    while (queue.length && !signal?.aborted) {
      const { source, name, key } = queue.shift();
      try {
        const metadata = await comfy(
          `/view_metadata/${metadataFolders[source]}?filename=${encodeURIComponent(name)}`,
          { signal },
        );
        metadataCache.set(key, metadata && typeof metadata === "object" ? metadata : {});
      } catch (error) {
        // 404 means "no metadata block" and is worth remembering; anything else
        // (ComfyUI restarting, timeouts) gets retried on the next scan.
        if (/Comfy 404/.test(error?.message || "")) metadataCache.set(key, {});
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
}

// Which parts a checkpoint carries is unknown until ComfyUI tries: assume all-in-one, which is
// what checkpoints/ usually holds.
const assumedBundle = Object.freeze({ encoder: true, vae: true, known: false });

/* ------------------------------------------------------------ Resolution */

/**
 * Everything Studio knows about one model file:
 *   family   - a key of `families` (runnable), a `knownFamilies` id, or ""
 *   variant  - the variant object within the family
 *   via      - how we know: choice, metadata, name, default
 *   bundled  - { encoder, vae, known } for checkpoints, null for diffusion models
 */
export function classifyModel(source, name) {
  const base = String(name).split(/[\\/]/).pop() || "";
  const bundled = source === "checkpoint" ? assumedBundle : null;
  // A quantized format rides along whatever family the file is: it decides the loader, not the settings.
  const quant = quantFromHeader(null, name);
  const finish = (familyId, via, variantId = "") => {
    // Families the name narrows (Wan 2.1 and 2.2 14B, HunyuanVideo 1.5 T2V and I2V); a choice stands as made.
    const id = via === "choice" ? familyId || "" : refinedFamily(familyId || "", base, false);
    const family = families[id];
    const variant = family
      ? (variantId && family.variants.find((item) => item.id === variantId)) || variantFor(id, base)
      : null;
    return { family: id, variant, via, bundled, quant };
  };

  const chosen = parseChoice(loadModelChoices()[choiceKey(source, name)], source);
  if (chosen) return finish(chosen.family, "choice", chosen.variant);

  const fromMetadata = familyFromMetadata(metadataCache.get(choiceKey(source, name)) || {});
  if (fromMetadata && families[fromMetadata]?.sources.includes(source))
    return finish(fromMetadata, "metadata");

  const fromName = familyFromName(name, source);
  if (fromName === "sdxl_or_sd15")
    return finish(/1[._]?5|sd15|v1[-_]5/i.test(base) ? "sd15" : "sdxl", "default");
  if (fromName && families[fromName]?.sources.includes(source)) return finish(fromName, "name");
  return finish("", "");
}
