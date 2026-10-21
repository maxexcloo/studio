import { Download, Image } from 'lucide-react';
import { SafeImg } from './SafeImg';
import { ListSelect } from './SheetList';
import { Group, Row } from './SettingsControls';
import type { ImagePreset, PresetResource } from './presets';
import type { Profile } from './types';
import { FileStatus, size, type Grade, type Links } from './libraryShared';

/*
 * Library › Import, the parts an image import adds to its record: the
 * record types, the picture with its prompt and settings, Use With, and the
 * Other Versions group (offers, which download only when chosen). Kept apart
 * from the page so each stays small.
 */

export type Availability = { reason: 'paid' | 'early-access' | 'licence' | 'no-checksum'; note?: string; freeAlternative?: { versionId?: number; name: string; url?: string } };
export type Substitute = { file: string; folder?: string; kind: 'precision' | 'version' | 'family'; reason: string; profileId?: string };
export type ImportResource = {
  role: string; name: string; version?: string;
  want: { file: string; folder: string; sha256?: string; bytes?: number; source?: { provider?: string; url?: string } };
  status: 'installed' | 'missing' | 'downloading' | 'conflict' | 'unavailable' | 'unsupported' | 'substitute';
  supported?: boolean; note?: string; unavailable?: Availability; optional?: boolean; folderGuessed?: boolean;
  downloadId?: string; downloadError?: string; progress?: { receivedBytes: number; totalBytes: number }; unverified?: boolean; nameOnly?: boolean;
  /** A dropped image's file: how it was found, its LoRA strength and the profile that runs it. */
  matchedBy?: 'hash' | 'name' | 'version'; strength?: number | null; profileId?: string; unsourced?: boolean;
  /** The installed stand-in while the exact file is missing; Use Exact File once it is installed. */
  substitute?: Substitute; exactInstalled?: boolean;
  /** Suggested by the assistant (a described image), or added from an offer. */
  suggested?: boolean; offered?: string;
};
export type Offer = {
  key: string; label: string; relation: 'newer' | 'older' | 'precision' | 'format'; file: string; folder: string; bytes: number;
  baseModel?: string; variant: string; url: string; downloadable: boolean; taken?: boolean; note?: string; unavailable?: Availability;
};
export type ImportRecord = {
  id: string; createdAt: string; state: 'resolving' | 'needs-files' | 'downloading' | 'ready' | 'failed' | 'cancelled';
  input: { kind: 'civitai-image' | 'civitai-model' | 'hf-file' | 'hf-repo' | 'image-file' | 'described'; url?: string; presetId?: string; fileName?: string; format?: string; fromId?: string };
  title: string; version?: string; baseModel?: string; modelType?: string; links?: Links;
  resources: ImportResource[]; offers?: Offer[]; grade: Grade; results: { catalogueKeys?: string[]; galleryItemId?: string }; error?: string; warnings?: string[];
  /** A dropped or described image: its own picture, the prompt and settings it recorded, and the assistant's suggestion. */
  picture?: boolean; preset?: { prompt: string; negative: string; settings: ImagePreset['settings']; warnings?: string[] };
  recipe?: { source: 'a1111' | 'civitai' | 'comfyui' | 'studio'; negativeUsed?: boolean; approximate?: string[]; extraProcessing?: boolean };
  suggestion?: { profileId?: string; profileLabel?: string; model?: string };
};

export const pictureUrl = (record: ImportRecord) => record.picture ? `/api/library/imports/${encodeURIComponent(record.id)}/picture` : '';
export const isImageImport = (record: ImportRecord) => record.input.kind === 'image-file' || record.input.kind === 'described';
const sourceWords: Record<NonNullable<ImportRecord['recipe']>['source'], string> = { a1111: 'A1111 Metadata', civitai: 'Civitai Metadata', comfyui: 'ComfyUI Workflow', studio: 'Studio Metadata' };
const relationWords: Record<Offer['relation'], string> = { newer: 'Newer Version', older: 'Older Version', precision: 'Other Precision', format: 'Other Format' };
const unavailableWords: Record<Availability['reason'], string> = { paid: 'Paid', 'early-access': 'Early Access', licence: 'Restricted', 'no-checksum': 'No Checksum' };
const settingWords = (key: string) => key === 'cfg' ? 'CFG' : key === 'fps' ? 'FPS' : key[0].toUpperCase() + key.slice(1);

