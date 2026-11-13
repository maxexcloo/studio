const parsedTimes = new WeakMap();

/** An item whose prompt is unknown (a Civitai import) keeps its chronological position. */
function galleryBucket(item) {
  if (item?.status !== "done" || item.civitai?.imageId) return 0;
  return String(item.prompt || "").trim() ? 0 : 1;
}

function parsedTime(item) {
  if (!item || typeof item !== "object") return null;
  if (!parsedTimes.has(item)) {
    const time = Date.parse(item.createdAt || "");
    parsedTimes.set(item, Number.isFinite(time) ? time : null);
  }
  return parsedTimes.get(item);
}

export function galleryTime(item) {
  return parsedTime(item) ?? 0;
}

export function galleryOrderKey(item) {
  return {
    bucket: galleryBucket(item),
    time: parsedTime(item),
    id: String(item.id || ""),
    jobId: item.jobId || "",
    index: Number(item.index) || 0,
  };
}

export function compareGalleryKeys(a, b) {
  if (a.bucket !== b.bucket) return a.bucket - b.bucket;
  if ((a.time === null) !== (b.time === null)) return a.time === null ? 1 : -1;
  const timeDelta = (b.time ?? 0) - (a.time ?? 0);
  if (timeDelta) return timeDelta;
  if (a.jobId && a.jobId === b.jobId && a.index !== b.index) return a.index - b.index;
  return b.id.localeCompare(a.id);
}

export function compareGalleryItems(a, b) {
  return compareGalleryKeys(galleryOrderKey(a), galleryOrderKey(b));
}

const setOrder = (a, b) =>
  (Number(a.resultSet.index) || 0) - (Number(b.resultSet.index) || 0) ||
  galleryTime(a) - galleryTime(b) ||
  (Number(a.index) || 0) - (Number(b.index) || 0);

/**
 * Sorted items with each MCP result set's results together, in the set's order (prompt order,
 * then as made), where its newest result sorts.
 */
export function groupSets(items) {
  const sets = new Map();
  for (const item of items) {
    const id = item.resultSet?.id;
    if (!id) continue;
    if (sets.has(id)) sets.get(id).push(item);
    else sets.set(id, [item]);
  }
  if (!sets.size) return items;
  const grouped = [];
  for (const item of items) {
    const members = sets.get(item.resultSet?.id);
    if (!members) grouped.push(item);
    else if (members[0] === item) grouped.push(...[...members].sort(setOrder));
  }
  return grouped;
}
