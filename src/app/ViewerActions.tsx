import { MessageSquare, RotateCcw } from 'lucide-react';
import { assistantSummary, cn } from './format';
import { Tip } from './components';
import { CopyIcon, useCopyFeedback } from './CopyFeedback';
import type { GalleryItem } from './types';

/* Details shares one Copy · Refine · Recreate footer on desktop and phone. */

/** A prompt as text, with Copy beside its label. */
export function PromptReadout({ label, text, onCopy, onUse }: {
  label: 'Prompt' | 'Negative';
  text: string;
  onCopy: () => Promise<boolean>;
  /** Left out where it can't be used (nothing recorded, or an earlier image without settings). */
  onUse?: () => void;
}) {
  const copy = useCopyFeedback();
  const name = label === 'Prompt' ? 'Prompt' : 'Negative Prompt';
  return (
    <section className="prompt-readout" aria-label={name}>
      <header className="prompt-readout-head">
        <h3 className="detail-heading">{label}</h3>
        {text ? (
          <span className="prompt-readout-actions">
            <Tip content={`Copy ${name}`}><button type="button" className={cn('readout-action', copy.copied && 'is-copied')} aria-label={`Copy ${name}`} onClick={() => { void copy.copyWith(onCopy); }}><CopyIcon copied={Boolean(copy.copied)} size={14} /><span>{copy.copied ? 'Copied' : 'Copy'}</span></button></Tip>
          </span>
        ) : null}
      </header>
      <p className={cn(!text && 'is-empty')}>{text || 'No prompt recorded'}</p>
    </section>
  );
}

/**
 * Only what was set, at every depth: no blank text, empty lists or objects,
 * switched-off flags or switched-off LoRAs (`enabled: false`); numbers (seed 0 too) stay.
 */
const prune = (value: unknown): unknown => {
  if (value === undefined || value === null || value === false) return undefined;
  if (typeof value === 'string') return value.trim() ? value : undefined;
  if (Array.isArray(value)) {
    const items = value.filter((item) => !(item && typeof item === 'object' && (item as { enabled?: unknown }).enabled === false)).map(prune).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as object).map(([key, item]) => [key, prune(item)] as const).filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value;
};

/** Copies the saved generation inputs that were set, with IDs, numbers and nested reference settings. */
export function generationInputsText(item: GalleryItem) {
  const settings = Object.fromEntries(Object.entries(item.settings || {}).filter(([key]) => !/^(?:output|artifact|timing|preview|thumbnail)/i.test(key) && !['createdAt', 'durationMs', 'jobId', 'url', 'filename', 'status', 'progress'].includes(key)));
  const inputs = {
    ...settings,
    kind: item.type,
    model: item.model || settings.modelName || '',
    width: settings.width ?? item.width,
    height: settings.height ?? item.height,
    ...(item.startImageId || item.referenceImage ? { startImageId: item.startImageId || item.referenceImage } : {}),
    ...(item.referenceImageName ? { startImageName: item.referenceImageName } : {}),
  };
  const labels: Record<string, string> = { seed: 'Seed', model: 'Model', kind: 'Kind', width: 'Width', height: 'Height', profileId: 'Profile ID', steps: 'Steps', cfg: 'CFG' };
  return [item.prompt ? `Prompt: ${item.prompt}` : '', item.negative ? `Negative: ${item.negative}` : '', assistantSummary(item) ? `Written By: ${assistantSummary(item)}` : '', ...Object.entries(inputs).map(([key, value]) => [key, prune(value)] as const).filter(([, value]) => value !== undefined).map(([key, value]) => `${labels[key] || key}: ${typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : String(value)}`)].filter(Boolean).join('\n\n');
}

/** Copy · Refine · Recreate. Refine in Chat hands the result to the deployment's chat (refineInChat.ts). */
export function DetailsFooter({ onCopy, onRecreate, onRefine }: { onCopy: () => Promise<boolean>; onRecreate?: () => void; onRefine?: () => void }) {
  const copy = useCopyFeedback();
  return <div className="details-footer" role="group" aria-label="Details Actions">
    <div className="details-footer-row">
      <button type="button" className={cn('btn details-footer-btn', copy.copied && 'is-copied')} onClick={() => { void copy.copyWith(onCopy); }}><CopyIcon copied={Boolean(copy.copied)} size={15} /><span>{copy.copied ? 'Copied' : 'Copy'}</span></button>
      {onRefine ? <Tip content="Refine in Chat"><button type="button" className="btn details-footer-btn" aria-label="Refine in Chat" onClick={onRefine}><MessageSquare size={15} /><span>Refine</span></button></Tip> : null}
      {onRecreate ? <Tip content="Recreate With the Same Seed"><button type="button" className="btn is-primary details-footer-btn" onClick={onRecreate}><RotateCcw size={16} /><span>Recreate</span></button></Tip> : null}
    </div>
  </div>;
}
