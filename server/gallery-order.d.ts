import type { GalleryItem } from '../src/app/types';

export function galleryBucket(item: GalleryItem): number;
export function galleryTime(item: GalleryItem): number;
export function compareGalleryItems(a: GalleryItem, b: GalleryItem): number;
export function sortGalleryItems<T extends GalleryItem>(items: T[]): T[];
