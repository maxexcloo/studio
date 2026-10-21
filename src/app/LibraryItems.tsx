import React from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { apiJson } from './api';
import { EmptyState } from './EmptyState';
import { PickerTools } from './PickerTools';
import { Group, Row } from './SettingsControls';
import { CatalogueFlagsGroup, useDeploymentSettings } from './DeploymentSettings';
import { cn } from './format';
import type { ShowToast } from './toast';
import { errorText, FileStatus, folderName, size, SourceLinks, type Links } from './libraryShared';

/*
 * Library › LoRAs and › Models: what is installed (Installed) or catalogued
 * (Catalogue), each with its provenance, version, links and file. Compact
 * PickerTools search, then kind or family pills. Models also keeps the
 * catalogue switches that used to sit in Settings › Models.
 */

export type LibraryItem = {
  key: string; folder: string; file: string; kind: string; installed: boolean;
  title?: string; version?: string; baseModel?: string; families?: string[]; role?: 'effect' | 'acceleration' | 'supporting';
  triggers?: string[]; strength?: { default?: number; min?: number; max?: number }; note?: string; description?: string; nsfw?: boolean | null;
  links?: Links; source?: { provider: string; modelId?: number; versionId?: number; repo?: string }; origin?: string; sha256?: string; bytes?: number; aiDrafted?: boolean;
};
type View = 'installed' | 'catalogue';

const roleWords = { effect: 'Effect LoRA', acceleration: 'Acceleration Adapter', supporting: 'Supporting File' } as const;
const originWords: Record<string, string> = { seed: 'From the Seed', import: 'Imported', admin: 'Added by Hand', ai: 'AI-Drafted', chat: 'From Chat', manifest: 'From the Manifest' };
const providerWords: Record<string, string> = { civitai: 'Civitai', hf: 'Hugging Face', manifest: 'Manifest' };
const modelKinds = ['checkpoints', 'diffusion_models', 'text_encoders', 'vae', 'clip_vision'];

let cached: LibraryItem[] | null = null;
let pending: Promise<LibraryItem[]> | null = null;
/** One answer for both pages, asked again on each Library open (and on Try Again or a landed file). */
export function loadLibraryItems(fresh = false) {
  if (pending && !fresh) return pending;
  pending = apiJson<{ items: LibraryItem[] }>('/api/library/items').then((data) => { cached = data.items; return data.items; }).finally(() => { pending = null; });
  return pending;
}

