import { AlertTriangle } from 'lucide-react';
import { Tip } from './components';
import { GridAutoplayButton } from './GridAutoplayButton';
import { StackRunsButton } from './StackRunsButton';
import type { Preferences } from './types';

/** Failed: whether failed outputs show in the gallery. */
function FailedItemsButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const label = on ? 'Hide Failed Outputs' : 'Show Failed Outputs';
  return <span className="gallery-action-shell"><Tip content={label}><button type="button" className={`zen-control-button gallery-view-toggle failed-items-button${on ? ' is-on' : ''}`} aria-label="Failed" aria-pressed={on} onClick={onToggle}>
    <AlertTriangle size={16} />
    <span>Failed</span>
  </button></Tip></span>;
}

/**
 * How the gallery is shown, the same three on desktop and phones
 * (UI-PATTERNS › Gallery View Controls): Auto-Grouping, Grid Autoplay (only
 * where there are videos) and Failed. The desktop toolbar holds them after
 * its filters; the phone's filter row ends with them, before Clear.
 */
export function GalleryViewControls({ prefs, setPrefs, hasVideos, searching }: { prefs: Preferences; setPrefs: (next: Partial<Preferences>) => void; hasVideos: boolean; searching: boolean }) {
  return <>
    <StackRunsButton labelled on={Boolean(prefs.stackRuns)} disabled={searching} onToggle={() => setPrefs({ stackRuns: !prefs.stackRuns })} />
    {hasVideos ? <GridAutoplayButton labelled /> : null}
    <FailedItemsButton on={prefs.showFailedItems !== false} onToggle={() => setPrefs({ showFailedItems: prefs.showFailedItems === false })} />
  </>;
}
