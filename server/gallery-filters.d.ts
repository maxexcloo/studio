import type { GalleryItem } from '../src/app/types';
export type GalleryFilters = { lora?: string; model?: string; workflow?: string; size?: string; aspect?: string };
export const gallerySizeBands: { id: string; label: string; detail: string; min: number; max: number }[];
export const galleryAspects: { id: string; ratio: number }[];
export const otherAspect: string;
export function sizeBandOf(item: Partial<GalleryItem>): string;
export function aspectOf(item: Partial<GalleryItem>): string;
export function matchesGalleryFilters(item: GalleryItem, filters?: GalleryFilters): boolean;
