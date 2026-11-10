/**
 * Structured gallery filters. `lora`, `model`, `size`, `aspect` and `tag` each take
 * one value or several: any of a filter's values matches, and every filter
 * that is on must match. `workflow` is a single value.
 */
import { canonicalProfileId } from "../profile/store.js";

/** Long-edge size bands, without overlap: each upper bound is inclusive, the next band starts one pixel above. */
export const gallerySizeBands = [
  { id: "up-to-1k", label: "Up to 1K", detail: "1024 px or less", min: 0, max: 1024 },
  { id: "1k-1.5k", label: "1K–1.5K", detail: "1025–1536 px", min: 1025, max: 1536 },
  { id: "1.5k-2k", label: "1.5K–2K", detail: "1537–2048 px", min: 1537, max: 2048 },
  { id: "over-2k", label: "Over 2K", detail: "More than 2048 px", min: 2049, max: Infinity },
];

/** Orientations, A–Z; within 3% of 1:1 counts as square. */
export const galleryAspects = [
  { id: "landscape", label: "Landscape" },
  { id: "portrait", label: "Portrait" },
  { id: "square", label: "Square" },
];

function dimensions(item) {
  const width = Number(item?.width);
  const height = Number(item?.height);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function sizeBandOf(item) {
  const size = dimensions(item);
  if (!size) return "";
  const longEdge = Math.max(size.width, size.height);
  return gallerySizeBands.find((band) => longEdge >= band.min && longEdge <= band.max)?.id || "";
}

export function aspectOf(item) {
  const size = dimensions(item);
  if (!size) return "";
  const ratio = size.width / size.height;
  return Math.abs(Math.log(ratio)) <= Math.log(1.03)
    ? "square"
    : ratio > 1
      ? "landscape"
      : "portrait";
}

/** A filter's values as a list: a string, an array of them, or nothing; blanks dropped. */
export function filterValues(value) {
  return (Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

/** Whether any structured filter is on. */
export function hasGalleryFilters(filters = {}) {
  return ["lora", "model", "workflow", "size", "aspect", "tag"].some(
    (key) => filterValues(filters[key]).length,
  );
}

export function matchesGalleryFilters(item, filters = {}) {
  // Pending jobs always show; they have no final size yet.
  if (item.status === "pending") return true;
  const settings = item.settings || {};
  const fields = {
    lora: (Array.isArray(settings.loras) ? settings.loras : []).map((lora) => lora?.name),
    // A merged profile's records match its kept id too (profile/merge.js).
    model: [item.model, settings.modelName, canonicalProfileId(item.model)],
    workflow: [settings.workflow, settings.profileId, canonicalProfileId(settings.profileId)],
  };
  const textMatches = Object.entries(fields).every(([key, values]) => {
    const terms = filterValues(filters[key]).map((term) => term.toLowerCase());
    return (
      !terms.length ||
      terms.some((term) =>
        values.some((value) => typeof value === "string" && value.toLowerCase().includes(term)),
      )
    );
  });
  if (!textMatches) return false;
  // Unknown dimensions only drop out while a size or aspect filter is on.
  const sizes = filterValues(filters.size);
  if (sizes.length && !sizes.includes(sizeBandOf(item))) return false;
  const aspects = filterValues(filters.aspect);
  if (aspects.length && !aspects.includes(aspectOf(item))) return false;
  // Caption tags (domain/captions.ts) match whole.
  const tags = filterValues(filters.tag);
  if (tags.length && !captionTags(item).some((tag) => tags.includes(tag))) return false;
  return true;
}

/** An item's caption tags, lowercase as the captioner writes them. */
export const captionTags = (item) =>
  Array.isArray(item?.caption?.tags)
    ? item.caption.tags.filter((tag) => typeof tag === "string")
    : [];

/** The most used caption tags among `items` with their counts, most first, then A–Z. */
export function topCaptionTags(items, limit = 30) {
  const counts = new Map();
  for (const item of items)
    for (const tag of new Set(captionTags(item))) counts.set(tag, (counts.get(tag) || 0) + 1);
  return [...counts]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, limit)
    .map(([tag, count]) => ({ value: tag, label: tag, count }));
}
