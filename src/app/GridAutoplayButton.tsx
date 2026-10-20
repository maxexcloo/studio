import { useSyncExternalStore } from 'react';
import { Pause, Play } from 'lucide-react';
import { Tip } from './components';
import { gridAutoplayEnabled, subscribeGridAutoplay, toggleGridAutoplay } from './videoPreviewScheduler';

export function GridAutoplayButton({ labelled = false, phone = false }: { labelled?: boolean; phone?: boolean }) {
  const enabled = useSyncExternalStore(subscribeGridAutoplay, gridAutoplayEnabled);
  const label = `Grid Autoplay: ${enabled ? 'On' : 'Off'}`;
  return <span className="gallery-action-shell"><Tip content={enabled ? 'Pause Grid Previews' : 'Play Grid Previews'}><button type="button" className={`${phone ? 'phone-icon' : 'zen-control-button grid-autoplay-button'}${enabled ? ' is-on' : ''}`}
    aria-label={label} aria-pressed={enabled} onClick={toggleGridAutoplay}>
    {enabled ? <Pause size={phone ? 20 : 16} /> : <Play size={phone ? 20 : 16} />}
    {labelled ? <span>Autoplay</span> : null}
  </button></Tip></span>;
}
