import { comfy } from "./comfy.js";
import { families as modelFamilies } from "./family-catalog.js";
import { enrichLocalLoraInfo, enrichLoraInfo } from "./lora-catalogue.js";
import { catalogueStore } from "./library-catalogue.js";

// Imported-only model families still need precise adapter compatibility labels.
const families = {
  ...modelFamilies,
  boogu: { label: "Boogu" },
  moss_image: { label: "MOSS Image" },
};

/**
 * What a LoRA was trained for and how to trigger it, from its metadata
 * (kohya's ss_base_model_version, modelspec) through ComfyUI's /view_metadata,
 * and never the file name alone. Nothing is guessed: a LoRA that says nothing
 * clear stays "unknown" and is never marked as not fitting.
 *
 * families: the model families it fits (a Wan 14B LoRA fits Wan 2.1 and 2.2
 * 14B alike); empty when unknown. triggers: its trigger words. about: its own
 * title, for telling a speed LoRA from a style one.
 */

// name -> info, as the worker's metadata gave it.
const cache = new Map();

/* ------------------------------------------------------------ Metadata */

// Ordered: the more specific names first ("flux 2" before "flux", "wan 2.2 5b" before "wan").
const metadataFamilies = [
  [/flux[-_. ]?3(?:[-_. ]?klein)?(?:\b|[_/])/, ["flux3"]],
  [/moss[-_ ]?image/, ["moss_image"]],
  [/flux[-_. ]?2[-_. ]?klein[-_. ]?9b|klein[-_. ]?9b/, ["flux2_klein_9b"]],
  [/flux[-_. ]?2[-_. ]?klein|klein[-_. ]?4b/, ["flux2_klein_4b"]],
  [/flux[-_. ]?2/, ["flux2_dev", "flux2_klein_4b", "flux2_klein_9b"]],
  [/boogu/, ["boogu"]],
  [/chroma/, ["chroma"]],
  [/flux/, ["flux1"]],
  [/z[-_ ]?image/, ["zimage"]],
  [/qwen[-_ ]?image[-_ ]?2[._]?1/, ["qwen_image_21"]],
  [/qwen[-_ ]?image/, ["qwen_image"]],
  [/minimax[-_ ]?h3/, ["minimax_h3"]],
  [/wan[-_ ]?2[._]?2.*5b|ti2v/, ["wan22_5b"]],
  [/wan/, ["wan21", "wan22_14b"]],
  [/hunyuan[-_ ]?video[-_ ]?1[._]?5|hunyuan15/, ["hunyuan15"]],
  [/hidream/, ["hidream"]],
  [/lumina|neta/, ["lumina2"]],
  [/krea[-_ ]?2/, ["krea2"]],
  [/anima/, ["anima"]],
  [/auraflow|pony[-_ ]?v7/, ["auraflow"]],
  [/sd[-_ ]?3|stable-diffusion-v3|stable-diffusion-3/, ["sd3"]],
  [/sdxl|stable-diffusion-xl|xl[-_]base|pony|illustrious|noob/, ["sdxl"]],
  [/sd[-_ ]?v?2|stable-diffusion-v2/, ["sd2"]],
  [/sd[-_ ]?v?1|stable-diffusion-v1|sd[-_ ]?1\.5/, ["sd15"]],
];

/** Families from what a LoRA's metadata says it was trained on, or []. */
export function familiesFromMetadata(metadata = {}) {
  const text = [
    "modelspec.architecture",
    "ss_base_model_version",
    "ss_architecture",
    "base_model",
    "modelspec.base_model",
  ]
    .map((key) => metadata?.[key])
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (!text) return [];
  return metadataFamilies.find(([test]) => test.test(text))?.[1] || [];
}

