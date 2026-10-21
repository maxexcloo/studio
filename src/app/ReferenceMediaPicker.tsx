import React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useIsPresent } from "framer-motion";
import { ArrowDown, ArrowUp, Brush, Check, GripVertical, Image as ImageIcon, ImagePlus, Images, ListChecks, LoaderCircle, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { cn } from "./format";
import { SurfaceStatus } from "./StatusMessage";
import { Tip } from "./components";
import { EmptyState } from "./EmptyState";
import { useDismiss } from "./useDismiss";
import { surfaceMotion, useComposerSurfaceBox, useSettling } from "./composerSurface";
import { deleteReferenceAsset, listReferenceAssets, referenceAssetFromGallery, uploadReferenceAsset } from "./api";
import type { MediaInput, ReferenceAsset, ReferenceInpaint, ReferenceRoleControl, SelectedReferenceAsset } from "./types";
import { ReferenceGrid } from "./ReferenceGrid";
import { SafeImg } from './SafeImg';
import { showToastTone } from './toast';
import { usePhoneLayer } from './phoneLayers';
import { PickerTools } from './PickerTools';
import { ClearSelection } from './SheetList';
import { useReorderDrag } from './useReorderDrag';

const InpaintStudio = React.lazy(() => import("./InpaintStudio").then((module) => ({ default: module.InpaintStudio })));

/** Where pictures come from; Selected reviews what is picked. */
type SourceTab = "generation" | "upload";
type PickerTab = SourceTab | "selected";

// Files dragged from Windows Explorer can arrive with an empty type (often
// .webp and .avif): fall back to the extension. The server sniffs the bytes.
const IMAGE_EXTENSION = /\.(png|jpe?g|webp|avif|gif|bmp)$/i;
const isImageFile = (file: File) => file.type.startsWith("image/") || (!file.type && IMAGE_EXTENSION.test(file.name));

type PageState = {
  items: ReferenceAsset[];
  cursor: string;
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
  error: string;
};

const emptyPage = (): PageState => ({ items: [], cursor: "", hasMore: false, loading: false, loaded: false, error: "" });
type PickerMemory = { tab?: SourceTab; query: string; pages: Record<SourceTab, PageState>; scroll: Record<SourceTab, number> };
const pickerMemory = (): PickerMemory => ({ query: '', pages: { generation: emptyPage(), upload: emptyPage() }, scroll: { generation: 0, upload: 0 } });

function assetImage(asset: ReferenceAsset) {
  return asset.thumbnailUrl || asset.url || "";
}

/* --------------------------------------------------------------- Popover */

/**
 * The reference chooser as a popover that rises out of the composer (a sheet
 * on the phone): recent generations and uploads in a grid, an upload button,
 * drop and paste. It picks several at once, up to the model's limit; tapping a
 * picked image takes it off again, and Selected n/max reviews, reorders and
 * removes what is picked.
 */
function ReferencePopover({ memory, input, selected, max, atCapacity, onDeselect, onClearAll, onMove, anchor, popRef, dropActive, dropped, onClose, onSelect, onDeleted, confirmDelete, onError, upload }: {
  memory: PickerMemory;
  input: MediaInput;
  anchor: HTMLElement | null;
  popRef: React.RefObject<HTMLDivElement | null>;
  dropActive: boolean;
  dropped: { asset: ReferenceAsset; nonce: number } | null;
  /** What is picked for these slots, in slot order. */
  selected: ReferenceAsset[];
  /** How many these slots take. */
  max: number;
  atCapacity: boolean;
  onDeselect: (asset: ReferenceAsset) => void;
  onClearAll?: () => void;
  /** Swaps the picture at `from` with the one at `to`, in slot order. */
  onMove: (from: number, to: number) => void;
  onClose: () => void;
  onSelect: (asset: ReferenceAsset) => void;
  /** An upload was deleted for good: whichever slots hold it let it go. */
  onDeleted: (asset: ReferenceAsset) => void;
  confirmDelete?: (asset: ReferenceAsset) => Promise<boolean>;
  onError?: (message: string) => void;
  upload: { busy: boolean; progress: number; multiple: boolean; start: (files: File[]) => Promise<ReferenceAsset | null> };
}) {
  const present = useIsPresent();
  const [tab, setTab] = React.useState<PickerTab>(() => memory.tab || "generation");
  const selectedListRef = React.useRef<HTMLOListElement>(null);
  const reorder = useReorderDrag(selected.map((asset) => asset.id), onMove, selectedListRef);
  // The source shown under Selected's review, and the one a search runs in.
  const source: SourceTab = tab === "selected" ? memory.tab || "generation" : tab;
  const [pages, setPages] = React.useState<Record<SourceTab, PageState>>(() => memory.pages);
  const [selectingId, setSelectingId] = React.useState("");
  const active = React.useRef(true);
  React.useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [search, setSearch] = React.useState(memory.query);
  const [query, setQuery] = React.useState(memory.query);
  const previousQuery = React.useRef(query);
  const restoreTab = React.useRef<PickerTab | null>(tab);
  const multiple = max > 1;
  const searchRef = React.useRef<HTMLInputElement>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const pageErrorRef = React.useRef<HTMLDivElement>(null);
  const moreRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 180);
    return () => window.clearTimeout(timer);
  }, [search]);
  const uploadInput = React.useRef<HTMLInputElement>(null);
  const typeSearch = React.useCallback((key: string) => setSearch((value) => value + key), []);
  const label = (input.label || "Reference Image").toLowerCase();
  const [newId, setNewId] = React.useState("");

  // Pinned above the prompt bar. It lives in <body>, not inside the bar, because
  // the bar's own backdrop blur would stop this one from blurring the gallery.
  // On the phone it anchors to the References row it opened from, like the other pop-ups over Create.
  const [opener] = React.useState(() => document.querySelector<HTMLElement>(`[data-reference-slot="${CSS.escape(input.id)}"], [data-reference-chain~="${CSS.escape(input.id)}"]`) || (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const { box, onPhone } = useComposerSurfaceBox(anchor, opener);
  // On the phone it pops up over the Create sheet, which stays in view behind it.
  usePhoneLayer(Boolean(onPhone && present), 'pop');
  React.useEffect(() => {
    if (!box) return;
    // The popover takes focus, so no keyboard pops up on the phone; typing opens search (PickerTools).
    popRef.current?.focus({ preventScroll: true });
  }, [Boolean(box)]);

  // Dragging a file over the popover means "add to my uploads".
  React.useEffect(() => { if (dropActive) setTab("upload"); }, [dropActive]);
  React.useEffect(() => {
    if (!dropped) return;
    setTab("upload");
    setNewId(dropped.asset.id);
    // Not marked loaded: the rest of the uploads still have to come from the server.
    setPages((current) => ({ ...current, upload: { ...current.upload, items: [dropped.asset, ...current.upload.items.filter((item) => item.id !== dropped.asset.id)] } }));
  }, [dropped]);

  const requests = React.useRef(new Map<SourceTab, AbortController>());
  React.useEffect(() => () => { requests.current.forEach((request) => request.abort()); requests.current.clear(); }, []);
  const load = React.useCallback(async (target: SourceTab, cursor = "", refresh = false) => {
    if (requests.current.has(target)) return;
    const controller = new AbortController();
    requests.current.set(target, controller);
    // Safari before 17.4 has no AbortSignal.any; a timer covers the same ground.
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setPages((current) => ({ ...current, [target]: { ...current[target], loading: true, error: "" } }));
    try {
      const page = await listReferenceAssets(target, cursor, 60, controller.signal, query);
      if (requests.current.get(target) !== controller) return;
      setPages((current) => ({
        ...current,
        [target]: {
          // A page arriving twice (a retry, a cursor that has not moved) must not repeat a tile.
          items: [...new Map((refresh && page.nextCursor ? [...(page.items || []), ...current[target].items] : [...(cursor ? current[target].items : []), ...(page.items || [])]).map((item) => [item.id, item])).values()],
          cursor: refresh && page.nextCursor && current[target].items.length > 60 ? current[target].cursor : page.nextCursor || "",
          hasMore: refresh && page.nextCursor && current[target].items.length > 60 ? current[target].hasMore : Boolean(page.nextCursor && page.nextCursor !== cursor),
          loading: false,
          loaded: true,
          error: ""
        }
      }));
    } catch (error) {
      if (requests.current.get(target) !== controller) return;
      const aborted = error instanceof Error && error.name === "AbortError";
      setPages((current) => ({ ...current, [target]: { ...current[target], loading: false, loaded: true, error: aborted ? "The list took too long to load. Try again." : error instanceof Error ? error.message : "Couldn’t load images" } }));
    } finally {
      window.clearTimeout(timeout);
      if (requests.current.get(target) === controller) requests.current.delete(target);
    }
  }, [query]);

  React.useEffect(() => {
    if (previousQuery.current === query) return;
    previousQuery.current = query;
    memory.scroll = { generation: 0, upload: 0 };
    restoreTab.current = tab;
    requests.current.forEach((request) => request.abort());
    requests.current.clear();
    setPages({ generation: emptyPage(), upload: emptyPage() });
    bodyRef.current?.scrollTo({ top: 0 });
  }, [query]);
  React.useLayoutEffect(() => {
    if (tab !== "selected") memory.tab = tab;
    memory.query = query;
    memory.pages = Object.fromEntries(Object.entries(pages).map(([key, page]) => [key, { ...page, loading: false }])) as PickerMemory['pages'];
  }, [memory, pages, query, tab]);
  React.useLayoutEffect(() => {
    if (!box || restoreTab.current !== tab || tab === "selected") return;
    let secondFrame = 0;
    const frame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(() => {
      bodyRef.current?.scrollTo({ top: memory.scroll[tab], behavior: 'instant' });
      restoreTab.current = null;
    }); });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(secondFrame); };
  }, [Boolean(box), memory, pages[source].items.length, tab]);
  const changeTab = (next: PickerTab) => { if (next === tab) return; restoreTab.current = next; setTab(next); };
  React.useEffect(() => {
    // Refresh the newest page when reopening, while retaining loaded rows and their position.
    if (memory.pages[source].loaded && !memory.pages[source].error) void load(source, '', true);
  }, []);
  // Nothing left to review: back to where the pictures come from.
  React.useEffect(() => { if (tab === "selected" && !selected.length) setTab(source); }, [selected.length, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (pages[source].loaded || pages[source].loading) return;
    load(source);
  }, [load, pages, source]);

  const uploadAndUse = async (files: File[]) => {
    const asset = await upload.start(files);
    if (!asset) return;
    setPages((current) => ({ ...current, upload: { ...current.upload, items: [asset, ...current.upload.items.filter((item) => item.id !== asset.id)] } }));
    // Picking several: stay open for the rest.
    if (!multiple) onClose();
  };

  async function choose(asset: ReferenceAsset) {
    if (selectingId || upload.busy) return;
    if (selected.some(item => item.id === asset.id)) { onDeselect(asset); return; }
    if (atCapacity) { showToastTone(fullMessage(max), "default"); return; }
    setSelectingId(asset.id);
    try {
      const resolved = asset.source === "generation" && asset.galleryItemId ? await referenceAssetFromGallery(asset.galleryItemId) : asset;
      if (!active.current) return;
      onSelect(resolved);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "Couldn’t use this image");
    } finally {
      setSelectingId("");
    }
  }

  async function removeUpload(event: React.MouseEvent, asset: ReferenceAsset) {
    event.preventDefault();
    event.stopPropagation();
    try {
      if (confirmDelete && !await confirmDelete(asset)) return;
      await deleteReferenceAsset(asset.id);
      setPages((current) => ({ ...current, upload: { ...current.upload, items: current.upload.items.filter((item) => item.id !== asset.id) } }));
      onDeleted(asset);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "Couldn’t delete the upload");
    }
  }

  const page = pages[source];
  // Picked images keep their place in the list (the number shows the pick); ones
  // from another tab or outside this page's results follow at the end.
  const items = [...new Map([...page.items, ...selected].map(asset => [asset.id, asset])).values()];
  React.useEffect(() => {
    if (!page.hasMore || page.loading || page.error || search.trim() !== query || !moreRef.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) load(source, page.cursor);
    }, { root: bodyRef.current, rootMargin: '120px' });
    observer.observe(moreRef.current);
    return () => observer.disconnect();
  }, [load, page.cursor, page.error, page.hasMore, page.loading, query, search, source, tab]);
  React.useEffect(() => {
    if (page.error) pageErrorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [page.error, tab]);
  const settling = useSettling();
  if (!box) return null;
  // In the phone studio it pops up over the Create sheet, anchored to the References row.
  // An exiting picker must not intercept Escape intended for the next overlay.
  return createPortal(
    <motion.div
      ref={popRef}
      className={cn("reference-popover", dropActive && "is-drop-target", onPhone && "is-pop")}
      style={box}
      role={present ? "dialog" : undefined}
      aria-hidden={!present || undefined}
      inert={!present}
      aria-label={multiple ? "Choose References" : `Choose ${label}`}
      aria-busy={upload.busy || Boolean(selectingId) || undefined}
      tabIndex={-1}
      data-open-surface
      {...surfaceMotion}
      {...settling}
    >
      {/* The chooser pattern (UI-PATTERNS › Pickers): a title bar, then the tabs with Clear Selection, then search. */}
      <header className="reference-popover-head">
        <strong className="picker-title"><ImagePlus size={16} aria-hidden="true" />{multiple ? "References" : input.label || "Reference Image"}</strong>
        <span className={cn("reference-popover-hint", atCapacity && "is-full")} role={atCapacity ? "status" : undefined}>{atCapacity ? (multiple ? "All picked · tap one to take it off" : "Tap it to take it off, then pick another") : multiple ? `Pick up to ${max} · drop or paste on the prompt` : "Drop or paste an image anywhere on the prompt"}</span>
        <button type="button" className="btn is-primary reference-upload" aria-label={upload.busy ? `Uploading ${upload.progress || 0}%` : "Upload"} onClick={() => uploadInput.current?.click()} disabled={upload.busy}>
          {upload.busy ? <LoaderCircle className="spin" size={14} /> : <Upload size={14} />}
          <span>{upload.busy ? `${upload.progress || 0}%` : "Upload"}</span>
        </button>
        {onPhone ? <SurfaceStatus active={present} /> : null}
        <input ref={uploadInput} hidden type="file" multiple={upload.multiple} accept="image/*" onChange={(event) => { uploadAndUse(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} />
        <Tip content="Close (Esc)"><button type="button" className="reference-popover-close" aria-label="Close References" onClick={onClose}><X size={15} /></button></Tip>
      </header>
      <PickerTools query={search} onClearSearch={() => setSearch('')} onType={typeSearch} searchLabel={tab === 'upload' ? 'Search Uploads' : 'Search Library'}
        clear={multiple && selected.length > 0 && onClearAll ? <ClearSelection onClick={onClearAll} /> : null}
        search={tab !== 'selected' ? (<div className="reference-search picker-search">
        <Search size={15} aria-hidden="true" />
        <input ref={searchRef} type="search" aria-label={tab === "upload" ? "Search Uploads" : "Search Library"} placeholder={tab === "upload" ? "Search Uploads" : "Search Library"} value={search} onChange={(event) => setSearch(event.target.value)} />
        {search ? <button type="button" aria-label="Clear Reference Search" onClick={() => { setSearch(''); searchRef.current?.focus({ preventScroll: true }); }}><X size={14} /></button> : null}
      </div>) : undefined}>
        <div className="reference-tabs" role="tablist" aria-label="Reference Image Sources">
          <button role="tab" aria-selected={tab === "generation"} className={cn(tab === "generation" && "active")} onClick={() => changeTab("generation")}><Images size={14} /> Library</button>
          <button role="tab" aria-selected={tab === "upload"} className={cn(tab === "upload" && "active")} onClick={() => changeTab("upload")}><ImageIcon size={14} /> Uploads</button>
          {multiple ? <button role="tab" aria-selected={tab === "selected"} aria-label={`Selected ${selected.length} of ${max}`} className={cn("reference-selected-tab", tab === "selected" && "active", atCapacity && "is-full")} disabled={!selected.length} onClick={() => changeTab("selected")}><ListChecks size={14} /> Selected <em>{selected.length}/{max}</em></button> : null}
        </div>
      </PickerTools>
      <div ref={bodyRef} className="reference-popover-body" onScroll={(event) => { if (restoreTab.current === null && tab !== "selected") memory.scroll[tab] = event.currentTarget.scrollTop; }} role="tabpanel" aria-busy={page.loading || search.trim() !== query}>
        {tab === "selected" && !selected.length ? (
          <EmptyState title="Nothing Selected">Pick images from Library or Uploads.</EmptyState>
        ) : tab === "selected" ? (
          <ol ref={selectedListRef} className="reference-selected-list" aria-label="Selected References">
            {selected.map((asset, index) => (
              <li key={asset.id} data-reorder-key={asset.id} className={cn("reference-selected-row", reorder.rowState(asset.id).dragging && "is-dragging", reorder.rowState(asset.id).over && "is-drop-target")}>
                {selected.length > 1 ? <button type="button" className="picker-grip" aria-label={`Drag ${referenceName(asset.name)} to Reorder`} {...reorder.grip(asset.id)}><GripVertical size={14} /></button> : null}
                <span className="reference-selected-number" aria-hidden="true">{index + 1}</span>
                <span className="reference-selected-thumb"><SafeImg src={assetImage(asset)} draggable={false} fallback={<ImageIcon size={16} />} /></span>
                <span className="reference-selected-name" title={asset.name}>{referenceName(asset.name)}</span>
                <span className="reference-selected-actions">
                  <Tip content="Move Earlier"><button type="button" className="prompt-action" aria-label={`Move ${referenceName(asset.name)} Earlier`} disabled={index === 0} onClick={() => onMove(index, index - 1)}><ArrowUp size={14} /></button></Tip>
                  <Tip content="Move Later"><button type="button" className="prompt-action" aria-label={`Move ${referenceName(asset.name)} Later`} disabled={index === selected.length - 1} onClick={() => onMove(index, index + 1)}><ArrowDown size={14} /></button></Tip>
                  <Tip content="Remove"><button type="button" className="prompt-action" aria-label={`Remove ${referenceName(asset.name)}`} onClick={() => onDeselect(asset)}><X size={14} /></button></Tip>
                </span>
              </li>
            ))}
          </ol>
        ) : page.loading && !items.length ? (
          <div className="reference-grid is-loading" aria-label="Loading Images">
            {Array.from({ length: 12 }, (_, index) => <div className="reference-skeleton" key={index} />)}
          </div>
        ) : page.error && !items.length ? (
          <EmptyState title="Images Unavailable" action={<button className="btn" onClick={() => load(source)}>Try Again</button>}>{page.error}</EmptyState>
        ) : !items.length ? (
          <EmptyState title={query ? "No Matching Images" : tab === "generation" ? "No Outputs Yet" : "No Uploads Yet"}>
            {query ? "Try a different prompt or filename." : tab === "generation" ? "Finished images show up here." : "Upload one, or drop it on the prompt."}
          </EmptyState>
        ) : (
          <>
            <ReferenceGrid items={items} render={(asset, index, style, tabIndex) => {
                const isSelected = selected.some(item => item.id === asset.id);
                return (
                  <div
                    key={asset.id}
                    style={style}
                    className={cn("reference-tile", isSelected && "is-selected", asset.id === newId && "is-new")}
                  >
                    <button
                      type="button"
                      data-reference-index={index}
                      tabIndex={tabIndex}
                      className="reference-tile-select"
                      aria-pressed={isSelected}
                      aria-label={`${isSelected ? "Selected: " : ""}${asset.name}`}
                      aria-disabled={(!isSelected && atCapacity) || undefined}
                      onClick={() => choose(asset)}
                      disabled={Boolean(selectingId || upload.busy)}
                    >
                      <SafeImg src={assetImage(asset)} loading="lazy" draggable={false} fallback={<ImageIcon size={16} />} />
                      {isSelected ? <i className="reference-tile-check">{multiple ? selected.findIndex((item) => item.id === asset.id) + 1 : <Check size={12} strokeWidth={3} />}</i> : null}
                    </button>
                    {asset.source === "upload" ? <button type="button" tabIndex={tabIndex} className="reference-tile-delete" aria-label={`Delete ${asset.name}`} onClick={(event) => removeUpload(event, asset)}><Trash2 size={13} /></button> : null}
                    {selectingId === asset.id ? <span className="reference-tile-busy"><LoaderCircle className="spin" size={16} /></span> : null}
                  </div>
                );
              }} />
            {page.error ? <div ref={pageErrorRef} className="reference-page-error" role="alert"><p>{page.error}</p><button className="btn" onClick={() => load(source, page.cursor)}>Try Again</button></div> : page.hasMore ? <button ref={moreRef} className="btn is-ghost reference-more" onClick={() => load(source, page.cursor)} disabled={page.loading}>{page.loading ? "Loading…" : "Load More"}</button> : null}
          </>
        )}
      </div>
      <AnimatePresence>
        {dropActive ? (
          <motion.div key="drop" className="reference-drop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
            <DropBadge text="Drop to upload" />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>,
    document.body
  );
}

/** The shared drop affordance: an icon that lifts toward the pointer and a label. */
function DropBadge({ text }: { text: string }) {
  return (
    <div className="drop-badge">
      <span className="drop-badge-icon"><Upload size={18} /></span>
      <strong>{text}</strong>
    </div>
  );
}

/* ------------------------------------------------------------------ Slot */

/** A reference's name as shown: its file name without the extension. */
export function referenceName(name: string) {
  return name.replace(/\.[a-z0-9]{2,5}$/i, "") || name;
}

// The menu opens a beat after the pointer arrives and stays a moment after it
// leaves, so passing over the chip or wobbling off its edge never flickers it.
const hoverOpenDelay = 70;
const hoverCloseDelay = 260;
const inpaintIntroKey = "heiss-ui-inpaint-introduced";
const inpaintIntroduced = () => { try { return localStorage.getItem(inpaintIntroKey) === "1"; } catch { return true; } };
const coarsePointer = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
const noHoverQuery = "(hover: none)";
/** A screen with no hover (a phone, a tablet without a trackpad), kept live: a trackpad can come and go. The CSS's always-shown × uses the same test. */
function useNoHover() {
  const [none, setNone] = React.useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.(noHoverQuery).matches));
  React.useEffect(() => {
    const query = window.matchMedia?.(noHoverQuery);
    if (!query) return;
    const update = () => setNone(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return none;
}
const rememberInpaintIntro = () => { try { localStorage.setItem(inpaintIntroKey, "1"); } catch { /* shown again next time, which is fine */ } };

const fullMessage = (max: number) => `Up to ${max} references. Take one off to add another`;

/**
 * One reference input as a chip in the composer's top-right corner. Empty, it
 * introduces itself as "Add Reference" (or "Add Start Image" for plain
 * image-to-image). With an
 * image it becomes a large thumbnail with visible remove and paint actions.
 */
function ReferenceSlot({ input, selected, open, busy, progress, fresh, paint, role = null, onOpen, onRemove }: {
  input: MediaInput;
  selected: ReferenceAsset | null;
  open: boolean;
  busy: boolean;
  progress: number;
  fresh: boolean;
  /** Painting on this image, for a model that can inpaint: the studio's state and how to open it. */
  paint?: { masked: boolean; open: boolean; intro: boolean; hidden?: boolean; onOpen: () => void } | null;
  /** For a reference that can frame the output: edit this image, or only use it as a reference. */
  role?: ReferenceRoleControl | null;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const image = selected ? assetImage(selected) : "";
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => { setBroken(false); }, [image]);
  const required = Boolean(input.required || (input.min || 0) > 0);
  const isStart = input.role === "start";
  const [hover, setHover] = React.useState(false);
  const hoverTimer = React.useRef(0);
  React.useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  // The brush folds by its measured width: the menu sizes to its content, where CSS can't tween to "auto".
  const paintSlot = React.useRef<HTMLSpanElement>(null);
  const paintWidth = React.useRef(0);
  const paintHidden = Boolean(paint?.hidden);
  const paintWasHidden = React.useRef(paintHidden);
  React.useLayoutEffect(() => {
    const slot = paintSlot.current;
    if (!slot) return;
    const was = paintWasHidden.current;
    paintWasHidden.current = paintHidden;
    if (!paintHidden) paintWidth.current = slot.scrollWidth;
    if (was === paintHidden || !paintWidth.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const open = `${paintWidth.current}px`;
    slot.animate({ width: paintHidden ? [open, "0px"] : ["0px", open] }, { duration: 320, easing: "cubic-bezier(.16, 1, .3, 1)" });
  });
  const hoverTo = (next: boolean, event: React.PointerEvent) => {
    if (event.pointerType === "touch") return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHover(next), next ? hoverOpenDelay : hoverCloseDelay);
  };

  const label = isStart ? "Reference Image" : input.label || "Reference Image";

  if (busy) {
    return (
      <div className="ref-chip is-busy" aria-live="polite">
        <LoaderCircle className="spin" size={15} /><span>{progress ? `${progress}%` : "Uploading"}</span>
      </div>
    );
  }

  if (!selected) {
    return (
      <Tip content={`Choose a ${label}, or Drop One on the Prompt`}>
        <button
          type="button"
          data-open-trigger
          data-reference-slot={input.id}
          className={cn("ref-chip ref-add", required && "is-required", open && "is-open")}
          aria-label={isStart ? "Reference Image" : `Add ${label.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())}${required ? ", required" : ""}`}
          aria-expanded={open}
          onClick={onOpen}
        >
          <Plus size={15} strokeWidth={2.2} />
          <span className="ref-add-label"><span>{isStart ? "Reference Image" : "Add Reference"}{required ? <em aria-hidden="true">*</em> : null}</span></span>
        </button>
      </Tip>
    );
  }

  // The thumbnail is the anchor and says what the image is at rest: EDIT when it's the picture
  // being changed, a deck behind it when others come with it. The strip that grows out of it on
  // hover holds the choices (Edit | Reference, the brush) and the other references with a + for more.
  const menu = Boolean(role || paint);
  const editing = role?.value === "edit";
  const name = editing ? `Picture to Edit: ${referenceName(selected.name)}` : `${isStart ? "Start Image" : label}: ${referenceName(selected.name)}`;
  return (
    <div
      className={cn("ref-chip ref-selected", (open || paint?.open) && "is-open", hover && "is-hover", paint?.intro && "is-intro", fresh && "is-new", editing && "is-edit")}
      onPointerEnter={(event) => hoverTo(true, event)}
      onPointerLeave={(event) => hoverTo(false, event)}
    >
      {/* The menu reveals leftward from behind the thumbnail with a clip-path, so
          nothing reflows and the thumbnail never moves. */}
      {menu ? <div className="ref-menu">
        {role ? <RoleSwitch role={role} many={false} /> : null}
        {paint ? (
          // Folds away (rather than vanishing) while the image is a Ref, so the menu glides to its new width.
          <span ref={paintSlot} className={cn("ref-menu-paint-slot", paint.hidden && "is-hidden")} aria-hidden={paint.hidden || undefined}>
            {role ? <span className="ref-menu-divider" aria-hidden="true" /> : null}
            <Tip content={paint.masked ? "Change the Painted Part" : "Paint Over a Part to Change Only That"}>
              <button type="button" className={cn("ref-menu-paint", paint.masked && "is-masked", paint.open && "is-active")} aria-label={paint.masked ? "Edit the Painted Part" : "Paint the Part to Change"} aria-pressed={paint.open} tabIndex={paint.hidden ? -1 : undefined} onClick={paint.onOpen}>
                <Brush size={17} />
                <span className="ref-menu-paint-label"><span>{coarsePointer() ? "Tap" : "Click"} to inpaint</span></span>
              </button>
            </Tip>
          </span>
        ) : null}
      </div> : null}
      <Tip content={`${name} · Click to Change`}>
        <button type="button" data-open-trigger data-reference-slot={input.id} className="ref-thumb" onClick={onOpen} aria-label={`Change ${label}, Currently ${selected.name}`} aria-expanded={open}>
          {image && !broken ? <img src={image} alt="" draggable={false} onError={(event) => { if (selected.url && event.currentTarget.getAttribute("src") !== selected.url) event.currentTarget.src = selected.url; else setBroken(true); }} /> : <ImageIcon size={15} />}
        </button>
      </Tip>
      {/* Remove on the thumbnail's corner, where it's expected and far from Edit | Reference; Undo is in its toast. */}
      <Tip content={`Remove ${label.toLowerCase()}`}>
        <button type="button" className="ref-thumb-remove" aria-label={`Remove ${label.toLowerCase()}`} onClick={onRemove}><X size={10} strokeWidth={2.8} /></button>
      </Tip>
      {paint?.masked ? <i className="ref-mask-badge" aria-hidden="true"><Brush size={9} strokeWidth={2.6} /></i> : null}
      {/* The picture being edited is the one that's different from the rest: Ref leaves every image a plain reference. */}
      {role ? <i className={cn("ref-role-badge", editing && "is-on")} aria-hidden="true">EDIT</i> : null}
    </div>
  );
}

/**
 * Every slot of a model that reads several references, as one button: the
 * picked pictures as small overlapping thumbnails, "References" and n/max.
 * It opens the chooser, which picks, reorders and removes them all.
 */
function ReferenceGroupButton({ chain, assets, max, open, busy, progress, required, onOpen }: {
  chain: MediaInput[];
  assets: ReferenceAsset[];
  max: number;
  open: boolean;
  busy: boolean;
  progress: number;
  required: boolean;
  onOpen: () => void;
}) {
  const count = assets.length;
  const name = count ? `References, ${count} of ${max} Selected` : `Add References${required ? ", Required" : ""}`;
  return (
    <Tip content={count ? `${count} of ${max} · Click to Change` : `Choose up to ${max} References, or Drop Them on the Prompt`}>
      <button
        type="button"
        data-open-trigger
        data-reference-chain={chain.map((input) => input.id).join(" ")}
        className={cn("ref-chip ref-add ref-group", count > 0 && "has-items", required && !count && "is-required", open && "is-open")}
        aria-label={name}
        aria-expanded={open}
        onClick={onOpen}
      >
        {busy ? <LoaderCircle className="spin" size={15} /> : count ? (
          <span className="ref-group-thumbs" aria-hidden="true">
            {assets.slice(0, 3).map((asset) => <SafeImg key={asset.id} src={assetImage(asset)} draggable={false} fallback={<ImageIcon size={12} />} />)}
          </span>
        ) : <Plus size={15} strokeWidth={2.2} />}
        <span className="ref-group-label">References{required && !count ? <em aria-hidden="true">*</em> : null}</span>
        {busy ? <span className="ref-group-count">{progress ? `${progress}%` : "…"}</span> : count ? <span className="ref-group-count">{count}/{max}</span> : null}
      </button>
    </Tip>
  );
}

/** Edit | Reference: one thumb slides between the two, like the size menu's tabs. */
export function RoleSwitch({ role, many, className }: { role: ReferenceRoleControl; many: boolean; className?: string }) {
  return (
    <div className={cn("ref-menu-role", role.value === "reference" && "is-ref", role.locked && "is-locked", className)} role="radiogroup" aria-label="What This Image Is">
      <i aria-hidden="true" />
      <Tip content={many ? "Change the first picture, at its size and framing. The others are what it can draw from" : "Change this picture: the result keeps its size and framing"}>
        <button type="button" role="radio" aria-checked={role.value === "edit"} className={cn(role.value === "edit" && "is-active")} onClick={() => role.onChange("edit")}>Edit</button>
      </Tip>
      <Tip content={role.locked ? "The painted part is changed in this picture. Clear the paint to use it as a reference" : many ? "Let them all guide a new picture, at the size you picked" : "Let it guide a new picture, at the size you picked"}>
        <button type="button" role="radio" aria-checked={role.value === "reference"} aria-disabled={role.locked || undefined} className={cn(role.value === "reference" && "is-active")} onClick={() => { if (!role.locked) role.onChange("reference"); }}>Reference</button>
      </Tip>
    </div>
  );
}

/* ----------------------------------------------------------------- Slots */

/**
 * Every reference input of the workflow, top right of the composer, plus the
 * picker popover and drop-and-paste uploads on the whole prompt bar.
 */
export function ReferenceSlots({ scope = "image", inputs, inpaint = null, role = null, selected, onSelect, onRemove, confirmDelete, onError, openRequest = 0 }: {
  scope?: string;
  /** With no slot of its own: the models that take a reference, offered in the Reference button's place. */
  /** Bumped to open the first slot's picker. */
  openRequest?: number;
  inputs: MediaInput[];
  inpaint?: ReferenceInpaint | null;
  role?: ReferenceRoleControl | null;
  selected: SelectedReferenceAsset[];
  onSelect: (slot: string, asset: ReferenceAsset) => void;
  onRemove: (slots: string | string[]) => void;
  confirmDelete?: (asset: ReferenceAsset) => Promise<boolean>;
  onError?: (message: string) => void;
}) {
  // An upload may finish after changing models or closing the phone composer.
  const context = React.useRef({ scope, revision: 0, active: true });
  if (context.current.scope !== scope) { context.current.scope = scope; context.current.revision += 1; }
  React.useEffect(() => { context.current.active = true; return () => { context.current.active = false; }; }, []);
  React.useEffect(() => { setOpenSlot(""); setPainting(false); }, [scope]);
  // After the scope's reset above, so a model switch that asked for the picker keeps it open.
  const handledOpen = React.useRef(openRequest);
  React.useEffect(() => {
    if (!openRequest || openRequest === handledOpen.current || !inputs.length) return;
    handledOpen.current = openRequest;
    setPainting(false);
    setOpenSlot(inputs.find((input) => !selected.some((item) => item.slot === input.id))?.id || inputs[0].id);
  }, [openRequest, inputs]); // eslint-disable-line react-hooks/exhaustive-deps
  const memories = React.useRef(new Map<string, PickerMemory>());
  if (!memories.current.has(scope)) memories.current.set(scope, pickerMemory());
  const memory = memories.current.get(scope)!;
  const [openSlot, setOpenSlot] = React.useState("");
  const noHover = useNoHover();
  const [uploadSlot, setUploadSlot] = React.useState("");
  const [progress, setProgress] = React.useState(0);
  const uploading = React.useRef(false);
  const [dropTarget, setDropTarget] = React.useState<"" | "prompt" | "popover">("");
  const [landing, setLanding] = React.useState(false);
  const [freshSlot, setFreshSlot] = React.useState("");
  const [dropped, setDropped] = React.useState<{ asset: ReferenceAsset; nonce: number } | null>(null);
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const slotsRef = React.useRef<HTMLDivElement>(null);
  const popRef = React.useRef<HTMLDivElement>(null);
  const overlayRef = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => {
    const restore = popRef.current?.contains(document.activeElement);
    const slot = openSlot;
    setOpenSlot("");
    if (restore) requestAnimationFrame(() => {
      if (document.activeElement !== document.body && !popRef.current?.contains(document.activeElement)) return;
      slotsRef.current?.querySelector<HTMLElement>(`[data-reference-slot="${CSS.escape(slot)}"], [data-reference-chain~="${CSS.escape(slot)}"]`)?.focus({ preventScroll: true });
    });
  }, [openSlot]);
  // A drop only belongs to the popover it landed on; forget it on close so the
  // next open keeps its own browsing state.
  React.useEffect(() => { if (!openSlot) setDropped(null); }, [openSlot]);
  useDismiss([rootRef, slotsRef, popRef], Boolean(openSlot), close);
  // The inpaint studio stays open while the prompt is typed into: the whole bar counts as inside it.
  const [painting, setPainting] = React.useState(false);
  const studioRef = React.useRef<HTMLDivElement>(null);
  const hostRef = React.useRef<HTMLElement | null>(null);
  const stopPainting = React.useCallback(() => setPainting(false), []);
  useDismiss([hostRef, studioRef], painting, stopPainting);
  React.useEffect(() => { if (!inpaint) setPainting(false); }, [inpaint]);
  const paintedAsset = inpaint ? selected.find((item) => item.slot === inpaint.slot)?.asset || null : null;
  React.useEffect(() => { setPainting(false); }, [paintedAsset?.id]);
  // Ref only guides a new picture, so there is nothing of this image to paint: Ref closes the brush studio.
  const asRef = role?.value === "reference";
  React.useEffect(() => { if (asRef) setPainting(false); }, [asRef]);
  // The first image that can be painted on shows where the brush is, once, by opening its menu for a moment.
  const [introSlot, setIntroSlot] = React.useState("");
  React.useEffect(() => {
    // Not while it's a Ref: the brush is folded away, and the one-time intro would be spent on nothing.
    if (!inpaint || !paintedAsset || asRef || inpaintIntroduced()) return;
    const start = window.setTimeout(() => setIntroSlot(inpaint.slot), 500);
    const end = window.setTimeout(() => { setIntroSlot(""); rememberInpaintIntro(); }, 3600);
    return () => { window.clearTimeout(start); window.clearTimeout(end); setIntroSlot(""); };
  }, [inpaint?.slot, paintedAsset?.id, asRef]);
  // Find the prompt bar whenever this renders into it. On first mount there may be
  // no inputs yet (the workflow is still loading), so nothing is rendered to look from.
  React.useLayoutEffect(() => {
    const next = rootRef.current?.closest<HTMLElement>(".zen-prompt, .phone-create") || null;
    hostRef.current = next;
    setHost((current) => current === next ? current : next);
  });

  const assetFor = (slot: string) => selected.find((item) => item.slot === slot)?.asset || null;
  // What's picked now, for a removal's Undo, which runs later.
  const selectedNow = React.useRef(selected);
  selectedNow.current = selected;
  // Slots that follow one another (a model that reads several references) form one chain: the
  // first is the chip, the rest its stack. Independent inputs (a custom workflow's) stand alone.
  // Edit changes one picture: no slot for another (the ones already there stay, to draw from; Ref adds more).
  const editOnly = role?.value === "edit";
  const usable = editOnly ? inputs.filter((input) => !input.follows || assetFor(input.id)) : inputs;
  // Every slot is laid out either way; what Edit leaves out folds away (Fold), so the switch glides.
  const chains: MediaInput[][] = [];
  for (const input of inputs) {
    // Start and end frames mean different things: only slots of one role share a References button.
    const chain = input.follows ? chains.find((items) => items.some((item) => item.id === input.follows) && items[0].role === input.role) : null;
    if (chain) chain.push(input); else chains.push([input]);
  }
  // A phone, or a screen without hover, shows Edit | Reference in the row: there's nothing to hover open.
  const phone = Boolean(host?.classList.contains("phone-create"));
  const inline = phone || noHover;
  // The picker open on a slot that's no longer offered (Edit, or the picture before it removed):
  // close it, so nothing lands there and a later paste doesn't reopen it.
  const usableIds = usable.map((input) => input.id).join(" ");
  React.useEffect(() => {
    if (openSlot && !usableIds.split(" ").includes(openSlot)) setOpenSlot("");
  }, [openSlot, usableIds]);

  // Explicit replacement targets win; otherwise add to the first free slot.
  const uploadFiles = React.useCallback(async (files: File[], preferred = "") => {
    if (uploading.current || !files.length) return null;
    const images = files.filter(isImageFile);
    if (!images.length) { onError?.("Choose an image file"); return null; }
    const empty = usable.filter((input) => !selected.some((item) => item.slot === input.id)).map((input) => input.id);
    const targets = preferred ? [preferred, ...empty.filter((id) => id !== preferred)] : empty;
    if (!targets.length) { onError?.("Reference slots are full · remove one or drop on a thumbnail"); return null; }
    if (images.length > targets.length) onError?.(`Room for ${targets.length} more · extra files skipped`);
    uploading.current = true;
    const revision = context.current.revision;
    const current = () => context.current.active && context.current.revision === revision;
    let latest: ReferenceAsset | null = null;
    try {
      for (const [index, file] of images.slice(0, targets.length).entries()) {
        const slot = targets[index];
        setUploadSlot(slot);
        setProgress(0);
        try {
          const asset = await uploadReferenceAsset(file, setProgress);
          if (!current() || !usableIds.split(" ").includes(slot)) return null;
          onSelect(slot, asset);
          setFreshSlot(slot);
          latest = asset;
        } catch (error) {
          onError?.(error instanceof Error ? error.message : "Couldn’t upload the image");
          // Stop so a failed predecessor cannot leave a dependent slot empty.
          break;
        }
      }
      return latest;
    } finally {
      uploading.current = false;
      setUploadSlot("");
      setProgress(0);
      window.setTimeout(() => setFreshSlot(""), 700);
    }
  }, [inputs, onError, onSelect, selected, scope]);

  /*
   * Drag and drop follows the pointer: over the open popover it offers "add to
   * uploads", over the prompt bar "use as reference", anywhere else nothing.
   * The indicator's spotlight tracks the pointer; a drop lands with a pulse.
   */
  const live = React.useRef({ uploadFiles, openSlot });
  live.current = { uploadFiles, openSlot };
  React.useEffect(() => {
    if (!host || !inputs.length) return;
    // Names aren't readable mid-drag, so an untyped file counts until the drop checks it.
    const hasImage = (event: DragEvent) => Array.from(event.dataTransfer?.items || []).some((item) => item.kind === "file" && (!item.type || item.type.startsWith("image/")));
    const targetOf = (event: DragEvent): "" | "prompt" | "popover" => {
      const node = event.target instanceof Element ? event.target : null;
      if (node?.closest(".reference-popover")) return "popover";
      if (node && host.contains(node)) return "prompt";
      return "";
    };
    const track = (event: DragEvent, target: "" | "prompt" | "popover") => {
      const surface = target === "popover" ? popRef.current : target === "prompt" ? host : null;
      const layer = target === "prompt" ? overlayRef.current : surface?.querySelector<HTMLElement>(".reference-drop");
      if (!surface || !layer) return;
      const rect = surface.getBoundingClientRect();
      layer.style.setProperty("--drop-x", `${event.clientX - rect.left}px`);
      layer.style.setProperty("--drop-y", `${event.clientY - rect.top}px`);
    };
    let clearTimer = 0;
    const over = (event: DragEvent) => {
      if (!hasImage(event)) return;
      const target = targetOf(event);
      window.clearTimeout(clearTimer);
      setDropTarget(target);
      if (!target) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      track(event, target);
    };
    // dragleave fires between children; only clear once nothing re-claims the drag.
    const leave = () => { window.clearTimeout(clearTimer); clearTimer = window.setTimeout(() => setDropTarget(""), 80); };
    const drop = (event: DragEvent) => {
      const target = targetOf(event);
      window.clearTimeout(clearTimer);
      setDropTarget("");
      const files = Array.from(event.dataTransfer?.files || []).filter(isImageFile);
      if (!files.length || !target) return;
      event.preventDefault();
      setLanding(true);
      window.setTimeout(() => setLanding(false), 520);
      const { uploadFiles: run, openSlot: open } = live.current;
      const node = event.target instanceof Element ? event.target : null;
      const explicit = node?.closest<HTMLElement>("[data-reference-slot]")?.dataset.referenceSlot || "";
      run(files, explicit || (target === "popover" ? open : "")).then((asset) => {
        if (!asset) return;
        if (target === "popover" && open) setDropped({ asset, nonce: Date.now() });
        else setOpenSlot("");
      });
    };
    const paste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files || []).filter(isImageFile);
      if (!files.length) return;
      event.preventDefault();
      live.current.uploadFiles(files);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    host.addEventListener("paste", paste);
    return () => {
      window.clearTimeout(clearTimer);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      host.removeEventListener("paste", paste);
    };
  }, [host, inputs.length]);

  // A model that takes no reference shows no References at all.
  if (!inputs.length) return null;
  const count = inputs.filter((input) => assetFor(input.id)).length;
  const revision = context.current.revision;
  const openInput = inputs.find((input) => input.id === openSlot) || null;
  // Start/end frames have distinct meanings; a reference stack shares one selection pool.
  const pickerInputs = usable.filter(input => !openInput || input.role === openInput.role);
  const openFor = (id: string) => () => { setPainting(false); setOpenSlot((current) => current === id ? "" : id); };
  // Undo puts every picture back where it was: the ones after it closed up into its slot. Only onto
  // what the removal left, though: a picture added since (or another model's slots) would be overwritten.
  const ids = (items: SelectedReferenceAsset[]) => items.map((item) => item.asset.id).join(" ");
  const removeFor = (input: MediaInput) => () => {
    const asset = assetFor(input.id);
    const before = selected.slice();
    const left = ids(before.filter((item) => item.slot !== input.id));
    onRemove(input.id);
    if (asset) showToastTone(`Removed ${(input.label || "reference image").toLowerCase()}`, "removed", { action: { label: "Undo", onClick: () => {
      if (ids(selectedNow.current) !== left) { showToastTone("The references changed since, so there’s nothing to undo", "default"); return; }
      before.forEach((item) => onSelect(item.slot, item.asset));
    } } });
  };
  const paintFor = (input: MediaInput) => inpaint && inpaint.slot === input.id && assetFor(input.id) ? {
    hidden: role?.slot === input.id && role.value === "reference",
    masked: Boolean(inpaint.mask),
    open: painting,
    intro: introSlot === input.id,
    onOpen: () => { setOpenSlot(""); setIntroSlot(""); rememberInpaintIntro(); setPainting((current) => !current); }
  } : null;
  const renderSlot = (input: MediaInput) => (
    <ReferenceSlot
      key={input.id}
      input={input}
      selected={assetFor(input.id)}
      open={openSlot === input.id}
      busy={uploadSlot === input.id}
      progress={progress}
      fresh={freshSlot === input.id}
      // Inpainting changes part of this very image, which is an edit: a Ref only guides a new picture.
      paint={paintFor(input)}
      role={role && role.slot === input.id && assetFor(input.id) ? role : null}
      onOpen={openFor(input.id)}
      onRemove={removeFor(input)}
    />
  );
  // Several slots read as one: a single References button opens the chooser on
  // the next empty one (or the first), which then fills the rest in order.
  const renderGroup = (chain: MediaInput[]) => {
    const [lead] = chain;
    const assets = chain.flatMap((input) => assetFor(input.id) || []);
    const offered = usable.filter((input) => chain.includes(input));
    const paint = paintFor(lead);
    return (
      <React.Fragment key={lead.id}>
        {paint && !paint.hidden ? (
          <Tip content={paint.masked ? "Change the Painted Part" : "Paint Over a Part to Change Only That"}>
            <button type="button" className={cn("ref-chip ref-brush", paint.masked && "is-masked", paint.open && "is-open")} aria-label={paint.masked ? "Edit the Painted Part" : "Paint the Part to Change"} aria-pressed={paint.open} onClick={paint.onOpen}><Brush size={15} /></button>
          </Tip>
        ) : null}
        <ReferenceGroupButton
          chain={chain}
          assets={assets}
          max={editOnly ? Math.max(1, assets.length) : chain.length}
          open={chain.some((input) => input.id === openSlot)}
          busy={chain.some((input) => input.id === uploadSlot)}
          progress={progress}
          required={Boolean(lead.required || (lead.min || 0) > 0)}
          onOpen={() => {
            setPainting(false);
            setOpenSlot((current) => chain.some((input) => input.id === current) ? "" : offered.find((input) => !assetFor(input.id))?.id || lead.id);
          }}
        />
      </React.Fragment>
    );
  };
  const grouped = chains.some((chain) => chain.length > 1);

  const tools = host?.querySelector(".composer-reference-tools");
  const slots = (
      <div className={cn("composer-reference-slots", inline && "is-inline")} ref={slotsRef} role="group" aria-label="Reference Images">
        {inputs.length > 1 && !grouped ? <span className="reference-count" aria-live="polite">{count}/{inputs.length} References</span> : null}
        <div className="reference-slot-list">
        {/* Without a hover strip (a group, a tablet): Edit | Reference in plain
            sight at the row's start. The phone's create sheet has its own row for it, with a line. */}
        {(inline || grouped) && !phone && role ? <RoleSwitch role={role} many={selected.length > 1} className="ref-role-chip" /> : null}
        {chains.map((chain) => chain.length > 1 ? renderGroup(chain) : renderSlot(chain[0]))}
        </div>
      </div>
  );
  return (
    <div className="composer-reference" ref={rootRef}>
      {tools ? createPortal(slots, tools) : slots}
      <AnimatePresence>
        {openInput ? (
          <ReferencePopover
            key={scope}
            memory={memory}
            input={openInput}
            selected={selected.filter(item => pickerInputs.some(input => input.id === item.slot)).map(item => item.asset)}
            max={pickerInputs.length}
            atCapacity={pickerInputs.every(input => assetFor(input.id))}
            onMove={(from, to) => {
              // Moves one picture to a new place; the ones between shift along, as in the LoRA stack.
              const filled = pickerInputs.filter((input) => assetFor(input.id));
              const assets = filled.map((input) => assetFor(input.id)!);
              const [moved] = assets.splice(from, 1);
              if (!moved) return;
              assets.splice(to, 0, moved);
              filled.forEach((input, index) => { if (assetFor(input.id)?.id !== assets[index].id) onSelect(input.id, assets[index]); });
            }}
            onClearAll={() => {
              const cleared = selected.filter(item => pickerInputs.some(input => input.id === item.slot));
              onRemove(cleared.map(item => item.slot));
              showToastTone("References cleared", "removed", { action: { label: "Undo", onClick: () => cleared.forEach((item) => onSelect(item.slot, item.asset)) } });
            }}
            onDeselect={asset => onRemove(selected.filter(item => item.asset.id === asset.id && pickerInputs.some(input => input.id === item.slot)).map(item => item.slot))}
            anchor={host}
            popRef={popRef}
            dropActive={dropTarget === "popover"}
            dropped={dropped}
            onClose={() => { if (context.current.revision === revision) close(); }}
            onSelect={(asset) => {
              if (!context.current.active || context.current.revision !== revision) return;
              const target = !assetFor(openInput.id) && pickerInputs.some(input => input.id === openInput.id) ? openInput : pickerInputs.find(input => !assetFor(input.id));
              if (target) onSelect(target.id, asset);
            }}
            onDeleted={(asset) => {
              const holding = selected.filter((item) => item.asset.id === asset.id).map((item) => item.slot);
              if (holding.length) onRemove(holding);
            }}
            confirmDelete={confirmDelete}
            onError={onError}
            upload={{ busy: Boolean(uploadSlot), progress, multiple: inputs.length > 1, start: (files) => uploadFiles(files, openInput.id) }}
          />
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {painting && inpaint && paintedAsset && host ? (
          <React.Suspense fallback={<p className="reference-opening" role="status">Opening image editor…</p>}><InpaintStudio
            key={paintedAsset.id}
            anchor={host}
            asset={paintedAsset}
            mask={inpaint.mask}
            popRef={studioRef}
            onChange={inpaint.onChange}
            onClose={stopPainting}
          /></React.Suspense>
        ) : null}
      </AnimatePresence>
      <div ref={overlayRef} className={cn("composer-drop", dropTarget === "prompt" && "is-active", landing && "is-landing")} aria-hidden={dropTarget !== "prompt"}>
        <DropBadge text={inputs.length === 1 && inputs[0].role === "start" ? "Drop to start from this image" : inputs.length > 1 ? "Drop to use as a reference" : "Drop to use as reference"} />
      </div>
    </div>
  );
}