/** An image import as the composer's preset: each file under the name it runs as (a stand-in's when one is in use). */
export function presetFromImport(record: ImportRecord): ImagePreset {
  const resources: PresetResource[] = record.resources.filter((resource) => !resource.optional).map((resource) => {
    const there = resource.status === 'installed' || resource.status === 'substitute';
    return {
      versionId: `${resource.want.folder}/${resource.want.file || resource.name}`, weight: resource.role === 'lora' ? resource.strength ?? null : null,
      name: resource.name, type: resource.role, file: resource.want.file, folder: resource.role === 'diffusion_model' ? 'diffusion_models' : resource.want.folder,
      supported: true, nameOnly: resource.nameOnly, status: there ? 'installed' : resource.status === 'conflict' ? 'conflict' : 'missing',
      localName: resource.status === 'substitute' ? resource.substitute?.file : there ? resource.want.file : undefined,
      profileId: resource.substitute?.profileId || resource.profileId || undefined
    };
  });
  return {
    id: record.id, name: record.title, sourceUrl: '', thumbnailUrl: pictureUrl(record), creator: '', baseModel: record.baseModel || '',
    prompt: record.preset?.prompt || '', negative: record.preset?.negative || '', settings: record.preset?.settings || {}, warnings: record.preset?.warnings || [], resources
  };
}

/** The picture beside its prompt, negative and settings, with where they came from. */
export function ImageRecipe({ record }: { record: ImportRecord }) {
  const settings = Object.entries(record.preset?.settings || {}).filter(([, value]) => value !== undefined && value !== '');
  const origin = record.input.kind === 'described' ? `Described by AI${record.suggestion?.model ? ` · ${record.suggestion.model}` : ''}` : record.recipe ? sourceWords[record.recipe.source] : '';
  return <div className="library-review">
    <figure className="library-preview"><SafeImg src={pictureUrl(record)} alt="Imported image" fallback={<Image size={40} />} /></figure>
    <div className="library-recipe">
      <header className="set-page-head">
        <h3 id="library-panel-title">{record.title || 'Dropped Image'}</h3>
        <p>{[origin, record.input.format?.toUpperCase(), record.input.fileName].filter(Boolean).join(' · ')}</p>
      </header>
      <section className="library-prompt"><h4 className="list-section-title">Prompt</h4><p>{record.preset?.prompt || 'No prompt was recorded.'}</p></section>
      {record.preset?.negative ? <section className="library-prompt"><h4 className="list-section-title">Negative Prompt</h4><p>{record.preset.negative}</p></section> : null}
      {settings.length ? <dl className="library-settings">{settings.map(([key, value]) => <div key={key}><dt>{settingWords(key)}</dt><dd>{value}</dd></div>)}</dl> : null}
    </div>
  </div>;
}

const NO_MODEL = 'none';
/** Use With: the model the prompt and settings go to, the source model first when it runs here. */
export function UseWith({ profiles, value, onChange }: { profiles: Profile[]; value: string; onChange: (id: string) => void }) {
  return <Group title="Use With">
    <Row label="Model" description="The source model is picked when it is installed. Another model may change the result.">
      <span className="library-model-choice">
        <ListSelect label="Use With Model" value={value || NO_MODEL} onChange={(next) => onChange(next === NO_MODEL ? '' : next)}
          options={[{ value: NO_MODEL, label: 'Choose a Model' }, ...profiles.map((candidate) => ({ value: candidate.id, label: `${candidate.displayName || candidate.label}${candidate.ready === false ? ' · Setup Required' : ''}` }))]} />
      </span>
    </Row>
  </Group>;
}

/** Other versions and variants that fit: each downloads on its own Download, never automatically. */
export function OffersGroup({ offers, busy, onTake }: { offers: Offer[]; busy: boolean; onTake: (index: number) => void }) {
  if (!offers.length) return null;
  return <Group title="Other Versions" note="Only versions that fit this model’s family and the worker are offered. Nothing downloads until you choose it.">
    {offers.map((offer, index) => <Row key={offer.key} className="library-resource library-offer" label={offer.file} description={<>
      <span className="library-line">{[relationWords[offer.relation], offer.label, offer.variant, offer.baseModel, size(offer.bytes)].filter(Boolean).join(' · ')}</span>
      {offer.unavailable ? <span className="library-line">{offer.unavailable.note}{offer.unavailable.freeAlternative ? <> <a className="set-link" href={offer.unavailable.freeAlternative.url} target="_blank" rel="noreferrer">Free version: {offer.unavailable.freeAlternative.name}</a></> : null}</span> : null}
    </>}>
      {offer.unavailable ? <FileStatus status="unavailable">Unavailable · {unavailableWords[offer.unavailable.reason]}</FileStatus>
        : offer.taken ? <FileStatus status="downloading">Chosen</FileStatus>
          : <button type="button" className="btn is-sm" disabled={busy || !offer.downloadable} aria-label={`Download ${offer.file}`} onClick={() => onTake(index)}><Download size={14} />Download</button>}
    </Row>)}
  </Group>;
}
