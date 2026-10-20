import React from 'react';
import { CheckCircle2, Columns2, Copy, Download, Eye, EyeOff, FastForward, ImagePlus, Share, Star, TextQuote, Trash2, Video, Wand2 } from 'lucide-react';
import { canAnimatePhoto, canExtendVideo } from './AnimatePhotos';
import { canStar } from './favorites';
import { canShareFiles, downloadItem, downloadUrl, shareItem } from './share';
import { canUpscaleItem, upscaledWithRun } from './useUpscale';
import { UpscaleArrow } from './UpscaleArrow';
import type { GalleryItem } from './types';
import type { ShowToast } from './toast';

/**
 * One list of what can be done to a gallery item, shared by every place that
 * offers it: the phone viewer's bar, the phone's long-press sheet, the desktop
 * viewer's dock, a tile's quick actions and the gallery's context menu. Each
 * action says when it applies; each surface picks the ones it has room for,
 * always in this order and with these labels.
 */

export type ItemSurface = 'bar' | 'sheet' | 'dock' | 'tile' | 'menu';

export type ItemActionId =
  | 'share' | 'download' | 'copyItem' | 'star' | 'upscale' | 'compare' | 'reuse' | 'copyPrompt'
  | 'promptsOnly' | 'animate' | 'extend' | 'reference' | 'move' | 'select' | 'delete';

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
  reuse: (item: GalleryItem) => void;
  promptsOnly: (item: GalleryItem) => void;
  /** Left out when the current model takes no reference image. */
  useAsReference?: (item: GalleryItem) => void;
  /** Animates a photo or extends a video; left out when no first-frame video profile is ready. */
  animate?: (item: GalleryItem) => void;
  hide: (item: GalleryItem) => void;
  unhide: (item: GalleryItem) => void;
  remove: (item: GalleryItem) => void;
  star: (item: GalleryItem) => void;
};

export type ItemActionIcon = React.ComponentType<{ size?: number; fill?: string; strokeWidth?: number }>;

export type ItemAction = {
  id: ItemActionId;
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
  /** A haptic cue on phones. */
  haptic?: 'tap' | 'warning';
};

export type ItemActionExtras = {
  /** The viewer's side-by-side comparison of an upscale with its original. */
  compare?: { open: boolean; toggle: () => void };
  /** Starts selecting several, with this item selected. */
  select?: (item: GalleryItem) => void;
};

// Where each action appears. The phone bar and sheet share where they can, so they
// download only where the share sheet is not there to save the file.
const placement: Record<ItemActionId, readonly ItemSurface[]> = {
  share: ['bar', 'sheet', 'dock', 'menu'],
  download: canShareFiles ? ['dock', 'tile', 'menu'] : ['bar', 'sheet', 'dock', 'tile', 'menu'],
  copyItem: ['dock', 'menu'],
  star: ['bar', 'sheet', 'dock', 'tile', 'menu'],
  upscale: ['bar', 'sheet', 'dock', 'menu'],
  compare: ['bar', 'dock'],
  reuse: ['bar', 'sheet', 'menu'],
  copyPrompt: ['bar', 'sheet', 'tile', 'menu'],
  promptsOnly: ['sheet', 'menu'],
  animate: ['bar', 'sheet', 'dock', 'menu'],
  extend: ['bar', 'sheet', 'dock', 'menu'],
  reference: ['sheet', 'dock', 'menu'],
  move: ['bar', 'sheet', 'dock', 'tile', 'menu'],
  select: ['sheet', 'menu'],
  delete: ['bar', 'sheet', 'dock', 'tile', 'menu'],
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
  const copyLabel = item.url ? item.type === 'image' ? 'Copy Image' : 'Copy Output Link' : 'Copy Generation Details';
  const actions: (ItemAction | false | undefined)[] = [
    done && canShareFiles && { id: 'share', label: 'Share', Icon: Share, run: () => { void shareItem(item, handlers.showToast); } },
    Boolean(item.url) && item.status !== 'pending' && { id: 'download', label: 'Download', short: 'Save', tip: upscaled ? 'Download the Upscale' : 'Download', Icon: Download, href: downloadUrl(item), run: () => downloadItem(item) },
    item.status !== 'pending' && {
      id: 'copyItem', label: copyLabel, Icon: Copy,
      copy: () => handlers.copyItem(item),
      run: () => { void handlers.copyItem(item).then((copied) => { if (copied) handlers.showToast('Copied', 'success'); }); },
    },
    canStar(item) && { id: 'star', label: item.favorite ? 'Unstar' : 'Star', Icon: Star, pressed: Boolean(item.favorite), haptic: 'tap', run: () => handlers.star(item) },
    handlers.smartUpscale && canUpscaleItem(item) && {
      id: 'upscale', label: upscaleLabel(item), Icon: UpscaleArrow, pressed: item.upscale?.url ? Boolean(item.upscaleActive) : undefined,
      run: () => (item.upscale?.status === 'running' ? handlers.cancelUpscale(item) : handlers.upscale(item)),
    },
    extras.compare && item.type === 'image' && Boolean(item.upscale?.url) && !upscaledWithRun(item) && {
      id: 'compare', label: 'Compare', tip: extras.compare.open ? 'Hide the Comparison' : 'Compare with the Original', Icon: Columns2, pressed: extras.compare.open, haptic: 'tap', run: extras.compare.toggle,
    },
    Boolean(item.prompt) && { id: 'reuse', label: 'Use This Prompt', Icon: Wand2, run: () => handlers.reuse(item) },
    Boolean(item.prompt) && {
      id: 'copyPrompt', label: 'Copy Prompt', Icon: Copy,
      copy: () => handlers.copyPrompt(item),
      run: () => { void handlers.copyPrompt(item, 'Prompt copied'); },
    },
    Boolean(item.prompt) && { id: 'promptsOnly', label: 'Prompts Only', Icon: TextQuote, run: () => handlers.promptsOnly(item) },
    handlers.animate && canAnimatePhoto(item) && { id: 'animate', label: 'Animate', Icon: Video, run: () => handlers.animate!(item) },
    handlers.animate && canExtendVideo(item) && { id: 'extend', label: 'Extend Video', short: 'Extend', Icon: FastForward, run: () => handlers.animate!(item) },
    done && handlers.useAsReference && item.type === 'image' && !item.vaultLocked && !item.library && {
      id: 'reference', label: 'Use as Reference', tip: 'Use as Reference Image', Icon: ImagePlus, run: () => handlers.useAsReference!(item),
    },
    done && !item.library && (item.privateVault
      ? { id: 'move', label: 'Move to Gallery', short: 'Unhide', Icon: Eye, run: () => handlers.unhide(item) }
      : { id: 'move', label: 'Move to Hidden', short: 'Hide', Icon: EyeOff, run: () => handlers.hide(item) }),
    extras.select && (item.status === 'done' || item.status === 'error') && { id: 'select', label: 'Select', Icon: CheckCircle2, run: () => extras.select!(item) },
    item.status !== 'pending' && {
      id: 'delete', label: item.library ? 'Remove' : 'Delete', tip: item.privateVault ? 'Delete from Hidden' : item.library ? 'Remove from Gallery' : 'Delete from Gallery',
      Icon: Trash2, danger: true, haptic: 'warning', run: () => handlers.remove(item),
    },
  ];
  return actions.filter((action): action is ItemAction => Boolean(action) && placement[(action as ItemAction).id].includes(surface));
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
