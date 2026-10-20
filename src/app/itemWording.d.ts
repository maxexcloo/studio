import type { GalleryItem } from './types';

export function itemNoun(item: Pick<GalleryItem, 'type'> | null | undefined): 'image' | 'video';
export function deleteConfirmation(item: GalleryItem): { title: string; description: string; action: string; destructive?: boolean };
export function generatingLabel(count: number, items?: GalleryItem[]): string;
