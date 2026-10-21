import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { tweens } from '@/lib/springs';
import { popoverMotion, useSettling } from './composerSurface';
import { AlertTriangle, CheckSquare, X } from 'lucide-react';
import { GallerySelectionContext, type GallerySelection } from './gallerySelection';
import { bulkItemActions, useItemActionHandlers, useItemActions, type ItemAction } from './itemActions';
import { ActionIcon, startsGroup } from './ItemActionSurfaces';
import { useDismiss } from './useDismiss';
import { Tip } from './components';
import type { GalleryItem } from './types';

export function GalleryManagement({ children, modeSelector, search, selection, showToolbar = true, status, tools }: {
  children: React.ReactNode;
  /** The status pill's message host: the top bar is where desktop messages show. */
  status?: React.ReactNode;
  modeSelector: React.ReactNode;
  search: React.ReactNode;
  selection: GallerySelection;
  showToolbar?: boolean;
  tools?: React.ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const menuSettling = useSettling();
  const [menu, setMenu] = useState<{ item: GalleryItem; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuOpener = useRef<HTMLElement | null>(null);
  const handlers = useItemActionHandlers();
  const { selecting, selectedItems: selected, selectable } = selection;
  const closeMenu = useCallback(() => {
    if (menuRef.current?.contains(document.activeElement)) menuOpener.current?.focus({ preventScroll: true });
    setMenu(null);
  }, []);
  useDismiss(menuRef, Boolean(menu), closeMenu);
  // Polls and filters can remove items; never act on an invisible one.
  useEffect(() => {
    if (menu && !selectable.some((item) => item.id === menu.item.id)) setMenu(null);
  }, [selectable]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!menu) return;
    const root = menuRef.current;
    if (root) {
      // Layout sizes: the entry's scale must not shrink what is measured.
      const bounds = { width: root.offsetWidth, height: root.offsetHeight };
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
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || menu || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const inGallery = Boolean(target?.closest('.gallery, .gallery-management'));
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && (selecting || inGallery)) {
        event.preventDefault(); selection.selectAll();
      } else if (selecting && event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); selection.end();
      } else if (selecting && selected.length && event.key === 'Delete') {
        event.preventDefault(); void handlers?.removeItems(selected);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });
  const targets = menu ? (selection.selected.has(menu.item.id) ? selected : [selectable.find((item) => item.id === menu.item.id) || menu.item]) : selected;
  const act = (action: () => void) => { closeMenu(); action(); };
  const selectFromMenu = (item: GalleryItem) => selection.start([...selection.selected, item.id]);
  // One item has the full list of item actions; several share the bulk ones.
  const single = menu && targets.length === 1 ? targets[0] : null;
  const singleActions = useItemActions(single, 'menu', { select: selectFromMenu });
  const bulkActions = handlers ? bulkItemActions(targets, handlers) : [];
  // Several items: bulk wording ("Animate Selected") in names and menu rows.
  const actionButton = (action: ItemAction, inMenu: boolean, divider = false, bulk = true) => (
    <React.Fragment key={action.id}>
      {divider ? <span className={inMenu ? 'gallery-menu-divider' : 'gallery-selection-divider'} role={inMenu ? 'separator' : undefined} aria-hidden={inMenu ? undefined : true} /> : null}
      {inMenu ? <button type="button" role={inMenu ? 'menuitem' : undefined} className={action.danger ? 'is-danger' : undefined} aria-label={inMenu ? undefined : bulk ? action.tip || action.label : action.label} disabled={action.disabled} onClick={() => act(action.run)}><ActionIcon action={action} size={16} />{inMenu && bulk ? action.tip || action.label : action.label}</button> : <Tip content={action.tip || action.label}><button type="button" role={inMenu ? 'menuitem' : undefined} className={action.danger ? 'is-danger' : undefined} aria-label={inMenu ? undefined : bulk ? action.tip || action.label : action.label} disabled={action.disabled} onClick={() => act(action.run)}><ActionIcon action={action} size={16} />{inMenu && bulk ? action.tip || action.label : action.label}</button></Tip>}
    </React.Fragment>
  );
  const menuSelection = React.useMemo<GallerySelection>(() => ({
    ...selection,
    menu: (item, event) => {
      // Shift-right-click keeps the browser’s Save/Copy Image menu available.
      if (event.type === 'contextmenu' && event.shiftKey) return;
      if (item.status !== 'done' && item.status !== 'error') return;
      event.preventDefault();
      menuOpener.current = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
      menuOpener.current?.focus({ preventScroll: true });
      const bounds = event.currentTarget.getBoundingClientRect();
      setMenu({ item, x: ('clientX' in event && event.clientX) || bounds.left, y: ('clientY' in event && event.clientY) || bounds.top });
    }
  }), [selection]);
  return <GallerySelectionContext.Provider value={menuSelection}>
    {showToolbar ? <header className="gallery-toolbar">{search}{modeSelector}<div className="gallery-toolbar-actions">{status}{tools}<div className={selecting ? "gallery-management is-selecting" : "gallery-management"} role="group" aria-label="Gallery Management">
      <Tip content={selecting ? "Stop Selecting" : "Select · Ctrl/Cmd-Click, Shift-Click a Range"}><button type="button" className="gallery-select-toggle" aria-label={selecting ? 'Stop Selecting' : 'Select'} aria-expanded={selecting} onClick={() => selecting ? selection.end() : selection.start()}>{selecting ? <X size={16} /> : <CheckSquare size={16} />}<span role={selecting ? 'status' : undefined}>{selecting ? `${selected.length} Selected` : 'Select'}</span></button></Tip>
      <AnimatePresence initial={false}>{selecting ? <motion.div className="gallery-selection-actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0 } }} transition={reducedMotion ? { duration: 0 } : tweens.fast}>
        <Tip content={selection.allSelected ? 'Select None' : 'Select All Loaded'}><button type="button" aria-label={selection.allSelected ? 'Select None' : 'Select All'} onClick={selection.toggleAll}><CheckSquare size={16} />{selection.allSelected ? 'Select None' : 'Select All'}</button></Tip>
        {selection.failedCount ? <Tip content={"Select Failed"}><button type="button" aria-label="Select Failed" onClick={selection.selectFailed}><AlertTriangle size={16} />Select Failed</button></Tip> : null}
        <span className="gallery-selection-divider" aria-hidden="true" />
        {bulkActions.map((action, index) => actionButton(action, false, startsGroup(bulkActions, index)))}
      </motion.div> : null}</AnimatePresence>
    </div></div></header> : null}
    {children}
    {menu ? createPortal(<motion.div ref={menuRef} className="gallery-context-menu" role="menu" aria-label={targets.length > 1 ? `${targets.length} Selected Items` : 'Item Actions'} style={{ left: menu.x, top: menu.y, transformOrigin: 'top left' }} initial={popoverMotion.initial} animate={popoverMotion.animate} {...menuSettling} onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus({ preventScroll: true });
      } else if (event.key === 'Tab') closeMenu();
    }}>
      {single ? null : <p className="gallery-menu-title" aria-hidden="true">{targets.length} Selected</p>}
      {(single ? singleActions : bulkActions).map((action, index, list) => actionButton(action, true, startsGroup(list, index), !single))}
    </motion.div>, document.body) : null}
  </GallerySelectionContext.Provider>;
}
