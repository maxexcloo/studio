import { History, X } from 'lucide-react';
import { cn } from './format';

export function PromptActions({ hasHistory, historyOpen, onHistory, hasText, onClear }: { hasHistory: boolean; historyOpen?: boolean; onHistory: () => void; hasText: boolean; onClear: () => void }) {
  return <div className="composer-prompt-tools">
    <div className="composer-reference-tools" />
    {hasHistory ? <button type="button" data-history-trigger className={cn('prompt-action', historyOpen && 'active')} aria-label="Recent Prompts" aria-expanded={historyOpen || false} aria-haspopup="dialog" onClick={onHistory}><History size={16} /> History</button> : null}
    <button type="button" className="prompt-action" aria-label="Clear Prompt & Negative" disabled={!hasText} onClick={onClear}><X size={16} /> Clear</button>
  </div>;
}
