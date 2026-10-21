import { ListChecks, RotateCcw, TextQuote } from 'lucide-react';
import { cn } from './format';
import { Tip } from './components';
import { CopyIcon, useCopyFeedback } from './CopyFeedback';

/*
 * The Details panel's pieces (docs/guides/UI-PATTERNS.md): each prompt with
 * its own Copy, the settings unboxed, and a footer of Copy Prompts · Copy
 * Settings over Edit (prompts and settings, a new seed) and Rerun (an exact
 * rerun, seed included). Edit and Rerun close the viewer and open Create.
 */

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
        <span>{label}</span>
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
 * The Details footer, the same on both: Edit · Rerun, with Copy and Copy Settings in the header.
 * Edit · Rerun as two equal buttons (Rerun the primary). Neither repeats in
 * the viewer's bar while Details is open.
 */
export function DetailsCopyActions({ onCopyAll, onCopySettings }: { onCopyAll?: () => Promise<boolean>; onCopySettings?: () => Promise<boolean> }) {
  const copy = useCopyFeedback();
  return <div className="details-copy-actions" role="group" aria-label="Copy Details">
      {onCopyAll || onCopySettings ? (
        <div className="details-footer-row">
          {onCopyAll ? <button type="button" className={cn('btn details-footer-btn', copy.copied === 'all' && 'is-copied')} onClick={() => { void copy.copyWith(onCopyAll, 'all'); }}><CopyIcon copied={copy.copied === 'all'} size={15} /><span>{copy.copied === 'all' ? 'Copied' : 'Copy'}</span></button> : null}
          {onCopySettings ? <button type="button" className={cn('btn details-footer-btn', copy.copied === 'settings' && 'is-copied')} onClick={() => { void copy.copyWith(onCopySettings, 'settings'); }}>{copy.copied === 'settings' ? <CopyIcon copied size={15} /> : <ListChecks size={15} />}<span>{copy.copied === 'settings' ? 'Copied' : 'Copy Settings'}</span></button> : null}
        </div>
      ) : null}
  </div>;
}

export function DetailsFooter({ onEdit, onRerun, onCompare }: { onCompare?: () => void; onEdit?: () => void; onRerun?: () => void }) {
  if (!onEdit && !onRerun) return null;
  return (
    <div className="details-footer" role="group" aria-label="Details Actions">
      {onCompare ? <button type="button" className="btn" onClick={onCompare}>Compare Variants</button> : null}
      {onEdit || onRerun ? (
        <div className="details-footer-row">
          {onEdit ? <Tip content="Edit Prompt & Settings in Create"><button type="button" className="btn details-footer-btn" onClick={onEdit}><TextQuote size={15} /><span>Edit</span></button></Tip> : null}
          {onRerun ? <Tip content="Rerun With the Same Seed"><button type="button" className="btn is-primary details-footer-btn" onClick={onRerun}><RotateCcw size={15} /><span>Rerun</span></button></Tip> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Generation Settings as plain text, for Copy Settings: a heading per section, then "Name: value"; a LoRA keeps its file in brackets, so the text can rebuild the run. */
export function settingsText(sections: Array<{ title: string; rows: Array<[string, unknown]>; loras?: Array<{ name: string; file?: string; strength: unknown }> }>) {
  return sections.map((section) => [
    section.title,
    ...section.rows.map(([key, value]) => `${key}: ${value}`),
    ...(section.loras || []).map((lora) => `${lora.name}${lora.file && lora.file !== lora.name ? ` (${lora.file})` : ''}: ${lora.strength}`),
  ].join('\n')).join('\n\n');
}
