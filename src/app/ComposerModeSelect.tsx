import React from 'react';
import { ChevronDown } from 'lucide-react';
import type { Mode } from './types';

export function ComposerModeSelect({ mode, onChange }: { mode: string; onChange: (mode: Mode) => void }) {
  return <label className="composer-mode-select">
    <select aria-label="Generation Mode" value={mode} onChange={(event) => onChange(event.target.value as Mode)}>
      <option value="image">Photo</option>
      <option value="video">Video</option>
    </select>
    <ChevronDown size={13} aria-hidden="true" />
  </label>;
}
