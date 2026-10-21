import React from 'react';
import { CheckCircle2, Columns2, Copy, Download, FastForward, ImagePlus, RotateCcw, RotateCw, Share, Star, Trash2, Clapperboard } from 'lucide-react';
import { canAnimatePhoto, canExtendVideo } from './AnimatePhotos';
import { canStar } from './favorites';
import { canShareFiles, downloadItem, downloadItems, downloadUrl, shareItem, shareItems } from './share';
import { canUpscaleItem, upscaledWithRun } from './useUpscale';
import { UpscaleArrow } from './UpscaleArrow';
import type { GalleryItem } from './types';
import type { ShowToast } from './toast';

/**
 * One list of what can be done to a gallery item, shared by every place that
 * offers it: the phone viewer's bar, the desktop viewer's bar, a tile's quick
 * actions and the gallery's context menu. Each action says when it applies;
 * each surface picks the ones it has room for, always in this order, with
 * these one-word names and icons, grouped by intent (docs/guides/UI-PATTERNS.md):
 * keep it (Copy, Download or Share) | make more (Animate or Extend, Recreate,
 * Edit, Reference, Retry, Upscale, Compare) | organise (Star, Select, Delete).
 */

export type ItemSurface = 'bar' | 'dock' | 'tile' | 'menu';

/** Where an action sits by intent; surfaces draw a divider between groups. */
export type ItemActionGroup = 'keep' | 'make' | 'organise';

export type ItemActionId =
  | 'copyItem' | 'share' | 'download' | 'animate' | 'extend' | 'reuse' | 'promptsOnly' | 'reference'
  | 'retry' | 'upscale' | 'compareVariants' | 'compare' | 'star' | 'select' | 'delete';

export type ItemActionHandlers = {
  showToast: ShowToast;
  smartUpscale: boolean;
  upscaleBusy: (item: GalleryItem) => boolean;
  upscale: (item: GalleryItem) => void;
  cancelUpscale: (item: GalleryItem) => void;
  /** Copies the prompt; `announce` says so in a toast, for buttons that are gone once clicked. */
  copyPrompt: (item: GalleryItem, announce?: string) => Promise<boolean>;
  /** The image itself, its link, or its details. */
  copyItem: (item: GalleryItem) => Promise<boolean>;
  /** Recreate: an exact rerun, with its model, prompts, size, LoRAs, references, settings and seed, loaded into Create. */
  reuse: (item: GalleryItem) => void;
  /** Edit: the prompts and settings, with a new seed, loaded into Create to change. */
  promptsOnly: (item: GalleryItem) => void;
  /** Left out when the current model takes no reference image. */
  useAsReference?: (item: GalleryItem) => void;
  /** Animates a photo or extends a video; left out when no first-frame video profile is ready. */
  animate?: (item: GalleryItem) => void;
  /** Runs a failed item again as a new job, with its own model, prompts, settings and references. */
  retry: (item: GalleryItem) => void;
  remove: (item: GalleryItem) => void;
  star: (item: GalleryItem) => void;
  /* The same for several selected items at once. */
  compareVariants?: (items: GalleryItem[]) => void;
  retryItems: (items: GalleryItem[]) => void;
  starItems: (items: GalleryItem[], favorite: boolean) => void;
  removeItems: (items: GalleryItem[]) => Promise<unknown>;
};

export type ItemActionIcon = React.ComponentType<{ size?: number; fill?: string; strokeWidth?: number }>;

export type ItemAction = {
  id: ItemActionId;
  group: ItemActionGroup;
  /** The full name, used in sheets, menus and as the accessible name. */
  label: string;
  /** A shorter visible label for the phone viewer's bar. */
  short?: string;
  /** A desktop tooltip and accessible name, where it says more than the label. */
  tip?: string;
  Icon: ItemActionIcon;
  run: () => void;
  /** Copy actions: copies without a toast, for buttons that show their own check. */
  copy?: () => Promise<boolean>;
  /** Download actions can be plain links, so the browser saves the file itself. */
  href?: string;
  pressed?: boolean;
  danger?: boolean;
  /** Bulk actions stay in place, unavailable, when nothing selected fits them. */
  disabled?: boolean;
};

