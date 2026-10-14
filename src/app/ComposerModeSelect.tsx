import React from 'react';
import { StudioSelect } from './components';
import type { Mode } from './types';

export function ComposerModeSelect({ mode, onChange }: { mode: string; onChange: (mode: Mode) => void }) {
  return <div className="composer-mode-select">
    <StudioSelect ariaLabel="Generation Mode" side="top" value={mode} onChange={(value) => onChange(value as Mode)} options={[{ label: 'Photo', value: 'image' }, { label: 'Video', value: 'video' }]} />
  </div>;
}
