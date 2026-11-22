/**
 * The gallery's order, as SQLite reads it from the indexed columns (persistence/gallery-rows.ts):
 * newest first with unreadable times last, then by job, output index and id. Keys compare as
 * SQLite does, so a page's cursor and JS sorting agree with the query.
 */

/** Date.parse's time of the gallery position, null when unreadable. */
function galleryTime(item) {
  const time = Date.parse(item?.galleryAt || item?.createdAt || "");
  return Number.isFinite(time) ? time : null;
}

const text = (value) => (value === undefined || value === null ? null : String(value));

function galleryOrderKey(item) {
  return {
    time: galleryTime(item),
    jobId: text(item.jobId),
    index: Number(item.index) || 0,
    id: text(item.id),
  };
}

// Descending, with null last; ties compare as 0.
const descending = (a, b) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? 1 : -1);

export function compareGalleryKeys(a, b, sort = "newest") {
  const time =
    sort === "oldest" && a.time !== null && b.time !== null
      ? a.time - b.time
      : descending(a.time, b.time);
  return (
    (sort === "liked" || sort === "disliked" ? Number(b[sort]) - Number(a[sort]) : 0) ||
    time ||
    descending(a.jobId, b.jobId) ||
    a.index - b.index ||
    descending(a.id, b.id)
  );
}

export function compareGalleryItems(a, b) {
  return compareGalleryKeys(galleryOrderKey(a), galleryOrderKey(b));
}
