import React from 'react';
import { ArrowLeft, Boxes, Download, Image, Import, Layers, RefreshCw, Sparkles } from 'lucide-react';
import { apiJson } from './api';
import { EmptyState } from './EmptyState';
import { ListSelect } from './SheetList';
import { Group, GroupAction, Row } from './SettingsControls';
import { cn } from './format';
import type { ModelDownload } from './types';
import type { ShowToast } from './toast';
import { errorText, FileStatus, FOLDERS, folderName, GradeChip, LibraryFooter, percent, post, size, SourceLinks, type Grade, type Links } from './libraryShared';

/*
 * Library › Import: one field for a Civitai or Hugging Face link (dropped
 * files come later), then the import history as rows. An import opens its
 * record in place (Back returns to Import): the grade with its reasons, the
 * source links, then the Files group, one row per file with its status, size
 * and source. Download Missing in the footer queues every missing file at
 * once; paid and early-access files show as unavailable with the reason.
 */

type Availability = { reason: 'paid' | 'early-access' | 'licence' | 'no-checksum'; note?: string; freeAlternative?: { versionId: number; name: string; url?: string } };
export type ImportResource = {
  role: string; name: string; version?: string;
  want: { file: string; folder: string; sha256?: string; bytes?: number; source?: { provider?: string; url?: string } };
  status: 'installed' | 'missing' | 'downloading' | 'conflict' | 'unavailable' | 'unsupported' | 'substitute';
  supported?: boolean; note?: string; unavailable?: Availability; optional?: boolean; folderGuessed?: boolean;
  downloadId?: string; downloadError?: string; progress?: { receivedBytes: number; totalBytes: number }; unverified?: boolean; nameOnly?: boolean;
};
export type ImportRecord = {
  id: string; createdAt: string; /** Where it was imported: here, or from an administrator's chat (MCP's Import). */ origin?: 'ui' | 'chat'; state: 'resolving' | 'needs-files' | 'downloading' | 'ready' | 'failed' | 'cancelled';
  input: { kind: 'civitai-image' | 'civitai-model' | 'hf-file' | 'hf-repo' | 'image-file' | 'described'; url?: string; presetId?: string };
  title: string; version?: string; baseModel?: string; modelType?: string; links?: Links;
  resources: ImportResource[]; grade: Grade; results: { catalogueKeys?: string[]; galleryItemId?: string; profileId?: string; guideId?: string }; error?: string; warnings?: string[];
};

const kindWords: Record<ImportRecord['input']['kind'], string> = { 'civitai-image': 'Civitai Image', 'civitai-model': 'Civitai Model', 'hf-file': 'Hugging Face File', 'hf-repo': 'Hugging Face Repository', 'image-file': 'Image File', described: 'Described Image' };
const stateWords: Record<ImportRecord['state'], string> = { resolving: 'Resolving', 'needs-files': 'Needs Files', downloading: 'Downloading', ready: 'Ready', failed: 'Failed', cancelled: 'Cancelled' };
const statusWords: Record<ImportResource['status'], string> = { installed: 'Installed', missing: 'Missing', downloading: 'Downloading', conflict: 'Filename Conflict', unavailable: 'Unavailable', unsupported: 'Not Supported', substitute: 'Substitute' };
const providerWords = (provider?: string) => provider === 'civitai' ? 'Civitai' : provider === 'hf' ? 'Hugging Face' : '';
const unavailableWords: Record<Availability['reason'], string> = { paid: 'Paid', 'early-access': 'Early Access', licence: 'Restricted', 'no-checksum': 'No Checksum' };
const destinations = ['checkpoints', 'clip_vision', 'diffusion_models', 'loras', 'text_encoders', 'vae'].map((value) => ({ value, label: FOLDERS[value] }));
const KindIcon = ({ kind }: { kind: ImportRecord['input']['kind'] }) => kind === 'civitai-image' ? <Image size={16} /> : kind === 'civitai-model' ? <Layers size={16} /> : <Boxes size={16} />;
const when = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
/** Files Download Missing would queue: required, missing, downloadable. */
const missingOf = (record: ImportRecord) => record.resources.filter((resource) => !resource.optional && resource.status === 'missing' && resource.supported !== false && !resource.unavailable);

/** Required files that aren't installed, whether or not they can download: the history's "n Missing". */
const absentOf = (record: ImportRecord) => record.resources.filter((resource) => !resource.optional && ['missing', 'unavailable', 'unsupported', 'conflict'].includes(resource.status));

