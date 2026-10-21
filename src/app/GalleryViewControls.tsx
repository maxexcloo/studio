import React from 'react';
import { EyeOff } from 'lucide-react';
import { Tip } from './components';
import { GridAutoplayButton } from './GridAutoplayButton';
import { StackRunsButton } from './StackRunsButton';
import type { GalleryItem, Preferences } from './types';

/** Waiting for its turn: pending and not yet running (the same test as the activity island). */
export const isQueuedItem = (item: GalleryItem) => item.status === 'pending' && !item.progress?.runStartedAt && !((item.progress?.max || 0) > 0);

/**
 * Hide Failed & Queued: one pressed toggle like the other view controls
 * (UI-PATTERNS › Gallery View Controls). A stored view preference, so Clear
 * Filters leaves it alone; queued jobs still count as running.
 */
function StatusToggle({ prefs, setPrefs }: { prefs: Preferences; setPrefs: (next: Partial<Preferences>) => void }) {
  const on = Boolean(prefs.hideQueuedItems) && prefs.showFailedItems === false;
  return <span className="gallery-action-shell"><Tip content={on ? 'Show Failed & Queued Outputs' : 'Hide Failed & Queued Outputs'}>
    <button type="button" className={`zen-control-button gallery-view-toggle status-toggle${on ? ' is-on' : ''}`} aria-label="Hide Failed & Queued" aria-pressed={on}
      onClick={() => setPrefs({ hideQueuedItems: !on, showFailedItems: on })}>
      <EyeOff size={16} aria-hidden="true" /><span>Hide Failed & Queued</span>
    </button>
  </Tip></span>;
}

/**
 * How the gallery is shown, the same on desktop and phones (UI-PATTERNS ›
 * Gallery View Controls): Hide Failed & Queued, Auto-Grouping and Grid Autoplay
 * (only where there are videos). The desktop toolbar holds them after its
 * filters; the phone's filter row ends with them, before Clear.
 */
export function GalleryViewControls({ prefs, setPrefs, hasVideos, searching }: { prefs: Preferences; setPrefs: (next: Partial<Preferences>) => void; hasVideos: boolean; searching: boolean }) {
  return <>
    <StatusToggle prefs={prefs} setPrefs={setPrefs} />
    <StackRunsButton labelled on={Boolean(prefs.stackRuns)} disabled={searching} onToggle={() => setPrefs({ stackRuns: !prefs.stackRuns })} />
    {hasVideos ? <GridAutoplayButton labelled /> : null}
  </>;
}