export type ItemActionExtras = {
  /** The viewer's side-by-side comparison of an upscale with its original. */
  compare?: { open: boolean; toggle: () => void };
  /** Starts selecting several, with this item selected. */
  select?: (item: GalleryItem) => void;
};

// Where each action appears. A desktop tile's top row follows the desktop
// viewer bar's order (Download | Animate or Extend · Recreate or Retry ·
// Upscale | Star · Delete), Upscale pressed while the upscale shows; what a
// narrow tile has no room for waits behind More, the context menu.
// The phone viewer's bar shares where it can and
// downloads only where the share sheet can't take the file; it keeps Star and
// Info in the top corners. The desktop downloads and never shares.
const placement: Record<ItemActionId, readonly ItemSurface[]> = {
  copyItem: ['bar', 'dock', 'menu'],
  share: ['bar'],
  download: canShareFiles ? ['dock', 'tile', 'menu'] : ['bar', 'dock', 'tile', 'menu'],
  animate: ['bar', 'dock', 'tile', 'menu'],
  extend: ['bar', 'dock', 'tile', 'menu'],
  reuse: ['bar', 'dock', 'tile', 'menu'],
  promptsOnly: [],
  reference: ['bar', 'dock', 'menu'],
  retry: ['bar', 'dock', 'tile', 'menu'],
  upscale: ['bar', 'dock', 'tile', 'menu'],
  compare: ['bar', 'dock'],
  compareVariants: [],
  star: ['dock', 'tile', 'menu'],
  select: ['menu'],
  delete: ['bar', 'dock', 'tile', 'menu'],
};

export function upscaleLabel(item: GalleryItem) {
  if (item.upscale?.status === 'running') return 'Stop Upscale';
  if (item.upscale?.url) return item.upscaleActive ? 'Show Original' : 'Show Upscale';
  return 'Upscale';
}

/** Every action that applies to this item on this surface, in order. */
export function itemActions(item: GalleryItem, handlers: ItemActionHandlers, surface: ItemSurface, extras: ItemActionExtras = {}): ItemAction[] {
  const done = item.status === 'done' && Boolean(item.url);
  const upscaled = Boolean(item.upscaleActive && !upscaledWithRun(item));
  const copyTip = item.url ? item.type === 'image' ? 'Copy Image' : 'Copy Link' : 'Copy Details';
  const actions: (ItemAction | false | undefined)[] = [
    item.status !== 'pending' && {
      id: 'copyItem', group: 'keep', label: 'Copy', tip: copyTip, Icon: Copy,
      copy: () => handlers.copyItem(item),
      run: () => { void handlers.copyItem(item).then((copied) => { if (copied) handlers.showToast('Copied', 'success'); }); },
    },
    done && canShareFiles && { id: 'share', group: 'keep', label: 'Share', Icon: Share, run: () => { void shareItem(item, handlers.showToast); } },
    Boolean(item.url) && item.status !== 'pending' && { id: 'download', group: 'keep', label: 'Download', tip: upscaled ? 'Download the Upscale' : 'Download', Icon: Download, href: downloadUrl(item), run: () => downloadItem(item) },
    handlers.animate && canAnimatePhoto(item) && { id: 'animate', group: 'make', label: 'Animate', tip: 'Animate Into a Video', Icon: Clapperboard, run: () => handlers.animate!(item) },
    handlers.animate && canExtendVideo(item) && { id: 'extend', group: 'make', label: 'Extend', tip: 'Extend This Video', Icon: FastForward, run: () => handlers.animate!(item) },
    Boolean(item.prompt) && { id: 'reuse', group: 'make', label: 'Recreate', tip: 'Recreate With the Same Seed', Icon: RotateCcw, run: () => handlers.reuse(item) },
    done && handlers.useAsReference && item.type === 'image' && !item.library && {
      id: 'reference', group: 'make', label: 'Reference', tip: 'Reference This Image', Icon: ImagePlus, run: () => handlers.useAsReference!(item),
    },
    item.status === 'error' && !item.library && { id: 'retry', group: 'make', label: 'Retry', tip: 'Retry as a New Job', Icon: RotateCw, run: () => handlers.retry(item) },
    handlers.smartUpscale && canUpscaleItem(item) && {
      id: 'upscale', group: 'make', label: upscaleLabel(item), Icon: UpscaleArrow, pressed: item.upscale?.url ? Boolean(item.upscaleActive) : undefined,
      run: () => (item.upscale?.status === 'running' ? handlers.cancelUpscale(item) : handlers.upscale(item)),
    },
    extras.compare && item.type === 'image' && Boolean(item.upscale?.url) && !upscaledWithRun(item) && {
      id: 'compare', group: 'make', label: 'Compare', tip: extras.compare.open ? 'Hide the Comparison' : 'Compare With the Original', Icon: Columns2, pressed: extras.compare.open, run: extras.compare.toggle,
    },
    canStar(item) && { id: 'star', group: 'organise', label: item.favorite ? 'Unstar' : 'Star', Icon: Star, pressed: Boolean(item.favorite), run: () => handlers.star(item) },
    extras.select && (item.status === 'done' || item.status === 'error') && { id: 'select', group: 'organise', label: 'Select', Icon: CheckCircle2, run: () => extras.select!(item) },
    item.status !== 'pending' && {
      id: 'delete', group: 'organise', label: item.library ? 'Remove' : 'Delete', tip: item.library ? 'Remove From Gallery' : 'Delete',
      Icon: Trash2, danger: true, run: () => handlers.remove(item),
    },
  ];
  return actions.filter((action): action is ItemAction => Boolean(action) && placement[(action as ItemAction).id].includes(surface)
    // A failed tile offers Retry where a finished one offers Recreate.
    && !(surface === 'tile' && (action as ItemAction).id === 'reuse' && item.status === 'error'));
}

