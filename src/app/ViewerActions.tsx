import { Copy, ListChecks, RotateCcw, TextQuote, Undo2 } from 'lucide-react';
import { cn } from './format';
import { Tip } from './components';
import { CopyIcon, useCopyFeedback } from './CopyFeedback';

/*
 * The Details panel's pieces (docs/guides/UI-PATTERNS.md): each prompt with
 * its own Copy and Use, the settings unboxed, and a footer of Reuse (both
 * prompts) and Recreate (an exact rerun, seed included). Use, Reuse and
 * Recreate close the viewer and open the prompt box.
 */

/** A prompt as text, with Copy and Use beside its label. */
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
            {onUse ? <Tip content={`Use ${name} in the Prompt Box`}><button type="button" className="readout-action" aria-label={`Use ${name}`} onClick={onUse}><Undo2 size={14} /><span>Use</span></button></Tip> : null}
          </span>
        ) : null}
      </header>
      <p className={cn(!text && 'is-empty')}>{text || 'No prompt recorded'}</p>
    </section>
  );
}

/** The phone's shortcuts at the top of Details: Copy the prompt, or the settings as text. */
export function DetailsShortcuts({ onCopyPrompt, onCopySettings }: { onCopyPrompt?: () => Promise<boolean>; onCopySettings?: () => Promise<boolean> }) {
  const copy = useCopyFeedback();
  if (!onCopyPrompt && !onCopySettings) return null;
  return (
    <div className="details-shortcuts" role="group" aria-label="Copy">
      {onCopyPrompt ? <button type="button" className={cn('readout-action', copy.copied === 'prompt' && 'is-copied')} aria-label="Copy Prompt" onClick={() => { void copy.copyWith(onCopyPrompt, 'prompt'); }}>{copy.copied === 'prompt' ? <CopyIcon copied size={14} /> : <Copy size={14} />}<span>{copy.copied === 'prompt' ? 'Copied' : 'Copy'}</span></button> : null}
      {onCopySettings ? <button type="button" className={cn('readout-action', copy.copied === 'settings' && 'is-copied')} aria-label="Copy Settings" onClick={() => { void copy.copyWith(onCopySettings, 'settings'); }}>{copy.copied === 'settings' ? <CopyIcon copied size={14} /> : <ListChecks size={14} />}<span>{copy.copied === 'settings' ? 'Copied' : 'Settings'}</span></button> : null}
    </div>
  );
}

/** Reuse loads both prompts; Recreate loads everything, seed included, for an exact rerun. */
export function DetailsFooter({ onReuse, onRecreate }: { onReuse?: () => void; onRecreate?: () => void }) {
  if (!onReuse && !onRecreate) return null;
  return (
    <div className="viewer-actions details-footer" role="group" aria-label="Reuse">
      {onReuse ? <Tip content="Load Both Prompts Into the Prompt Box"><button type="button" className="btn viewer-action" onClick={onReuse}><TextQuote size={15} /><span className="viewer-action-label">Reuse</span></button></Tip> : null}
      {onRecreate ? <Tip content="Recreate With the Same Seed"><button type="button" className="btn is-primary viewer-action viewer-action-main" onClick={onRecreate}><RotateCcw size={15} /><span className="viewer-action-label">Recreate</span></button></Tip> : null}
    </div>
  );
}

/** Generation Settings as plain text, for Copy Settings: a heading per section, then "Name: value". */
export function settingsText(sections: Array<{ title: string; rows: Array<[string, unknown]>; loras?: Array<{ name: string; strength: unknown }> }>) {
  return sections.map((section) => [
    section.title,
    ...section.rows.map(([key, value]) => `${key}: ${value}`),
    ...(section.loras || []).map((lora) => `${lora.name}: ${lora.strength}`),
  ].join('\n')).join('\n\n');
}
