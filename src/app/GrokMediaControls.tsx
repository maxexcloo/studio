import { NumberPicker } from './components';
import { usePhone } from './device';
import { ListItem, ListSection, ListSelect } from './SheetList';

/** A cloud video model's duration and resolution, as rows of the Advanced Settings list. */
export function GrokMediaControls({ view }: { view: any; phone?: boolean }) {
  const native = usePhone();
  const { currentProfile: profile, duration, setDuration, resolution, setResolution } = view;
  if (!profile || (!profile.capabilities.duration && !profile.capabilities.resolution)) return null;
  const range = profile.constraints?.duration || {};
  const resolutions: string[] = profile.options?.resolutions || [];
  return <ListSection title="Video">
    {profile.capabilities.duration ? <ListItem label="Duration (Seconds)"><NumberPicker label="Duration (Seconds)" value={duration} onChange={setDuration} min={range.min ?? 1} max={range.max ?? 15} step={range.step || 1} size="sm" density="compact" /></ListItem> : null}
    {profile.capabilities.resolution && resolutions.length > 1 ? (
      <ListItem label="Resolution">
        {resolutions.length > 2
          ? <ListSelect native={native} label="Resolution" value={resolution} options={resolutions.map((value) => ({ value, label: value }))} onChange={setResolution} />
          : <div className="list-segments" role="group" aria-label="Resolution">{resolutions.map((value) => <button key={value} type="button" aria-pressed={resolution === value} onClick={() => setResolution(value)}>{value}</button>)}</div>}
      </ListItem>
    ) : null}
  </ListSection>;
}
