import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckSquare, Copy, Download, Eye, EyeOff, Star, Trash2, X } from 'lucide-react';
import { canStar, useStar } from './favorites';
import { GallerySelectionContext } from './gallerySelection';
import { useHiddenActions } from './hiddenContext';
import { downloadItems } from './PhoneStudio';
import { useDismiss } from './useDismiss';
import type { GalleryItem } from './types';
import type { ShowToast } from './toast';

export function GalleryManagement({ children, items, onDelete, onCopy, showToast }: {
  children: React.ReactNode;
  items: GalleryItem[];
  onDelete: (items: GalleryItem[]) => Promise<unknown>;
  onCopy: (item: GalleryItem) => void;
  showToast: ShowToast;
}) {
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [menu, setMenu] = useState<{ item: GalleryItem; x: number; y: number } | null>(null);
  const anchor = useRef<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuOpener = useRef<HTMLElement | null>(null);
  const star = useStar();
  const hidden = useHiddenActions();
  const selectable = items.filter((item) => item.status === 'done' || item.status === 'error');
  const selected = selectable.filter((item) => selection?.has(item.id));
  const closeMenu = useCallback(() => {
    if (menuRef.current?.contains(document.activeElement)) menuOpener.current?.focus({ preventScroll: true });
    setMenu(null);
  }, []);
  useDismiss(menuRef, Boolean(menu), closeMenu);
  // Polls and filters can remove selected items; never act on an invisible item.
  useEffect(() => {
    const ids = new Set(selectable.map((item) => item.id));
    setSelection((current) => current && [...current].some((id) => !ids.has(id)) ? new Set([...current].filter((id) => ids.has(id))) : current);
    if (menu && !ids.has(menu.item.id)) setMenu(null);
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!menu) return;
    const root = menuRef.current;
    if (root) {
      const bounds = root.getBoundingClientRect();
      root.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - bounds.width - 8))}px`;
      root.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - bounds.height - 8))}px`;
      root.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    }
    const dismiss = () => setMenu(null);
    window.addEventListener('resize', dismiss);
    // Layout anchoring also emits scroll events; dismiss on scroll gestures instead.
    window.addEventListener('wheel', dismiss, { passive: true });
    window.addEventListener('touchmove', dismiss, { passive: true });
    return () => {
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('wheel', dismiss);
      window.removeEventListener('touchmove', dismiss);
    };
  }, [menu]);
  const all = () => setSelection(new Set(selectable.map((item) => item.id)));
  const end = () => { setSelection(null); anchor.current = null; };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || menu || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const inGallery = Boolean(target?.closest('.gallery, .gallery-management'));
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && (selection || inGallery)) {
        event.preventDefault(); all();
      } else if (selection && event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); end();
      } else if (selection && selected.length && event.key === 'Delete') {
        event.preventDefault(); void onDelete(selected);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });
  const targets = menu ? (selection?.has(menu.item.id) ? selected : [items.find((item) => item.id === menu.item.id) || menu.item]) : selected;
  const ready = targets.filter((item) => item.status === 'done' && item.url);
  const movable = ready.filter((item) => !item.library);
  const starred = targets.filter(canStar);
  const allStarred = starred.length > 0 && starred.every((item) => item.favorite);
  const act = (action: () => void) => { closeMenu(); action(); };
  const actions = (inMenu: boolean) => <>
    <button type="button" role={inMenu ? 'menuitem' : undefined} disabled={!ready.length} onClick={() => act(() => { void downloadItems(ready, showToast); })}><Download size={16} />Download</button>
    {star ? <button type="button" role={inMenu ? 'menuitem' : undefined} disabled={!starred.length} onClick={() => act(() => star(starred, !allStarred))}><Star size={16} />{allStarred ? 'Unstar' : 'Star'}</button> : null}
    {hidden ? <button type="button" role={inMenu ? 'menuitem' : undefined} disabled={!movable.length} onClick={() => act(() => hidden.space === 'hidden' ? hidden.unhide(movable) : hidden.hide(movable))}>{hidden.space === 'hidden' ? <Eye size={16} /> : <EyeOff size={16} />}{hidden.space === 'hidden' ? 'Move To Gallery' : 'Move To Hidden'}</button> : null}
    <button type="button" role={inMenu ? 'menuitem' : undefined} className="is-danger" disabled={!targets.length} onClick={() => act(() => { void onDelete(targets); })}><Trash2 size={16} />{targets.length > 0 && targets.every((item) => item.library) ? 'Remove' : 'Delete'}</button>
  </>;
  const context = React.useMemo<NonNullable<React.ContextType<typeof GallerySelectionContext>>>(() => ({
    selecting: selection !== null,
    selected: selection || new Set(),
    click: (item, event) => {
      if (!selection && !event.ctrlKey && !event.metaKey && !event.shiftKey) { anchor.current = item.id; return false; }
      if (!selectable.some((entry) => entry.id === item.id)) return true;
      const from = selectable.findIndex((entry) => entry.id === anchor.current);
      const to = selectable.findIndex((entry) => entry.id === item.id);
      setSelection((current) => {
        const next = new Set(current || []);
        if (event.shiftKey && from >= 0) selectable.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((entry) => next.add(entry.id));
        else if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
        return next;
      });
      if (!event.shiftKey || from < 0) anchor.current = item.id;
      return true;
    },
    menu: (item, event) => {
      if (item.status !== 'done' && item.status !== 'error') return;
      event.preventDefault();
      menuOpener.current = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
      menuOpener.current?.focus({ preventScroll: true });
      const bounds = event.currentTarget.getBoundingClientRect();
      setMenu({ item, x: ('clientX' in event && event.clientX) || bounds.left, y: ('clientY' in event && event.clientY) || bounds.top });
    }
  }), [items, selection]); // eslint-disable-line react-hooks/exhaustive-deps
  return <GallerySelectionContext.Provider value={context}>
    {selectable.length || selection ? <div className="gallery-management" role="group" aria-label="Gallery Management">
      {selection ? <>
        <span role="status">{selected.length} Selected</span>
        <button type="button" onClick={() => selected.length === selectable.length ? setSelection(new Set()) : all()}>{selected.length === selectable.length && selectable.length ? 'Deselect All' : 'Select All Loaded'}</button>
        {actions(false)}
        <button type="button" aria-label="Stop Selecting" onClick={end}><X size={16} /></button>
      </> : <button type="button" title="Ctrl/Cmd-click to select; Shift-click to select a range" onClick={() => setSelection(new Set())}><CheckSquare size={16} />Select</button>}
    </div> : null}
    {children}
    {menu ? createPortal(<div ref={menuRef} className="gallery-context-menu" role="menu" aria-label={targets.length > 1 ? `${targets.length} Selected Items` : 'Item Actions'} style={{ left: menu.x, top: menu.y }} onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus({ preventScroll: true });
      } else if (event.key === 'Tab') closeMenu();
    }}>
      <button type="button" role="menuitem" onClick={() => act(() => { setSelection((current) => new Set([...(current || []), menu.item.id])); anchor.current = menu.item.id; })}><CheckSquare size={16} />Select</button>
      {targets.length === 1 && menu.item.prompt ? <button type="button" role="menuitem" onClick={() => act(() => onCopy(menu.item))}><Copy size={16} />Copy Prompt</button> : null}
      {actions(true)}
    </div>, document.body) : null}
  </GallerySelectionContext.Provider>;
}
