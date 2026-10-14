import { cn } from './format';
import type { Mode } from './types';

export function ComposerModeSelect({ mode, onChange }: { mode: string; onChange: (mode: Mode) => void }) {
  return <div className="mode-tabs composer-mode-select" role="group" aria-label="Generation Mode">
    {(['image', 'video'] as const).map((value) => <button key={value} type="button" className={cn(mode === value && 'active')} aria-pressed={mode === value} onClick={() => onChange(value)}>{value === 'image' ? 'Photo' : 'Video'}</button>)}
  </div>;
}
