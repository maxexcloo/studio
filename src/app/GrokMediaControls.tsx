import { Field, NumberPicker, StudioSelect } from './components';
import { PhoneSelect, PhoneSlider } from './phoneControls';

export function GrokMediaControls({ view, phone = false }: { view: any; phone?: boolean }) {
  const { currentProfile: profile, duration, setDuration, resolution, setResolution } = view;
  if (profile?.family !== 'grok') return null;
  const range = profile.constraints?.duration || {};
  const resolutions: string[] = profile.options?.resolutions || [];
  return <section aria-label="Grok Media Settings">
    {profile.capabilities.duration ? phone
      ? <PhoneSlider label="Duration" value={duration} min={range.min ?? 1} max={range.max ?? 15} step={range.step || 1} onChange={setDuration} format={(value) => `${value} Seconds`} />
      : <NumberPicker label="Duration (Seconds)" value={duration} onChange={setDuration} min={range.min ?? 1} max={range.max ?? 15} step={range.step || 1} fill />
      : null}
    {profile.capabilities.resolution && resolutions.length ? phone
      ? <div className="phone-group"><PhoneSelect label="Resolution" value={resolution} options={resolutions} onChange={setResolution} /></div>
      : <Field label="Resolution"><StudioSelect value={resolution} options={resolutions} onChange={setResolution} /></Field>
      : null}
  </section>;
}
