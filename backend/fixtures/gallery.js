import { dataDir, galleryItems, putGalleryItems } from "../gallery/store.js";
import { runtimeDatabase } from "../persistence/runtime.ts";

/** Replaces the whole test gallery with `items`. */
export function setGallery(items) {
  runtimeDatabase(dataDir).exec("DELETE FROM studio_gallery");
  putGalleryItems(items);
}

/** Every saved item, in gallery order. */
export const gallery = () => galleryItems();