let lastImports: ImportRecord[] | null = null;

export function LibraryImport({ showToast, downloads, landed, busy, run, onOpenImage, refreshModels }: {
  showToast: ShowToast; downloads: ModelDownload[]; landed: number; busy: boolean; run: (action: () => Promise<void>) => void;
  /** A Civitai image link lands in Images: open its review there. */
  onOpenImage: (presetId: string) => void;
  refreshModels: (notify?: boolean) => Promise<unknown>;
}) {
  const [url, setUrl] = React.useState('');
  const [imports, setImports] = React.useState<ImportRecord[]>(() => lastImports || []);
  const [loading, setLoading] = React.useState(!lastImports);
  const [loadError, setLoadError] = React.useState('');
  const [importing, setImporting] = React.useState(false);
  const [record, setRecord] = React.useState<ImportRecord | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const mounted = React.useRef(true);
  const recordRef = React.useRef(record);
  recordRef.current = record;

  const keep = (next: ImportRecord[]) => { lastImports = next; return next; };
  const remember = (next: ImportRecord) => {
    setImports((current) => keep([next, ...current.filter((item) => item.id !== next.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
    if (recordRef.current?.id === next.id) setRecord(next);
  };
  const load = async () => {
    setLoadError('');
    try {
      const data = await apiJson<{ imports: ImportRecord[] }>('/api/library/imports');
      if (mounted.current) setImports(keep(data.imports));
    } catch (error) { if (mounted.current) setLoadError(errorText(error, 'Couldn’t load the imports')); }
    finally { if (mounted.current) setLoading(false); }
  };
  const reopen = async (id: string) => {
    const data = await apiJson<{ import: ImportRecord }>(`/api/library/imports/${encodeURIComponent(id)}`);
    if (mounted.current) remember(data.import);
    return data.import;
  };
  React.useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);
  // A file landed: the open record (and the list) catch up.
  React.useEffect(() => {
    if (!landed) return;
    if (recordRef.current) void reopen(recordRef.current.id).catch(() => undefined);
    else void load();
  }, [landed]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (item: ImportRecord) => {
    if (item.input.kind === 'civitai-image' && item.input.presetId && item.state !== 'failed') { onOpenImage(item.input.presetId); return; }
    setRecord(item);
    if (item.state !== 'failed') void reopen(item.id).catch(() => undefined);
  };
  const submit = (link = url) => run(async () => {
    const value = link.trim();
    if (!value) return;
    setImporting(true);
    try {
      const data = await post<{ import: ImportRecord }>('/api/library/imports', { url: value });
      if (!mounted.current) return;
      remember(data.import);
      setUrl('');
      if (data.import.state === 'failed') { showToast(data.import.error || 'Couldn’t import that link', 'error'); return; }
      if (data.import.input.kind === 'civitai-image' && data.import.input.presetId) {
        showToast('Image saved to your gallery', 'success');
        onOpenImage(data.import.input.presetId);
        return;
      }
      setRecord(data.import);
      showToast(data.import.results.profileId ? 'Imported. Its profile is drafted for review' : data.import.results.catalogueKeys?.length ? 'Imported. Its catalogue entry is written' : 'Imported', 'success');
      if (data.import.results.profileId) void refreshModels(false);
    } finally { if (mounted.current) setImporting(false); }
  });
  const drop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const link = event.dataTransfer.getData('text/uri-list').split('\n').find((line) => line && !line.startsWith('#')) || event.dataTransfer.getData('text/plain');
    if (link && /^https:\/\//i.test(link.trim())) { setUrl(link.trim()); submit(link); return; }
    if (event.dataTransfer.files.length) showToast('Image files can’t be imported yet. Paste a link for now', 'default');
  };
  const queue = (target: ImportRecord, indices?: number[]) => run(async () => {
    const data = await post<{ import: ImportRecord; queued: number; failures: string[] }>(`/api/library/imports/${encodeURIComponent(target.id)}/download`, indices ? { indices } : {});
    remember(data.import);
    if (data.failures.length) showToast(`${data.queued} queued. ${data.failures[0]}`, 'warning');
    else showToast(data.queued === 1 ? 'Missing file queued' : `${data.queued} missing files queued`, 'success');
  });
  const move = (target: ImportRecord, index: number, folder: string) => run(async () => {
    const data = await post<{ import: ImportRecord }>(`/api/library/imports/${encodeURIComponent(target.id)}/folder`, { index, folder });
    remember(data.import);
  });

  // A checkpoint import drafts its profile on import; this tries again (after a failure).
  const draft = (target: ImportRecord) => run(async () => {
    const data = await post<{ import: ImportRecord }>(`/api/library/imports/${encodeURIComponent(target.id)}/draft-profile`, {});
    remember(data.import);
    showToast('Profile drafted. Review it in Settings › Profiles', 'success');
    void refreshModels(false);
  });

  if (record) {
    const missing = missingOf(record);
    const canDraft = !record.results.profileId && record.state !== 'failed' && ['civitai-model', 'hf-file'].includes(record.input.kind)
      && record.resources.filter((resource) => ['checkpoint', 'diffusion_model'].includes(resource.role) && !resource.optional).length === 1;
    const live = (resource: ImportResource) => resource.downloadId ? downloads.find((item) => item.id === resource.downloadId) : undefined;
    return <div className="library-page">
      {missing.length || canDraft ? <LibraryFooter>
        {canDraft ? <button className={cn('btn', !missing.length && 'is-primary')} disabled={busy} onClick={() => draft(record)}><Sparkles size={16} />Draft Profile</button> : null}
        {missing.length ? <button className="btn is-primary" disabled={busy} onClick={() => queue(record)}><Download size={16} />Download Missing{missing.length > 1 ? ` (${missing.length})` : ''}</button> : null}
      </LibraryFooter> : null}
      <div className="library-review-bar">
        <button type="button" className="btn is-ghost library-back" disabled={busy} onClick={() => setRecord(null)}><ArrowLeft size={16} />Import</button>
        <div className="library-review-actions"><SourceLinks links={record.links} label={record.title || 'This Import'} /></div>
      </div>
      <header className="set-page-head">
        <h3 id="library-panel-title">{record.title || record.input.url}</h3>
        <p>{[kindWords[record.input.kind], record.modelType && record.modelType !== 'repository' ? record.modelType : '', record.version, record.baseModel, record.origin === 'chat' ? 'From Chat' : ''].filter(Boolean).join(' · ')}</p>
      </header>
      <section className="library-grade-block" aria-label="Grade">
        <div className="library-grade-line"><GradeChip grade={record.grade} /><span className="library-grade-state">{stateWords[record.state]}</span></div>
        <ul className="set-note library-notes">{(record.state === 'failed' ? [record.error || 'Couldn’t import that link'] : record.grade.reasons).map((reason) => <li key={reason}>{reason}</li>)}</ul>
      </section>
      {record.results.catalogueKeys?.length ? <p className="set-note">{record.results.catalogueKeys.length === 1 ? 'Its catalogue entry is written: title, version, family, trigger words, strength, description, links, NSFW and checksum.' : `${record.results.catalogueKeys.length} catalogue entries are written.`}</p> : null}
      {record.results.profileId ? <p className="set-note">Its profile is drafted{record.results.guideId ? ', with a guide' : ''}: AI-Drafted, so only administrators see it until you approve it in Settings › Profiles.</p>
        : record.resources.some((resource) => ['checkpoint', 'diffusion_model'].includes(resource.role)) && record.state !== 'failed' ? <p className="set-note">No profile is drafted for this model yet.</p> : null}
      {record.warnings?.length ? <ul className="set-note library-notes is-blocking">{record.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
      {record.resources.length ? <Group title="Files" action={<GroupAction disabled={busy} onClick={() => run(async () => { await refreshModels(false); await reopen(record.id); })}>Check Again</GroupAction>}
        note={record.resources.some((resource) => resource.folderGuessed && resource.status !== 'installed') ? 'Hugging Face doesn’t say where a file goes. Check each Destination before downloading.' : undefined}>
        {record.resources.map((resource, index) => {
          const download = live(resource);
          const moving = resource.status === 'downloading' || Boolean(download && ['queued', 'downloading'].includes(download.status));
          const progress = download || resource.progress;
          const words = resource.unavailable ? `Unavailable · ${unavailableWords[resource.unavailable.reason]}` : moving ? (download?.status === 'queued' ? 'Queued' : progress?.totalBytes ? `Downloading ${percent(progress)}%` : 'Downloading…') : resource.status === 'installed' && resource.unverified ? 'Installed · Unverified' : statusWords[resource.status];
          const canMove = record.input.kind.startsWith('hf-') && !['installed', 'downloading'].includes(resource.status) && !moving;
          return <Row key={`${resource.want.folder}/${resource.want.file}/${index}`} className="library-resource" label={resource.want.file || resource.name} description={<>
            <span className="library-line">{[folderName(resource.want.folder), resource.version, size(resource.want.bytes), providerWords(resource.want.source?.provider)].filter(Boolean).join(' · ')}</span>
            {resource.unavailable ? <span className="library-line">{resource.unavailable.note}{resource.unavailable.freeAlternative ? <> <a className="set-link" href={resource.unavailable.freeAlternative.url} target="_blank" rel="noreferrer">Free version: {resource.unavailable.freeAlternative.name}</a></> : null}</span> : resource.note ? <span className="library-line">{resource.note}</span> : null}
            {resource.downloadError ? <span className="library-line library-error" role="alert">{resource.downloadError}</span> : null}
            {moving ? <span className="set-progress" aria-hidden="true"><span style={{ width: `${progress ? percent(progress) : 0}%` }} /></span> : null}
          </>}>
            {canMove ? <span className="library-model-choice"><ListSelect label={`Destination for ${resource.want.file}`} value={resource.want.folder} onChange={(folder) => move(record, index, folder)} options={destinations} /></span> : null}
            {resource.optional && resource.status === 'missing' && resource.supported !== false && !resource.unavailable && !moving ? <button type="button" className="btn is-sm" disabled={busy} onClick={() => queue(record, [index])}><Download size={14} />Download</button> : null}
            <FileStatus status={resource.unavailable ? 'unavailable' : moving ? 'downloading' : resource.status}>{words}</FileStatus>
          </Row>;
        })}
      </Group> : null}
    </div>;
  }

  return <div className="library-page">
    <header className="set-page-head">
      <h3 id="library-panel-title">Import</h3>
      <p>Paste a Civitai image or model link, or a Hugging Face link. Each import says how closely it can be recreated.</p>
    </header>
    <form className={cn('library-link library-drop', dragging && 'is-dragging')} onSubmit={(event) => { event.preventDefault(); submit(); }}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
      <label className="sr-only" htmlFor="library-import-link">Link</label>
      <input id="library-import-link" type="url" placeholder="Paste a link or drop it here" disabled={busy} value={url} onChange={(event) => setUrl(event.target.value)} required autoComplete="off" />
      <button className={cn('btn', url.trim() && 'is-primary')} disabled={busy || !url.trim()}><Import size={16} />{importing ? 'Importing…' : 'Import'}</button>
    </form>
    {importing ? <p className="set-note" role="status">Importing: reading the source, checking its files and grading it.</p> : null}
    {loading ? <Group title="History"><div className="list-row is-static library-import-row is-skeleton" aria-busy="true" aria-label="Loading Imports"><span className="library-import-icon" /><span className="list-row-text"><i /><i /></span></div></Group>
      : loadError && !imports.length ? <Group title="History"><EmptyState compact title="Couldn’t Load Imports" action={<button className="btn" onClick={() => { setLoading(true); void load(); }}><RefreshCw size={16} />Try Again</button>}><span role="alert">{loadError}</span></EmptyState></Group>
      : imports.length ? <Group title="History">{imports.map((item) => <button type="button" key={item.id} className="list-row set-row library-import-row" disabled={busy} onClick={() => open(item)}>
        <span className="library-import-icon" aria-hidden="true"><KindIcon kind={item.input.kind} /></span>
        <span className="list-row-text">
          <span className="list-row-label">{item.title || item.input.url}</span>
          <span className="list-row-detail">{[kindWords[item.input.kind], item.baseModel, item.origin === 'chat' ? 'From Chat' : '', item.state !== 'failed' && absentOf(item).length ? `${absentOf(item).length} Missing` : '', when(item.createdAt)].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="list-row-control library-import-meta"><GradeChip grade={item.state === 'failed' ? null : item.grade} /><span className={cn('library-status', `is-${item.state}`)}>{stateWords[item.state]}</span></span>
      </button>)}</Group>
      : <Group title="History"><EmptyState compact title="No Imports Yet">Imports from here and from chat show here, with their grade.</EmptyState></Group>}
  </div>;
}
