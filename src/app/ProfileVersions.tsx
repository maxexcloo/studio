import React from 'react';
import { ChevronRight, RotateCcw } from 'lucide-react';
import { lineDiff } from './lineDiff';
import { Group, Status } from './SettingsControls';
import { Skeleton } from './components';
import { cn } from './format';

/** One saved version of a profile or guide, as the server lists it (without its text). */
export type VersionEntry = { version: number; at: string; by: string; origin: 'seed' | 'studio' | 'ai' | 'chat'; aiDrafted: boolean; note?: string };

export const originWords: Record<VersionEntry['origin'], string> = {
  seed: 'From the Seed',
  studio: 'Edited in Studio',
  ai: 'Drafted by the Assistant',
  chat: 'From Chat'
};

const when = (at: string) => { const date = new Date(at); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }); };

/** A line diff in the profile editor's style (the same gutter, marks and folded runs). */
export function DiffView({ before, after, label = 'Changes' }: { before: string; after: string; label?: string }) {
  const diff = React.useMemo(() => lineDiff(before, after), [before, after]);
  if (!diff.added && !diff.removed) return <p className="list-note">No changes from the version before.</p>;
  return <ol className="profile-diff" aria-label={label}>
    {diff.lines.map((line, index) => line.type === 'skip'
      ? <li key={index} className="is-skip">{line.count} unchanged line{line.count === 1 ? '' : 's'}</li>
      : <li key={index} className={`is-${line.type}`}><span className="profile-diff-num" aria-hidden="true">{line.type === 'add' ? '' : line.oldLine}</span><span className="profile-diff-num" aria-hidden="true">{line.type === 'remove' ? '' : line.newLine}</span><span className="profile-diff-mark" aria-label={line.type === 'add' ? 'Added' : line.type === 'remove' ? 'Removed' : undefined}>{line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}</span><code>{line.text || ' '}</code></li>)}
  </ol>;
}

/**
 * The flat list of a profile's or guide's versions, newest first. A row opens in place to show
 * what that version changed against the one before it, with Revert (a new version; nothing is lost).
 */
export function VersionList({ title, versions, current, busy, load, onRevert, note }: {
  title: string;
  versions: VersionEntry[] | null;
  current: number;
  busy?: boolean;
  /** One version's text, for its diff. */
  load: (version: number) => Promise<string>;
  onRevert: (version: number) => void;
  note?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState<number | null>(null);
  const [texts, setTexts] = React.useState<Record<number, string>>({});
  const [failed, setFailed] = React.useState('');
  React.useEffect(() => { setOpen(null); setTexts({}); }, [versions]);
  const toggle = async (version: number) => {
    if (open === version) { setOpen(null); return; }
    setOpen(version);
    setFailed('');
    try {
      const wanted = [version, version - 1].filter((n) => n >= 1 && texts[n] === undefined && versions?.some((item) => item.version === n));
      const loaded = await Promise.all(wanted.map(async (n) => [n, await load(n)] as const));
      if (loaded.length) setTexts((currentTexts) => ({ ...currentTexts, ...Object.fromEntries(loaded) }));
    } catch (error) { setFailed(error instanceof Error ? error.message : 'Couldn’t load that version'); }
  };
  if (!versions) return <Group title={title}><div className="list-row is-static set-row" aria-busy="true"><Skeleton className="skeleton-text short" /></div></Group>;
  return <Group title={title} note={note}>
    {versions.length ? versions.map((item) => {
      const expanded = open === item.version;
      const before = item.version > 1 ? texts[item.version - 1] : '';
      const after = texts[item.version];
      return <React.Fragment key={item.version}>
        <button type="button" className={cn('list-row set-row profile-version', expanded && 'is-open')} aria-expanded={expanded} onClick={() => void toggle(item.version)}>
          <span className="list-row-text">
            <span className="list-row-label">Version {item.version}{item.version === current ? ' · Current' : ''}</span>
            <span className="list-row-detail">{[originWords[item.origin] || item.origin, item.by && item.by !== item.origin ? item.by : '', when(item.at), item.note].filter(Boolean).join(' · ')}</span>
          </span>
          <span className="list-row-control">
            {item.aiDrafted ? <Status tone="warn">AI-Drafted</Status> : null}
            <ChevronRight size={16} className="profile-version-chevron" aria-hidden="true" />
          </span>
        </button>
        {expanded ? <div className="profile-version-body">
          {failed ? <p className="list-note is-error" role="alert">{failed}</p>
            : after === undefined || (item.version > 1 && before === undefined) ? <Skeleton className="skeleton-text" />
              : <DiffView before={item.version > 1 ? before : ''} after={after} label={`Changes in Version ${item.version}`} />}
          {item.version !== current ? <div className="profile-version-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => onRevert(item.version)}><RotateCcw size={14} />Revert to Version {item.version}</button>
          </div> : null}
        </div> : null}
      </React.Fragment>;
    }) : <div className="list-row is-static set-row"><span className="list-row-text"><span className="list-row-label">No Versions Yet</span><span className="list-row-detail">The next save records the first one.</span></span></div>}
  </Group>;
}
