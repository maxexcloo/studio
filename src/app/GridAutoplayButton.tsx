import { useSyncExternalStore } from 'react';
import { Pause, Play } from 'lucide-react';
import { Tip } from './components';
import { gridAutoplayEnabled, subscribeGridAutoplay, toggleGridAutoplay } from './videoPreviewScheduler';

/** Grid Autoplay: one name everywhere (UI-PATTERNS › Gallery View Controls). */
export function GridAutoplayButton({ labelled = false }: { labelled?: boolean }) {
  const enabled = useSyncExternalStore(subscribeGridAutoplay, gridAutoplayEnabled);
  const label = `Grid Autoplay: ${enabled ? 'On' : 'Off'}`;
  return <span className="gallery-action-shell"><Tip content={label}><button type="button" className={`zen-control-button gallery-view-toggle grid-autoplay-button${enabled ? ' is-on' : ''}`}
    aria-label={label} aria-pressed={enabled} onClick={toggleGridAutoplay}>
    {enabled ? <Pause size={16} /> : <Play size={16} />}
    {labelled ? <span>Grid Autoplay</span> : null}
  </button></Tip></span>;
}
