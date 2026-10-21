import React from 'react';
import { Boxes, Download, Image, Import, Layers } from 'lucide-react';
import { apiJson } from './api';
import { Modal } from './Modal';
import { cn } from './format';
import { useHistoryDismiss } from './useHistoryDismiss';
import type { ImagePreset } from './presets';
import type { DownloadState, ModelDownload, Models, Profile } from './types';
import type { ShowToast } from './toast';
import { errorText, LibraryFooterContext } from './libraryShared';
import { LibraryImport } from './LibraryImport';
import { LibraryImages } from './LibraryImages';
import { LibraryItems } from './LibraryItems';
import { LibraryDownloads } from './LibraryDownloads';

/*
 * The Library (UI-PATTERNS › Library), administrators only: the Settings
 * panel's anatomy with five pages, one at a time. Import takes a link or an
 * image file;
 * Images are the saved Civitai images with their grade; LoRAs and Models are
 * what is installed and catalogued, with provenance and Update Available
 * (Updates view); Downloads lists every
 * model download. Import and Images follow the deployment's Presets &
 * Civitai Imports switch. Messages go to the status pill.
 */

export type LibrarySection = 'import' | 'images' | 'loras' | 'models' | 'downloads';

/** Every download in one list, newest state per file: running first, then paused, then the recent ones. */
function flatten(state: DownloadState): ModelDownload[] {
  const seen = new Map<string, ModelDownload>();
  for (const item of [state.active, ...(state.queued || []), ...(state.paused || []), ...(state.recent || [])]) {
    if (!item) continue;
    const key = item.id || `${item.folder}/${item.file}`;
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
}

export function Library({ onClose, models, refreshModels, onApply, onPrompt, showToast, initialSection }: {
  onClose: () => void; models: Models | null; refreshModels: (notify?: boolean) => Promise<unknown>;
  onApply: (preset: ImagePreset, profile: Profile) => void; onPrompt: (preset: ImagePreset) => void;
  showToast: ShowToast; initialSection?: LibrarySection;
}) {
  const imports = models?.features?.presets === true;
  const sections = ([
    imports && { id: 'import', label: 'Import', icon: Import },
    imports && { id: 'images', label: 'Images', icon: Image },
    { id: 'loras', label: 'LoRAs', icon: Layers },
    { id: 'models', label: 'Models', icon: Boxes },
    { id: 'downloads', label: 'Downloads', icon: Download }
  ].filter(Boolean)) as Array<{ id: LibrarySection; label: string; icon: typeof Image }>;
  const [section, setSection] = React.useState<LibrarySection>(() => sections.some((item) => item.id === initialSection) ? initialSection! : sections[0].id);
  const [busy, setBusy] = React.useState(false);
  const [downloads, setDownloads] = React.useState<ModelDownload[]>([]);
  const [landed, setLanded] = React.useState(0);
  const [imageCount, setImageCount] = React.useState(0);
  const [openImage, setOpenImage] = React.useState('');
  // Choosing a page again starts it over (a review returns to its list).
  const [visit, setVisit] = React.useState(0);
  const [footerSlot, setFooterSlot] = React.useState<HTMLElement | null>(null);
  const [claims, setClaims] = React.useState(0);
  const claim = React.useCallback((on: boolean) => setClaims((count) => Math.max(0, count + (on ? 1 : -1))), []);
  const footer = React.useMemo(() => ({ slot: footerSlot, claim }), [footerSlot, claim]);
  const running = React.useRef(false);
  const mounted = React.useRef(true);
  const poke = React.useRef<() => void>(() => undefined);
  useHistoryDismiss(true, onClose);

  // One action at a time; a failure goes to the status pill, which says what happened.
  const run = React.useCallback((action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    void action().catch((error) => { if (mounted.current) showToast(errorText(error), 'error'); })
      .finally(() => { running.current = false; if (mounted.current) setBusy(false); });
  }, [showToast]);

  // Downloads: every few seconds while open, each second while something moves. A landed file rescans the models.
  React.useEffect(() => {
    mounted.current = true;
    let timer = 0;
    let initial = true;
    const seen = new Set<string>();
    const poll = async () => {
      window.clearTimeout(timer);
      let moving = false;
      try {
        const state = await apiJson<DownloadState>('/api/models/downloads');
        if (!mounted.current) return;
        const list = flatten(state);
        moving = Boolean(state.active || state.queued?.length);
        setDownloads(list);
        const done = list.filter((item) => item.status === 'done' && !seen.has(`${item.id}:${item.finishedAt}`));
        for (const item of done) seen.add(`${item.id}:${item.finishedAt}`);
        if (done.length && !initial) {
          await refreshModels(false);
          if (!mounted.current) return;
          setLanded((count) => count + 1);
          showToast('Models refreshed', 'success');
        }
        initial = false;
      } catch { /* Keep the Library usable through a short reconnection. */ }
      if (mounted.current) timer = window.setTimeout(poll, moving ? 1000 : document.hidden ? 10000 : 3000);
    };
    poke.current = () => { void poll(); };
    void poll();
    return () => { mounted.current = false; window.clearTimeout(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On phones the section row scrolls sideways; keep the chosen one in view.
  React.useEffect(() => {
    const item = document.querySelector<HTMLElement>(`.library-modal .set-nav [data-section="${section}"]`);
    const nav = item?.parentElement;
    if (item && nav && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: Math.max(0, item.offsetLeft - (nav.clientWidth - item.offsetWidth) / 2), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [section]);

  const runningCount = downloads.filter((item) => ['queued', 'downloading'].includes(item.status)).length;
  const counts: Partial<Record<LibrarySection, number>> = { images: imageCount, downloads: runningCount };
  const go = (next: LibrarySection) => { setOpenImage(''); setSection(next); setVisit((count) => count + 1); };
  const changed = () => poke.current();
  // An action that may have queued a download: the list catches up at once.
  const runAndPoll = (action: () => Promise<void>) => run(async () => { await action(); changed(); });

  return <LibraryFooterContext.Provider value={footer}>
    <Modal open onOpenChange={(next) => { if (!next) onClose(); }} size="sheet" title="Library" className="settings-modal library-modal" bodyClassName="set-layout" busy={busy}
      footer={claims ? <div className="library-foot-slot" ref={setFooterSlot} /> : undefined}>
      <nav className="set-nav" aria-label="Library Sections">
        {sections.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} type="button" className={cn('set-nav-item', section === item.id && 'active')} aria-current={section === item.id ? 'page' : undefined} aria-controls="library-panel" data-section={item.id} disabled={busy} onClick={() => go(item.id)}>
            <Icon size={16} /><span>{item.label}</span>{counts[item.id] ? <small className="library-nav-count">{counts[item.id]}</small> : null}
          </button>;
        })}
      </nav>
      <div className="set-panel library-panel" key={`${section}:${visit}`} id="library-panel" role="region" aria-labelledby="library-panel-title">
        {section === 'import' ? <LibraryImport showToast={showToast} downloads={downloads} landed={landed} busy={busy} run={runAndPoll} refreshModels={refreshModels} onOpenImage={(id) => { setOpenImage(id); setSection('images'); }} models={models} onApply={onApply} onPrompt={onPrompt} onClose={onClose} /> : null}
        {section === 'images' ? <LibraryImages models={models} refreshModels={refreshModels} onApply={onApply} onPrompt={onPrompt} onClose={onClose} showToast={showToast} downloads={downloads} landed={landed} busy={busy} run={runAndPoll} open={openImage} onOpened={() => setOpenImage('')} onImport={() => go('import')} onCount={setImageCount} /> : null}
        {section === 'loras' || section === 'models' ? <LibraryItems page={section} landed={landed} showToast={showToast} busy={busy} run={runAndPoll} onUpdates={() => void refreshModels(false)} /> : null}
        {section === 'downloads' ? <LibraryDownloads downloads={downloads} busy={busy} run={run} onChanged={changed} /> : null}
      </div>
    </Modal>
  </LibraryFooterContext.Provider>;
}
