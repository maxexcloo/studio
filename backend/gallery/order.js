/**
 * The gallery's order, as SQLite reads it from the indexed columns (persistence/gallery-rows.ts):
 * the bucket, then newest first with unreadable times last, then by job (descending, none last),
 * output index and id (descending, none last). Keys compare as SQLite does, so a page's cursor and
 * JS sorting agree with the query.
 */

/** An item whose prompt is unknown (a Civitai import) keeps its chronological position. */
function galleryBucket(item) {
  if (item?.status !== "done" || item.civitai?.imageId != null) return 0;
  return String(item.prompt || "").trim() ? 0 : 1;
}

/** Date.parse's time of `createdAt`, null when unreadable. */
export function galleryTime(item) {
  const time = Date.parse(item?.createdAt || "");
  return Number.isFinite(time) ? time : null;
}

const text = (value) => (value === undefined || value === null ? null : String(value));

export function galleryOrderKey(item) {
  return {
    bucket: galleryBucket(item),
    time: galleryTime(item),
    jobId: text(item.jobId),
    index: Number(item.index) || 0,
    id: text(item.id),
  };
}

// Descending, with null last; ties compare as 0.
const descending = (a, b) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? 1 : -1);

export function compareGalleryKeys(a, b) {
  return (
    a.bucket - b.bucket ||
    descending(a.time, b.time) ||
    descending(a.jobId, b.jobId) ||
    a.index - b.index ||
    descending(a.id, b.id)
  );
}

export function compareGalleryItems(a, b) {
  return compareGalleryKeys(galleryOrderKey(a), galleryOrderKey(b));
}