export function LibraryItems({ page, landed, showToast }: { page: 'loras' | 'models'; landed: number; showToast: ShowToast }) {
  const [items, setItems] = React.useState<LibraryItem[] | null>(cached);
  const [error, setError] = React.useState('');
  const [view, setView] = React.useState<View>('installed');
  const [pill, setPill] = React.useState('');
  const [query, setQuery] = React.useState('');
  const deployment = useDeploymentSettings(page === 'models');
  const load = React.useCallback((fresh = false) => {
    setError('');
    loadLibraryItems(fresh).then(setItems).catch((reason) => setError(errorText(reason, 'Couldn’t load the list')));
  }, []);
  React.useEffect(() => { load(true); }, [landed, load]);
  React.useEffect(() => { setPill(''); setQuery(''); setView('installed'); }, [page]);

  const mine = (items || []).filter((item) => page === 'loras' ? item.folder === 'loras' : modelKinds.includes(item.folder));
  const inView = mine.filter((item) => view === 'installed' ? item.installed : Boolean(item.origin));
  const pills = page === 'models'
    ? modelKinds.filter((folder) => inView.some((item) => item.folder === folder)).map((folder) => ({ id: folder, label: folderName(folder) }))
    : [...new Set(inView.flatMap((item) => item.families || []))].sort().slice(0, 8).map((family) => ({ id: family, label: family }));
  const needle = query.trim().toLowerCase();
  const visible = inView.filter((item) => (!pill || (page === 'models' ? item.folder === pill : item.families?.includes(pill)))
    && (!needle || [item.title, item.file, item.baseModel, item.version, ...(item.triggers || [])].join(' ').toLowerCase().includes(needle)));
  const label = page === 'loras' ? 'LoRAs' : 'Models';

  return <div className="library-page">
    <header className="set-page-head">
      <h3 id="library-panel-title">{label}</h3>
      <p>{page === 'loras' ? 'LoRAs and supporting files with where they came from. Choose acceleration through a prepared recipe; supporting files stay out of the optional LoRA picker.' : 'Checkpoints, diffusion models, text encoders and VAEs with where they came from.'}</p>
    </header>
    <PickerTools query={query} onClearSearch={() => setQuery('')} onType={(key) => setQuery((current) => current + key)} searchLabel={`Search ${label}`} className="library-tools"
      search={<label className="lora-picker-search picker-search"><Search size={14} /><input value={query} placeholder={`Search ${label}`} aria-label={`Search ${label}`} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); } }} /></label>}>
      <div className="reference-tabs" role="group" aria-label={`${label} View`}>
        {(['installed', 'catalogue'] as const).map((id) => <button key={id} type="button" className={cn(view === id && 'active')} aria-pressed={view === id} onClick={() => { setView(id); setPill(''); }}>{id === 'installed' ? 'Installed' : 'Catalogue'}</button>)}
      </div>
      {pills.length > 1 ? <div className="model-filters library-pills" role="group" aria-label={page === 'models' ? 'Kind' : 'Family'}>
        <span className="model-filter-group">
          <button type="button" className={cn(!pill && 'active')} aria-pressed={!pill} onClick={() => setPill('')}>All</button>
          {pills.map((item) => <button key={item.id} type="button" className={cn(pill === item.id && 'active')} aria-pressed={pill === item.id} onClick={() => setPill(pill === item.id ? '' : item.id)}>{item.label}</button>)}
        </span>
      </div> : null}
    </PickerTools>
    {error && !items ? <EmptyState title={`Couldn’t Load ${label}`} action={<button className="btn" onClick={() => load(true)}><RefreshCw size={16} />Try Again</button>}><span role="alert">{error}</span></EmptyState>
      : items === null ? <Group><Row label={`Loading ${label}…`} /></Group>
      : visible.length ? <Group className="library-items">{visible.map((item) => <ItemRow key={item.key} item={item} page={page} />)}</Group>
      : <EmptyState title={inView.length ? `No Matching ${label}` : view === 'installed' ? `No ${label} Installed` : `No ${label} Catalogued`} action={inView.length ? <button className="btn" onClick={() => { setQuery(''); setPill(''); }}>Clear Search</button> : undefined}>
        {inView.length ? 'Try a different name or filter.' : view === 'installed' ? `${label} on the workers show here.` : 'Imports and the seed catalogue show here.'}
      </EmptyState>}
    {page === 'models' && deployment.settings ? <CatalogueFlagsGroup settings={deployment.settings} showToast={showToast} onSaved={() => void deployment.refresh()} /> : null}
  </div>;
}

function ItemRow({ item, page }: { item: LibraryItem; page: 'loras' | 'models' }) {
  const name = item.title || item.file;
  const what = page === 'loras' ? item.role ? roleWords[item.role] : 'LoRA · Role Unknown' : folderName(item.folder);
  const provenance = [item.source?.provider ? providerWords[item.source.provider] : '', item.origin ? originWords[item.origin] || item.origin : '', item.aiDrafted ? 'AI-Drafted' : '', item.nsfw ? 'NSFW' : ''].filter(Boolean).join(' · ');
  return <Row className="library-item" label={<span className="library-item-title">{name}</span>} description={<>
    <span className="library-line">{[what, item.version, item.baseModel, size(item.bytes)].filter(Boolean).join(' · ')}</span>
    {provenance ? <span className="library-line">{provenance}</span> : null}
    {item.triggers?.length ? <span className="library-line">Trigger Words: {item.triggers.join(', ')}{Number.isFinite(item.strength?.default) ? ` · Strength ${item.strength!.default}` : ''}</span> : Number.isFinite(item.strength?.default) ? <span className="library-line">Strength {item.strength!.default}</span> : null}
    <code className="set-path library-line">{item.key}</code>
    {item.note ? <span className="library-line">{item.note}</span> : null}
  </>}>
    <SourceLinks links={item.links} label={name} />
    <FileStatus status={item.installed ? 'installed' : 'missing'}>{item.installed ? 'Installed' : 'Not Installed'}</FileStatus>
  </Row>;
}
