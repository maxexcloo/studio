import { mediaUrls } from "./media-paths.js";

/**
 * An uploaded image or video is a gallery item marked `uploaded`, owned by the uploader and kept in
 * their media folder. Uploads stay out of the gallery until its Uploads filter is on (gallery/store.js
 * pageGallery), and Dream never takes them (domain/dream.ts). The item's id is the upload's own,
 * so a reference saved with that id keeps resolving. A new upload (references.js) builds the
 * record here.
 */
export function uploadedGalleryItem(upload) {
  return {
    id: upload.id,
    ...mediaUrls(upload.filename, upload.subfolder),
    ...(upload.ownerId ? { ownerId: upload.ownerId } : {}),
    type: String(upload.mime).startsWith("video/") ? "video" : "image",
    status: "done",
    uploaded: true,
    // An imported picture's own prompt and model (gallery/import.js).
    prompt: upload.prompt || "",
    ...(upload.model ? { model: upload.model } : {}),
    filename: upload.name,
    outputName: upload.filename,
    mime: upload.mime,
    width: upload.width,
    height: upload.height,
    ...(upload.durationMs ? { durationMs: upload.durationMs } : {}),
    size: upload.size,
    hash: upload.hash,
    // Where an imported upload came from: its post's link and title (gallery/reddit.js, gallery/import.js).
    ...(upload.source ? { source: upload.source } : {}),
    createdAt: upload.createdAt,
  };
}
