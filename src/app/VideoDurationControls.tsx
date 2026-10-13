import { Field, NumberPicker, StudioSelect } from './components';
import { PhoneSelect, PhoneSlider } from './phoneControls';
import { durationOptions } from './videoDuration';

export function VideoDurationControls({ view, phone = false }: { view: any; phone?: boolean }) {
  const { currentProfile: profile, mode, frames, setFrames, fps, setFps, fpsMeta } = view;
  if (mode !== 'video' || !profile) return null;
  const effectiveFps = profile.capabilities.fps ? fps : Number(profile.defaults.fps || profile.constraints.fps?.default || 24);
  const options = durationOptions(profile, frames, effectiveFps);
  const editableFps = profile.capabilities.fps && !(Number.isFinite(fpsMeta.min) && fpsMeta.min === fpsMeta.max);
  if (!options.length && !editableFps) return null;
  return <section aria-label="Video Duration">
    {options.length ? phone
      ? <div className="phone-group"><PhoneSelect label="Duration" value={String(frames)} options={options} onChange={(value) => setFrames(Number(value))} /></div>
      : <Field label="Duration"><StudioSelect value={String(frames)} options={options} onChange={(value: string) => setFrames(Number(value))} /></Field>
      : null}
    {editableFps ? phone
      ? <PhoneSlider label="Frames Per Second" value={fps} min={fpsMeta.min ?? 1} max={fpsMeta.max ?? 60} step={fpsMeta.step || 1} onChange={setFps} />
      : <NumberPicker label="Frames Per Second" value={fps} onChange={setFps} min={fpsMeta.min ?? 1} max={fpsMeta.max ?? 60} step={fpsMeta.step || 1} fill />
      : null}
    {options.length ? <p className={phone ? 'phone-note' : 'sidebar-hint'}>{frames} Frames · {effectiveFps} FPS</p> : null}
  </section>;
}
