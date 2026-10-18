import type React from 'react';
import { Field, NumberPicker, StudioSelect } from './components';
import { PhoneSelect, PhoneSlider } from './phoneControls';

export function GrokMediaControls({ view, phone = false }: { view: any; phone?: boolean }) {
  const { currentProfile: profile, duration, setDuration, resolution, setResolution } = view;
  if (!profile || (!profile.capabilities.duration && !profile.capabilities.resolution)) return null;
  const range = profile.constraints?.duration || {};
  const resolutions: string[] = profile.options?.resolutions || [];
  return <section aria-label="Media Settings">
    {profile.capabilities.duration ? phone
      ? <PhoneSlider label="Duration" value={duration} min={range.min ?? 1} max={range.max ?? 15} step={range.step || 1} onChange={setDuration} format={(value) => `${value} Seconds`} />
      : <NumberPicker label="Duration (Seconds)" value={duration} onChange={setDuration} min={range.min ?? 1} max={range.max ?? 15} step={range.step || 1} fill />
      : null}
    {profile.capabilities.resolution && resolutions.length > 1 ? <Field label="Resolution">
      {resolutions.length > 2
        ? phone ? <PhoneSelect label="Resolution" value={resolution} options={resolutions} onChange={setResolution} /> : <StudioSelect ariaLabel="Resolution" value={resolution} options={resolutions} onChange={setResolution} />
        : <div className="aspect-upscale-tabs" role="radiogroup" aria-label="Resolution" style={{ '--tab-count': resolutions.length, '--tab-index': Math.max(0, resolutions.indexOf(resolution)) } as React.CSSProperties}><i aria-hidden="true" />{resolutions.map(value => <button key={value} type="button" role="radio" aria-checked={resolution === value} className={resolution === value ? 'is-active' : ''} onClick={() => setResolution(value)}>{value}</button>)}</div>}
    </Field> : null}
  </section>;
}
