const parsedTimes = new WeakMap();

/** A concealed prompt is unknown, so it must keep its chronological position. */
export function galleryBucket(item) {
  if (item?.status !== "done" || item.privateVault || item.vaultLocked || item.promptProtected || item.promptEncrypted || item.negativeEncrypted) return 0;
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
  return { bucket: galleryBucket(item), time: parsedTime(item), id: String(item.id || ""), jobId: item.jobId || "", index: Number(item.index) || 0 };
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
