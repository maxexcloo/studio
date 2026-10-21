import type { GalleryItem } from './types';

export function itemNoun(item: Pick<GalleryItem, 'type'> | null | undefined): 'image' | 'video';
export function generatingLabel(count: number, items?: GalleryItem[]): string;