/**
 * What can be done to several selected items, in the same order and with the
 * same one-word names as for one: Share on a phone that can (Download elsewhere,
 * a zip when several), Retry for failed ones, Star and Delete; never Animate,
 * which takes one photo at a time. Their tips and accessible names are bulk
 * wording ("Star Selected"), never one item's copy. The select bars and the
 * right-click menu offer the same.
 */
export function bulkItemActions(items: GalleryItem[], handlers: ItemActionHandlers, phone = false): ItemAction[] {
  const ready = items.filter((item) => item.status === 'done' && item.url);
  const failed = items.filter((item) => item.status === 'error' && !item.library);
  const starrable = items.filter(canStar);
  const allStarred = starrable.length > 0 && starrable.every((item) => item.favorite);
  const actions: (ItemAction | false)[] = [
    phone && canShareFiles && { id: 'share', group: 'keep', label: 'Share', tip: 'Share Selected', Icon: Share, disabled: !ready.length, run: () => { void shareItems(ready, handlers.showToast); } },
    !(phone && canShareFiles) && { id: 'download', group: 'keep', label: 'Download', tip: ready.length > 1 ? 'Download Selected as a Zip' : 'Download Selected', Icon: Download, disabled: !ready.length, run: () => { void downloadItems(ready, handlers.showToast); } },
    failed.length > 0 && { id: 'retry', group: 'make', label: 'Retry', tip: 'Retry Selected', Icon: RotateCw, run: () => handlers.retryItems(failed) },
    { id: 'star', group: 'organise', label: allStarred ? 'Unstar' : 'Star', tip: allStarred ? 'Unstar Selected' : 'Star Selected', Icon: Star, disabled: !starrable.length, run: () => handlers.starItems(starrable, !allStarred) },
    { id: 'delete', group: 'organise', label: items.length > 0 && items.every((item) => item.library) ? 'Remove' : 'Delete', tip: items.length > 0 && items.every((item) => item.library) ? 'Remove Selected' : 'Delete Selected', Icon: Trash2, danger: true, disabled: !items.length, run: () => { void handlers.removeItems(items); } },
  ];
  return actions.filter((action): action is ItemAction => Boolean(action));
}

/** The studio's handlers, kept stable so memoised tiles only redraw for their own item. */
export const ItemActionsContext = React.createContext<ItemActionHandlers | null>(null);

export function useItemActions(item: GalleryItem | null, surface: ItemSurface, extras?: ItemActionExtras) {
  const handlers = React.useContext(ItemActionsContext);
  return handlers && item ? itemActions(item, handlers, surface, extras) : [];
}

export function useItemActionHandlers() {
  return React.useContext(ItemActionsContext);
}
