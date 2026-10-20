import { NumberPicker } from './components';
import { usePhone } from './device';
import { ListItem, ListSection, ListSelect } from './SheetList';
import { durationOptions } from './videoDuration';

/** Duration and frame rate for a video model, as rows of the Advanced Settings list. */
export function VideoDurationControls({ view }: { view: any; phone?: boolean }) {
  const native = usePhone();
  const { currentProfile: profile, mode, frames, setFrames, fps, setFps, fpsMeta } = view;
  if (mode !== 'video' || !profile) return null;
  const effectiveFps = profile.capabilities.fps ? fps : Number(profile.defaults.fps || profile.constraints.fps?.default || 24);
  const options = durationOptions(profile, frames, effectiveFps);
  const editableFps = profile.capabilities.fps && !(Number.isFinite(fpsMeta.min) && fpsMeta.min === fpsMeta.max);
  if (!options.length && !editableFps) return null;
  return <ListSection title="Video">
    {options.length ? <ListItem label="Duration"><ListSelect native={native} label="Duration" value={String(frames)} options={options} onChange={(value) => setFrames(Number(value))} /></ListItem> : null}
    {editableFps ? <ListItem label="Frames Per Second"><NumberPicker label="Frames Per Second" value={fps} onChange={setFps} min={fpsMeta.min ?? 1} max={fpsMeta.max ?? 60} step={fpsMeta.step || 1} size="sm" density="compact" /></ListItem> : null}
    {options.length ? <ListItem label="Frames"><span className="list-row-value">{frames} Frames · {effectiveFps} FPS</span></ListItem> : null}
  </ListSection>;
}
