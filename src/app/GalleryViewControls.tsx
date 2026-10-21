import React from 'react';
import { ListFilter } from 'lucide-react';
import { GalleryFilterPicker } from './GallerySearch';
import { GridAutoplayButton } from './GridAutoplayButton';
import { StackRunsButton } from './StackRunsButton';
import type { GalleryItem, Preferences } from './types';

/** Waiting for its turn: pending and not yet running (the same test as the activity island). */
export const isQueuedItem = (item: GalleryItem) => item.status === 'pending' && !item.progress?.runStartedAt && !((item.progress?.max || 0) > 0);

const statusLabels: Record<string, string> = { queued: 'Hide Queued', failed: 'Hide Failed' };

/**
 * Status: which kinds of outputs the gallery leaves out (UI-PATTERNS › Filter
 * row). A stored view preference, so Clear Filters leaves it alone.
 */
function StatusFilter({ prefs, setPrefs }: { prefs: Preferences; setPrefs: (next: Partial<Preferences>) => void }) {
  const floating = React.useRef<HTMLDivElement | null>(null);
  const hidden = [prefs.hideQueuedItems ? 'queued' : '', prefs.showFailedItems === false ? 'failed' : ''].filter(Boolean);
  return <GalleryFilterPicker name="Status" values={hidden} options={['queued', 'failed']} icon={ListFilter} labelFor={(value) => statusLabels[value] || value} searchable={false}
    onChange={(values) => setPrefs({ hideQueuedItems: values.includes('queued'), showFailedItems: !values.includes('failed') })} floatingRef={floating} />;
}

/**
 * How the gallery is shown, the same on desktop and phones (UI-PATTERNS ›
 * Gallery View Controls): the Status filter, Auto-Grouping and Grid Autoplay
 * (only where there are videos). The desktop toolbar holds them after its
 * filters; the phone's filter row ends with them, before Clear.
 */
export function GalleryViewControls({ prefs, setPrefs, hasVideos, searching }: { prefs: Preferences; setPrefs: (next: Partial<Preferences>) => void; hasVideos: boolean; searching: boolean }) {
  return <>
    <StatusFilter prefs={prefs} setPrefs={setPrefs} />
    <StackRunsButton labelled on={Boolean(prefs.stackRuns)} disabled={searching} onToggle={() => setPrefs({ stackRuns: !prefs.stackRuns })} />
    {hasVideos ? <GridAutoplayButton labelled /> : null}
  </>;
}
