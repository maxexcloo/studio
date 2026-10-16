import type { GalleryItem } from '../src/app/types';
export function matchesGalleryFilters(item: GalleryItem, filters?: { lora?: string; model?: string; workflow?: string }): boolean;
