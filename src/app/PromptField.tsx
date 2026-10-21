import { Check, History, TextSelect, X } from 'lucide-react';
import { useCallback, useRef, type KeyboardEventHandler, type Ref } from 'react';
import { useAutosizeTextarea } from '@/hooks/use-autosize-textarea';
import { Tip } from './components';
import { cn } from './format';
import { useTextFocus } from './useTextFocus';

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
  /** Fill the height the layout gives it instead of growing with the text; its actions sit in the lower corner. */
  fill?: boolean;
  /** The fewest lines it shows (two by default). */
  minRows?: number;
  /** A Select All action beside History and Clear (the phone, where a long press is fiddly). */
  selectAll?: boolean;
  /** The phone: focusing the field shows only it, above the keyboard, with Done (useTextFocus). */
  focusMode?: boolean;
  onFocusModeChange?: (focused: boolean) => void;
};

/** One prompt field and its own actions; compact presentation is supplied by the composer. */
export function PromptField({ kind, value, onChange, onClear, onHistory, historyAvailable, historyOpen = false, textareaRef, onKeyDown, ariaLabel, placeholder, fill = false, minRows = 2, selectAll = false, focusMode = false, onFocusModeChange }: PromptFieldProps) {
  const negative = kind === 'negative';
  const label = negative ? 'Negative Prompt' : 'Prompt';
  const clearLabel = negative ? 'Clear Negative Prompt' : 'Clear Prompt';
  const historyLabel = negative ? 'Recent Negative Prompts' : 'Recent Prompts';
  const field = useRef<HTMLTextAreaElement | null>(null);
  const forward = useCallback((node: HTMLTextAreaElement | null) => {
    field.current = node;
    if (typeof textareaRef === 'function') textareaRef(node);
    else if (textareaRef) (textareaRef as { current: HTMLTextAreaElement | null }).current = node;
  }, [textareaRef]);
  const ref = useAutosizeTextarea(value, forward, negative ? 180 : 240, fill ? undefined : minRows, !fill);
  const focus = useTextFocus(focusMode, onFocusModeChange);
  const selectAllLabel = negative ? 'Select All of the Negative Prompt' : 'Select All of the Prompt';

  return <div {...focus.bind} className={cn('composer-prompt-field', negative && 'is-negative', fill && 'is-fill', focus.focused && 'is-text-focused')}>
    <span className="composer-prompt-preview" aria-hidden="true">{value || placeholder || (negative ? label : 'Prompt...')}</span>
    <textarea
      ref={ref}
      aria-label={ariaLabel || label}
      value={value}
      placeholder={placeholder || label}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      rows={fill ? undefined : minRows}
      style={fill ? undefined : { paddingRight: 72 }}
    />
    <div className="composer-field-tools">
      {focus.focused ? <button type="button" className="prompt-action prompt-done" {...focus.keepFocus} onClick={focus.done}><Check size={16} aria-hidden="true" /><span>Done</span></button> : null}
      {selectAll ? <Tip content={selectAllLabel}>
        <button type="button" className="prompt-action prompt-select-all" {...focus.keepFocus} aria-label={selectAllLabel} disabled={!value} onClick={() => { const node = field.current; if (!node) return; node.focus({ preventScroll: true }); node.setSelectionRange(0, node.value.length); }}><TextSelect size={16} aria-hidden="true" /></button>
      </Tip> : null}
      {<Tip content={historyLabel}>
        <button type="button" data-history-trigger disabled={!historyAvailable} className={cn('prompt-action', historyOpen && 'active')} aria-label={historyLabel} aria-expanded={historyOpen} aria-haspopup="dialog" onClick={onHistory}><History size={16} aria-hidden="true" /></button>
      </Tip>}
      <Tip content={clearLabel}>
        <button type="button" className="prompt-action prompt-clear" {...focus.keepFocus} aria-label={clearLabel} disabled={!value} onClick={onClear}><X size={16} aria-hidden="true" /></button>
      </Tip>
    </div>
  </div>;
}
