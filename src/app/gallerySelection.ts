import React from 'react';
import type { GalleryItem } from './types';

export const GallerySelectionContext = React.createContext<{
  selecting: boolean;
  selected: Set<string>;
  click: (item: GalleryItem, event: React.MouseEvent) => boolean;
  menu: (item: GalleryItem, event: React.MouseEvent | React.KeyboardEvent) => void;
} | null>(null);
