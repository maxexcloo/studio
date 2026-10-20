import { Film, Image as ImageIcon } from 'lucide-react';
import { Tip } from './components';
import { cn } from './format';
import type { Mode } from './types';

const modes = ['image', 'video'] as const;

/**
 * Image/Video as a pair of icons: the same segmented toggle for the gallery
 * (Images/Videos) and for generation (Image/Video), on the desktop and phones.
 */
export function MediaModeToggle({ mode, onChange, kind, className, tips = true, labelled = false, onPress }: {
  mode: string;
  onChange: (mode: Mode) => void;
  kind: 'gallery' | 'generation';
  className?: string;
  /** Tooltips need a pointer; on a phone the names are for assistive tech. */
  tips?: boolean;
  /** Words instead of icons: the desktop gallery's top switch, which has the room. */
  labelled?: boolean;
  onPress?: () => void;
}) {
  const label = (value: Mode) => kind === 'gallery' ? (value === 'image' ? 'Images' : 'Videos') : (value === 'image' ? 'Image' : 'Video');
  return <div className={cn('mode-tabs media-mode-toggle', labelled && 'is-labelled', className)} role="group" aria-label={kind === 'gallery' ? 'Gallery Mode' : 'Generation Mode'}>
    {modes.map((value) => {
      const Icon = value === 'image' ? ImageIcon : Film;
      const button = <button key={value} type="button" className={cn(mode === value && 'active')} aria-pressed={mode === value} aria-label={labelled ? undefined : label(value)} onClick={() => { onPress?.(); onChange(value); }}>{labelled ? label(value) : <Icon size={17} aria-hidden="true" />}</button>;
      return tips && !labelled ? <Tip key={value} content={label(value)}>{button}</Tip> : button;
    })}
  </div>;
}

export function ComposerModeSelect({ mode, onChange, tips = true }: { mode: string; onChange: (mode: Mode) => void; tips?: boolean }) {
  return <MediaModeToggle kind="generation" className="composer-mode-select" mode={mode} onChange={onChange} tips={tips} />;
}
