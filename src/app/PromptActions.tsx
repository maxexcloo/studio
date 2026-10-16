import { Eraser, History } from 'lucide-react';
import { Tip } from './components';
import { cn } from './format';

export function PromptActions({ hasHistory, historyOpen, onHistory, hasText, onClear }: { hasHistory: boolean; historyOpen?: boolean; onHistory: () => void; hasText: boolean; onClear: () => void }) {
  return <div className="composer-prompt-tools">
    {hasHistory ? <Tip content="History"><button type="button" data-history-trigger className={cn('prompt-action', historyOpen && 'active')} aria-label="Recent Prompts" aria-expanded={historyOpen || false} aria-haspopup="dialog" onClick={onHistory}><History size={16} /></button></Tip> : null}
    <Tip content="Clear"><button type="button" className="prompt-action" aria-label="Clear Prompt & Negative" disabled={!hasText} onClick={onClear}><Eraser size={16} /></button></Tip>
  </div>;
}
