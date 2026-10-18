import { History, X } from 'lucide-react';
import type { KeyboardEventHandler, Ref } from 'react';
import { useAutosizeTextarea } from '@/hooks/use-autosize-textarea';
import { Tip } from './components';
import { cn } from './format';

export type PromptFieldProps = {
  kind: 'positive' | 'negative';
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  onHistory: () => void;
  historyAvailable: boolean;
  historyOpen?: boolean;
  textareaRef?: Ref<HTMLTextAreaElement>;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  ariaLabel?: string;
  placeholder?: string;
};

/** One prompt field and its own actions; compact presentation is supplied by the composer. */
export function PromptField({ kind, value, onChange, onClear, onHistory, historyAvailable, historyOpen = false, textareaRef, onKeyDown, ariaLabel, placeholder }: PromptFieldProps) {
  const negative = kind === 'negative';
  const label = negative ? 'Negative Prompt' : 'Prompt';
  const clearLabel = negative ? 'Clear Negative Prompt' : 'Clear Prompt';
  const historyLabel = negative ? 'Recent Negative Prompts' : 'Recent Prompts';
  const ref = useAutosizeTextarea(value, textareaRef, negative ? 180 : 240, 2);

  return <div className={cn('composer-prompt-field', negative && 'is-negative')}>
    <span className="composer-prompt-preview" aria-hidden="true">{value || placeholder || (negative ? label : 'Prompt...')}</span>
    <textarea
      ref={ref}
      aria-label={ariaLabel || label}
      value={value}
      placeholder={placeholder || label}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      rows={2}
      style={{ paddingRight: 72 }}
    />
    <div className="composer-field-tools">
      {<Tip content={historyLabel}>
        <button type="button" data-history-trigger disabled={!historyAvailable} className={cn('prompt-action', historyOpen && 'active')} aria-label={historyLabel} aria-expanded={historyOpen} aria-haspopup="dialog" onClick={onHistory}><History size={15} aria-hidden="true" /></button>
      </Tip>}
      <Tip content={clearLabel}>
        <button type="button" className="prompt-action prompt-clear" aria-label={clearLabel} disabled={!value} onClick={onClear}><X size={15} aria-hidden="true" /></button>
      </Tip>
    </div>
  </div>;
}
