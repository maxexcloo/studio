import React from 'react';
import { ArrowLeft, Boxes, Download, FileImage, Image, ImageUp, Import, Layers, RefreshCw, SlidersHorizontal, Sparkles, Wand2 } from 'lucide-react';
import { apiJson } from './api';
import { EmptyState } from './EmptyState';
import { ListSelect } from './SheetList';
import { Group, GroupAction, Row } from './SettingsControls';
import { Tip } from './components';
import { cn } from './format';
import { presetFit, type ImagePreset } from './presets';
import type { ModelDownload, Models, Profile } from './types';
import type { ShowToast } from './toast';
import { errorText, FileStatus, FOLDERS, folderName, GradeChip, LibraryFooter, percent, post, size, SourceLinks } from './libraryShared';
import { ImageRecipe, isImageImport, OffersGroup, presetFromImport, UseWith, type Availability, type ImportRecord, type ImportResource } from './LibraryImportParts';

export type { ImportRecord, ImportResource } from './LibraryImportParts';

/*
 * Library › Import: one field for a Civitai or Hugging Face link, which also
 * takes a dropped (or chosen) PNG, WebP or JPEG, then the import history as
 * rows. An import opens its record in place (Back returns to Import): the
 * grade with its reasons, the source links, then the Files group, one row per
 * file with its status, size and source. Download Missing in the footer
 * queues every missing file at once; paid and early-access files show as
 * unavailable with the reason. A dropped image shows its picture, prompt and
 * settings with Use Prompt and Use Settings; a missing file's stand-in is
 * marked Substitute, with Use Exact File once the exact one is installed.
 * Other Versions lists the offers that fit; each downloads only when chosen.
 */

type Vision = { available: boolean; reason: string };
const imageTypes = ['image/png', 'image/webp', 'image/jpeg'];
const readDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Couldn’t read that file.'));
  reader.readAsDataURL(file);
});

const kindWords: Record<ImportRecord['input']['kind'], string> = { 'civitai-image': 'Civitai Image', 'civitai-model': 'Civitai Model', 'hf-file': 'Hugging Face File', 'hf-repo': 'Hugging Face Repository', 'image-file': 'Image File', described: 'Described by AI' };
const stateWords: Record<ImportRecord['state'], string> = { resolving: 'Resolving', 'needs-files': 'Needs Files', downloading: 'Downloading', ready: 'Ready', failed: 'Failed', cancelled: 'Cancelled' };
const statusWords: Record<ImportResource['status'], string> = { installed: 'Installed', missing: 'Missing', downloading: 'Downloading', conflict: 'Filename Conflict', unavailable: 'Unavailable', unsupported: 'Not Supported', substitute: 'Substitute' };
const providerWords = (provider?: string) => provider === 'civitai' ? 'Civitai' : provider === 'hf' ? 'Hugging Face' : '';
const unavailableWords: Record<Availability['reason'], string> = { paid: 'Paid', 'early-access': 'Early Access', licence: 'Restricted', 'no-checksum': 'No Checksum' };
const destinations = ['checkpoints', 'clip_vision', 'diffusion_models', 'loras', 'text_encoders', 'vae'].map((value) => ({ value, label: FOLDERS[value] }));
const KindIcon = ({ kind }: { kind: ImportRecord['input']['kind'] }) => kind === 'civitai-image' ? <Image size={16} /> : kind === 'civitai-model' ? <Layers size={16} /> : kind === 'image-file' ? <FileImage size={16} /> : kind === 'described' ? <Sparkles size={16} /> : <Boxes size={16} />;
const substituteWords: Record<NonNullable<ImportResource['substitute']>['kind'], string> = { precision: 'Another Precision', version: 'Another Version', family: 'Same Family' };
const when = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
/** Files Download Missing would queue: required, missing, downloadable. */
const missingOf = (record: ImportRecord) => record.resources.filter((resource) => !resource.optional && resource.status === 'missing' && resource.supported !== false && !resource.unavailable && !resource.unsourced);

