/** Structured filters shared by paginated galleries and the in-memory Hidden view. */

/** Long-edge size bands, without overlap: each upper bound is inclusive, the next band starts one pixel above. */
export const gallerySizeBands = [
  { id: 'up-to-1k', label: 'Up to 1K', detail: '1024 px or less', min: 0, max: 1024 },
  { id: '1k-1.5k', label: '1K–1.5K', detail: '1025–1536 px', min: 1025, max: 1536 },
  { id: '1.5k-2k', label: '1.5K–2K', detail: '1537–2048 px', min: 1537, max: 2048 },
  { id: 'over-2k', label: 'Over 2K', detail: 'More than 2048 px', min: 2049, max: Infinity }
];

/** Common aspect ratios; model-native sizes (multiples of 64) snap within 4%, and anything further is Other. */
export const galleryAspects = [
  { id: '1:1', ratio: 1 }, { id: '4:3', ratio: 4 / 3 }, { id: '3:4', ratio: 3 / 4 }, { id: '3:2', ratio: 3 / 2 },
  { id: '2:3', ratio: 2 / 3 }, { id: '16:9', ratio: 16 / 9 }, { id: '9:16', ratio: 9 / 16 }, { id: '21:9', ratio: 21 / 9 }
];
export const otherAspect = 'other';

function dimensions(item) {
  const width = Number(item?.width);
  const height = Number(item?.height);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function sizeBandOf(item) {
  const size = dimensions(item);
  if (!size) return '';
  const longEdge = Math.max(size.width, size.height);
  return gallerySizeBands.find((band) => longEdge >= band.min && longEdge <= band.max)?.id || '';
}

export function aspectOf(item) {
  const size = dimensions(item);
  if (!size) return '';
  const ratio = size.width / size.height;
  const nearest = galleryAspects.reduce((best, aspect) => (Math.abs(Math.log(ratio / aspect.ratio)) < Math.abs(Math.log(ratio / best.ratio)) ? aspect : best));
  return Math.abs(ratio / nearest.ratio - 1) <= 0.04 ? nearest.id : otherAspect;
}

export function matchesGalleryFilters(item, filters = {}) {
  // Pending jobs always show; they have no final size yet.
  if (item.status === 'pending') return true;
  const settings = item.settings || {};
  const fields = {
    lora: (Array.isArray(settings.loras) ? settings.loras : []).map((lora) => lora?.name),
    model: [item.model, settings.modelName],
    workflow: [settings.workflow, settings.profileId],
  };
  const textMatches = Object.entries(fields).every(([key, values]) => {
    const term = String(filters[key] || '').trim().toLowerCase();
    return !term || values.some((value) => typeof value === 'string' && value.toLowerCase().includes(term));
  });
  if (!textMatches) return false;
  // Unknown dimensions only drop out while a size or aspect filter is on.
  if (filters.size && sizeBandOf(item) !== filters.size) return false;
  if (filters.aspect && aspectOf(item) !== filters.aspect) return false;
  return true;
}