const parseJson = (value) => {
  if (typeof value !== "string") return value && typeof value === "object" ? value : null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

/**
 * Trigger words: what the trainer wrote down (modelspec's trigger phrase,
 * ai-toolkit's trigger word), else the tags kohya saw on every training image.
 */
export function triggersFromMetadata(metadata = {}) {
  const explicit = [
    metadata?.["modelspec.trigger_phrase"],
    metadata?.trigger_phrase,
    metadata?.trigger_word,
    metadata?.trigger_words,
    metadata?.["ss_trigger_words"],
  ].filter((value) => typeof value === "string" && value.trim());
  if (explicit.length) {
    return [
      ...new Set(
        explicit
          .flatMap((value) => value.split(/[,\n]/))
          .map((word) => word.trim())
          .filter(Boolean),
      ),
    ].slice(0, 6);
  }
  const frequency = parseJson(metadata?.ss_tag_frequency);
  if (!frequency || typeof frequency !== "object") return [];
  const counts = new Map();
  let images = 0;
  for (const tags of Object.values(frequency)) {
    if (!tags || typeof tags !== "object") continue;
    for (const [tag, count] of Object.entries(tags)) {
      const word = String(tag).trim();
      if (!word || !Number.isFinite(Number(count))) continue;
      counts.set(word, (counts.get(word) || 0) + Number(count));
    }
  }
  // Datasets that give their image count; otherwise the most frequent tag stands in for it.
  const datasets = parseJson(metadata?.ss_dataset_dirs);
  if (datasets && typeof datasets === "object")
    images = Object.values(datasets).reduce((sum, item) => sum + (Number(item?.img_count) || 0), 0);
  const top = Math.max(0, ...counts.values());
  const every = images || top;
  if (!every) return [];
  return (
    [...counts.entries()]
      .filter(([, count]) => count >= every * 0.9)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag]) => tag)
      // A caption-long "tag" is a whole sentence, not something to type.
      .filter((tag) => tag.length <= 48)
      .slice(0, 5)
  );
}

/* ------------------------------------------------------------ Description */

const label = (ids) =>
  [...new Set(ids.map((id) => families[id]?.label).filter(Boolean))].join(" / ");

/**
 * The families a LoRA fits, with the ones that only narrow them by name
 * (`refines`): a Wan 14B LoRA fits Wan 2.2 14B I2V, a HunyuanVideo 1.5 one its I2V model.
 */
function withRefinements(ids) {
  const all = new Set(ids);
  for (let grew = true; grew;) {
    grew = false;
    for (const [id, spec] of Object.entries(families)) {
      if (spec.refines && all.has(spec.refines.family) && !all.has(id)) {
        all.add(id);
        grew = true;
      }
    }
  }
  return [...all];
}

function describe(metadata) {
  const found = familiesFromMetadata(metadata);
  // The label names what it was made for; the list also holds the models that share its layout.
  const base = label(found);
  const ids = withRefinements(found);
  const about = ["modelspec.title", "ss_output_name", "name"]
    .map((key) => metadata?.[key])
    .filter((value) => typeof value === "string")
    .join(" ");
  const title = ["modelspec.title", "ss_output_name", "name"]
    .map((key) => metadata?.[key])
    .find((value) => typeof value === "string" && value.trim())
    ?.trim()
    .slice(0, 200);
  const description = metadata?.["modelspec.description"];
  return {
    ...(typeof description === "string" ? { description: description.trim().slice(0, 10000) } : {}),
    ...(title ? { title } : {}),
    families: ids,
    base,
    triggers: triggersFromMetadata(metadata || {}),
    ...(about ? { about: about.slice(0, 200) } : {}),
  };
}

/** What one LoRA is, as far as its metadata has been read; null before that. */
export function loraInfo(name) {
  return cache.get(name) || null;
}

/**
 * Every listed LoRA's info. ComfyUI hands out the metadata block (no tensor
 * names) through /view_metadata, so each is read a few at a time and remembered.
 */
export async function loraInfos(names = [], { concurrency = 6 } = {}) {
  const result = {};
  const remote = [];
  for (const name of names) {
    const info = loraInfo(name);
    if (info) result[name] = info;
    else if (/\.safetensors$/i.test(name)) remote.push(name);
  }
  async function worker() {
    while (remote.length) {
      const name = remote.shift();
      try {
        const metadata = await comfy(`/view_metadata/loras?filename=${encodeURIComponent(name)}`, {
          timeout: 10_000,
        });
        cache.set(name, describe(metadata && typeof metadata === "object" ? metadata : {}));
      } catch (error) {
        // No metadata block is an answer worth keeping; anything else is tried again next time.
        if (Number(error?.status) === 404) cache.set(name, describe({}));
      }
      if (cache.has(name)) result[name] = cache.get(name);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  for (const [name, info] of Object.entries(result)) result[name] = catalogueLoraInfo(name, info);
  return result;
}

/** The catalogue store (library-catalogue.js), with entry families read the way LoRA metadata is. */
export const loraCatalogue = () => catalogueStore({ familiesFromMetadata });

/** Provider and local policy metadata can be checked before submitting an optional stack. */
export function catalogueLoraInfo(name, info = loraInfo(name) || { families: [], triggers: [] }) {
  // One catalogue (library/catalogue.json) holds provider downloads, the synced and hand-installed
  // lora-catalogue.json files and Studio's edits; this view keeps the shapes those files had.
  const { sources, catalogue } = loraCatalogue().loraView();
  return enrichLocalLoraInfo(
    enrichLoraInfo(info, name, sources, familiesFromMetadata, families),
    name,
    catalogue,
    familiesFromMetadata,
    families,
  );
}