let lastImports: ImportRecord[] | null = null;

export function LibraryImport({ showToast, downloads, landed, busy, run, onOpenImage, refreshModels, models, onApply, onPrompt, onClose }: {
  showToast: ShowToast; downloads: ModelDownload[]; landed: number; busy: boolean; run: (action: () => Promise<void>) => void;
  /** A Civitai image link lands in Images: open its review there. */
  onOpenImage: (presetId: string) => void;
  refreshModels: (notify?: boolean) => Promise<unknown>;
  /** A dropped image's prompt and settings go to the composer. */
  models: Models | null; onApply: (preset: ImagePreset, profile: Profile) => void; onPrompt: (preset: ImagePreset) => void; onClose: () => void;
}) {
  const [url, setUrl] = React.useState('');
  const [vision, setVision] = React.useState<Vision | null>(null);
  const [profileId, setProfileId] = React.useState('');
  const picker = React.useRef<HTMLInputElement>(null);
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
      const data = await apiJson<{ imports: ImportRecord[]; vision?: Vision }>('/api/library/imports');
      if (mounted.current) { setImports(keep(data.imports)); setVision(data.vision || null); }
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

  /** The model a dropped image's settings go to: the profile that runs its base model (or its stand-in), else the suggestion. */
  const sourceProfile = (item: ImportRecord) => item.resources.find((resource) => ['checkpoint', 'diffusion_model'].includes(resource.role) && (resource.substitute?.profileId || resource.profileId))
    ? item.resources.map((resource) => resource.substitute?.profileId || resource.profileId).find(Boolean) || '' : item.suggestion?.profileId || '';
  const show = (item: ImportRecord) => { setRecord(item); setProfileId(sourceProfile(item)); };
  const open = (item: ImportRecord) => {
    if (item.input.kind === 'civitai-image' && item.input.presetId && item.state !== 'failed') { onOpenImage(item.input.presetId); return; }
    show(item);
    if (item.state !== 'failed') void reopen(item.id).then((fresh) => { if (mounted.current && recordRef.current?.id === fresh.id) setProfileId((current) => current || sourceProfile(fresh)); }).catch(() => undefined);
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
      show(data.import);
      showToast(data.import.results.catalogueKeys?.length ? 'Imported. Its catalogue entry is written' : 'Imported', 'success');
    } finally { if (mounted.current) setImporting(false); }
  });
  /** A dropped or chosen image: its metadata is read on the server, or the vision model describes it. */
  const upload = (file: File) => run(async () => {
    if (!imageTypes.includes(file.type) && !/\.(png|webp|jpe?g)$/i.test(file.name)) { showToast('Drop a PNG, WebP or JPEG image', 'error'); return; }
    setImporting(true);
    try {
      const data = await post<{ import: ImportRecord }>('/api/library/imports/image', { image: await readDataUrl(file), name: file.name });
      if (!mounted.current) return;
      remember(data.import);
      if (data.import.state === 'failed') { showToast(data.import.error || 'Couldn’t read that image', 'error'); return; }
      show(data.import);
      showToast(data.import.input.kind === 'described' ? 'Described by AI. Check the prompt' : 'Imported', 'success');
    } finally { if (mounted.current) setImporting(false); }
  });
  const drop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = [...event.dataTransfer.files].find((item) => imageTypes.includes(item.type) || /\.(png|webp|jpe?g)$/i.test(item.name));
    if (file) { upload(file); return; }
    const link = event.dataTransfer.getData('text/uri-list').split('\n').find((line) => line && !line.startsWith('#')) || event.dataTransfer.getData('text/plain');
    if (link && /^https:\/\//i.test(link.trim())) { setUrl(link.trim()); submit(link); return; }
    if (event.dataTransfer.files.length) showToast('Drop a PNG, WebP or JPEG image', 'error');
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
  const useExact = (target: ImportRecord, index: number) => run(async () => {
    const data = await post<{ import: ImportRecord }>(`/api/library/imports/${encodeURIComponent(target.id)}/exact`, { index });
    remember(data.import);
    showToast('Using the exact file', 'success');
  });
  const take = (target: ImportRecord, index: number) => run(async () => {
    const data = await post<{ import: ImportRecord; queued: number; failures: string[] }>(`/api/library/imports/${encodeURIComponent(target.id)}/offers`, { index });
    remember(data.import);
    showToast(data.failures.length ? data.failures[0] : `${target.offers?.[index]?.file || 'That file'} queued`, data.failures.length ? 'warning' : 'success');
  });
  const describe = (target: ImportRecord) => run(async () => {
    const data = await post<{ import: ImportRecord }>(`/api/library/imports/${encodeURIComponent(target.id)}/describe`, {});
    remember(data.import);
    if (data.import.state === 'failed') { showToast(data.import.error || 'Couldn’t describe that image', 'error'); return; }
    show(data.import);
    showToast('Described by AI. Check the prompt', 'success');
  });

  if (record) {
    const missing = missingOf(record);
    const live = (resource: ImportResource) => resource.downloadId ? downloads.find((item) => item.id === resource.downloadId) : undefined;
    const image = isImageImport(record);
    const profiles = (models?.profiles || []).filter((item) => item.kind === 'image');
    const profile = profiles.find((item) => item.id === profileId);
    const preset = image && record.preset ? presetFromImport(record) : null;
    const fit = preset && record.input.kind === 'image-file' ? presetFit(preset, profile) : null;
    const canDescribe = image && record.picture && record.state !== 'resolving';
    return <div className="library-page">
      {missing.length || preset ? <LibraryFooter>
        {missing.length ? <button className={cn('btn', !preset && 'is-primary')} disabled={busy} onClick={() => queue(record)}><Download size={16} />Download Missing{missing.length > 1 ? ` (${missing.length})` : ''}</button> : null}
        {preset ? <button className="btn" disabled={busy || !preset.prompt} onClick={() => { onPrompt(preset); onClose(); }}><Wand2 size={15} />Use Prompt</button> : null}
        {preset && fit ? <button className="btn is-primary" disabled={busy || Boolean(fit.blockers.length) || !profile} onClick={() => { if (profile) { onApply(preset, profile); onClose(); } }}><SlidersHorizontal size={16} />Use Settings</button> : null}
      </LibraryFooter> : null}
      <div className="library-review-bar">
        <button type="button" className="btn is-ghost library-back" disabled={busy} onClick={() => setRecord(null)}><ArrowLeft size={16} />Import</button>
        <div className="library-review-actions">
          <SourceLinks links={record.links} label={record.title || 'This Import'} />
          {canDescribe ? <Tip content={vision?.available ? 'Describe with AI: the vision model writes a prompt from the picture' : vision?.reason || 'The assistant model can’t read images.'}>
            <button type="button" className="btn is-ghost" disabled={busy || !vision?.available} onClick={() => describe(record)}><Sparkles size={16} />Describe with AI</button>
          </Tip> : null}
        </div>
      </div>
      {image && record.state !== 'failed' ? <ImageRecipe record={record} /> : <header className="set-page-head">
        <h3 id="library-panel-title">{record.title || record.input.url}</h3>
        <p>{[kindWords[record.input.kind], record.modelType && record.modelType !== 'repository' ? record.modelType : '', record.version, record.baseModel].filter(Boolean).join(' · ')}</p>
      </header>}
      <section className="library-grade-block" aria-label="Grade">
        <div className="library-grade-line"><GradeChip grade={record.grade} /><span className="library-grade-state">{stateWords[record.state]}</span></div>
        <ul className="set-note library-notes">{(record.state === 'failed' ? [record.error || 'Couldn’t import that link'] : record.grade.reasons).map((reason) => <li key={reason}>{reason}</li>)}</ul>
      </section>
      {record.results.catalogueKeys?.length ? <p className="set-note">{record.results.catalogueKeys.length === 1 ? 'Its catalogue entry is written: title, version, family, trigger words, strength, description, links, NSFW and checksum.' : `${record.results.catalogueKeys.length} catalogue entries are written.`}</p> : null}
      {!image && record.resources.some((resource) => ['checkpoint', 'diffusion_model'].includes(resource.role)) ? <p className="set-note">Recorded in the Library. Studio doesn’t draft a profile for a model yet.</p> : null}
      {record.warnings?.length && !fit ? <ul className="set-note library-notes is-blocking">{record.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
      {fit ? <UseWith profiles={profiles} value={profileId} onChange={setProfileId} /> : null}
      {fit?.warnings.length ? <ul className="set-note library-notes">{fit.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
      {fit?.blockers.length ? <ul className="set-note library-notes is-blocking">{fit.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}
      {record.resources.length ? <Group title="Files" action={<GroupAction disabled={busy} onClick={() => run(async () => { await refreshModels(false); await reopen(record.id); })}>Check Again</GroupAction>}
        note={record.resources.some((resource) => resource.folderGuessed && resource.status !== 'installed') ? 'Hugging Face doesn’t say where a file goes. Check each Destination before downloading.' : undefined}>
        {record.resources.map((resource, index) => {
          const download = live(resource);
          const moving = resource.status === 'downloading' || Boolean(download && ['queued', 'downloading'].includes(download.status));
          const progress = download || resource.progress;
          const words = resource.unavailable && resource.status !== 'substitute' ? `Unavailable · ${unavailableWords[resource.unavailable.reason]}` : moving ? (download?.status === 'queued' ? 'Queued' : progress?.totalBytes ? `Downloading ${percent(progress)}%` : 'Downloading…')
            : resource.status === 'installed' && resource.nameOnly ? 'Found By Filename' : resource.status === 'installed' && resource.unverified ? 'Installed · Unverified' : resource.suggested && resource.status === 'installed' ? 'Suggested' : statusWords[resource.status];
          const stand = resource.status === 'substitute' ? resource.substitute : undefined;
          const canMove = record.input.kind.startsWith('hf-') && !['installed', 'downloading'].includes(resource.status) && !moving;
          return <Row key={`${resource.want.folder}/${resource.want.file}/${index}`} className="library-resource" label={resource.want.file || resource.name} description={<>
            <span className="library-line">{[folderName(resource.want.folder), resource.version, size(resource.want.bytes), providerWords(resource.want.source?.provider)].filter(Boolean).join(' · ')}</span>
            {stand ? <span className="library-line library-substitute">Using {stand.file} · {substituteWords[stand.kind]}: {stand.reason}{resource.exactInstalled ? '. The exact file is installed now' : ''}</span> : null}
            {resource.unavailable ? <span className="library-line">{resource.unavailable.note}{resource.unavailable.freeAlternative ? <> <a className="set-link" href={resource.unavailable.freeAlternative.url} target="_blank" rel="noreferrer">Free version: {resource.unavailable.freeAlternative.name}</a></> : null}</span> : resource.note ? <span className="library-line">{resource.note}</span> : null}
            {resource.downloadError ? <span className="library-line library-error" role="alert">{resource.downloadError}</span> : null}
            {moving ? <span className="set-progress" aria-hidden="true"><span style={{ width: `${progress ? percent(progress) : 0}%` }} /></span> : null}
          </>}>
            {canMove ? <span className="library-model-choice"><ListSelect label={`Destination for ${resource.want.file}`} value={resource.want.folder} onChange={(folder) => move(record, index, folder)} options={destinations} /></span> : null}
            {resource.optional && resource.status === 'missing' && resource.supported !== false && !resource.unavailable && !resource.unsourced && !moving ? <button type="button" className="btn is-sm" disabled={busy} onClick={() => queue(record, [index])}><Download size={14} />Download</button> : null}
            {stand && resource.exactInstalled ? <button type="button" className="btn is-sm" disabled={busy} onClick={() => useExact(record, index)}>Use Exact File</button> : null}
            {stand && !resource.exactInstalled && resource.supported && !resource.unavailable && !moving ? <button type="button" className="btn is-sm" disabled={busy} aria-label={`Download Exact File ${resource.want.file}`} onClick={() => queue(record, [index])}><Download size={14} />Download Exact File</button> : null}
            <FileStatus status={resource.unavailable && !stand ? 'unavailable' : moving ? 'downloading' : resource.status}>{words}</FileStatus>
          </Row>;
        })}
      </Group> : null}
      <OffersGroup offers={record.offers || []} busy={busy} onTake={(index) => take(record, index)} />
    </div>;
  }

  return <div className="library-page">
    <header className="set-page-head">
      <h3 id="library-panel-title">Import</h3>
      <p>Paste a Civitai image or model link or a Hugging Face link, or drop an image. Each import says how closely it can be recreated.</p>
    </header>
    <form className={cn('library-link library-drop', dragging && 'is-dragging')} onSubmit={(event) => { event.preventDefault(); submit(); }}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
      <label className="sr-only" htmlFor="library-import-link">Link</label>
      <input id="library-import-link" type="url" placeholder="Paste a link, or drop a link or image here" disabled={busy} value={url} onChange={(event) => setUrl(event.target.value)} required autoComplete="off" />
      <Tip content="Choose a PNG, WebP or JPEG: its prompt, settings and files are read from it">
        <button type="button" className="btn library-pick" disabled={busy} aria-label="Choose Image" onClick={() => picker.current?.click()}><ImageUp size={16} /><span>Image</span></button>
      </Tip>
      <input ref={picker} className="sr-only" type="file" accept="image/png,image/webp,image/jpeg" tabIndex={-1} aria-hidden="true" data-testid="library-image-file"
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) upload(file); }} />
      <button className={cn('btn', url.trim() && 'is-primary')} disabled={busy || !url.trim()}><Import size={16} />{importing ? 'Importing…' : 'Import'}</button>
    </form>
    {importing ? <p className="set-note" role="status">Importing: reading the source, checking its files and grading it.</p> : null}
    {vision && !vision.available ? <p className="set-note">Images without metadata can’t be described: {vision.reason.replace(/\.$/, '')}.</p> : null}
    {loading ? <Group title="History"><div className="list-row is-static library-import-row is-skeleton" aria-busy="true" aria-label="Loading Imports"><span className="library-import-icon" /><span className="list-row-text"><i /><i /></span></div></Group>
      : loadError && !imports.length ? <Group title="History"><EmptyState compact title="Couldn’t Load Imports" action={<button className="btn" onClick={() => { setLoading(true); void load(); }}><RefreshCw size={16} />Try Again</button>}><span role="alert">{loadError}</span></EmptyState></Group>
      : imports.length ? <Group title="History">{imports.map((item) => <button type="button" key={item.id} className="list-row set-row library-import-row" disabled={busy} onClick={() => open(item)}>
        <span className="library-import-icon" aria-hidden="true"><KindIcon kind={item.input.kind} /></span>
        <span className="list-row-text">
          <span className="list-row-label">{item.title || item.input.url}</span>
          <span className="list-row-detail">{[kindWords[item.input.kind], item.baseModel, when(item.createdAt)].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="list-row-control library-import-meta"><GradeChip grade={item.state === 'failed' ? null : item.grade} /><span className={cn('library-status', `is-${item.state}`)}>{stateWords[item.state]}</span></span>
      </button>)}</Group>
      : <Group title="History"><EmptyState compact title="No Imports Yet">Imports from here show here, with their grade.</EmptyState></Group>}
  </div>;
}
