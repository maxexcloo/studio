import { Check, LoaderCircle, Plus, Sparkles, Square, X, ChevronDown } from 'lucide-react';
import { Tip } from './components';
import { Dropdown, type DropdownAction } from './Dropdown';
import { cn } from './format';
import type { LoraSuggestion, PromptAssistant } from './usePromptAssistant';

/**
 * The prompt assistant's controls (UI-PATTERNS › Composer): the magic button in the prompt's action
 * row, the negative writer beside Negative, and the suggested LoRAs as chips under the prompt.
 * They render nothing while the account has no assistant.
 */

/** The desktop's room for the magic button and its caret beside History and Clear. */
export const assistantButtonWidth = 52;
export const negativeAssistantWidth = 30;

// Enhance leads, the other presets read alphabetically, and Suggest LoRAs (an action) closes the menu.
const presetOrder = (a: { id: string; label: string }, b: { id: string; label: string }) => Number(b.id === 'enhance') - Number(a.id === 'enhance') || a.label.localeCompare(b.label);
const presetOptions = (assistant: PromptAssistant) => [...assistant.presets].sort(presetOrder).map((preset) => ({ value: preset.id, label: preset.label, detail: preset.description }));
const presetActions = (assistant: PromptAssistant): DropdownAction[] => assistant.lorasOffered ? [{ id: 'loras', label: 'Suggest LoRAs', onSelect: assistant.suggestLoras, disabled: Boolean(assistant.busy) }] : [];

/**
 * The magic button. On the desktop it rewrites with the last preset and a caret beside it picks
 * another (the shared Dropdown); on the phone it opens that list as the usual pop-up list, with
 * the last preset ticked. While a rewrite streams in, it is Stop.
 */
export function PromptAssistantButton({ assistant, phone = false, focused = false, keepFocus = {}, hasPrompt }: { assistant: PromptAssistant; phone?: boolean; /** The phone's focused-text row: one tap rewrites with the last preset, keeping the keyboard up. */ focused?: boolean; keepFocus?: Record<string, unknown>; hasPrompt: boolean }) {
  if (!assistant.available) return null;
  const writing = assistant.busy === 'rewrite' || assistant.busy === 'negative';
  const note = assistant.referencesNote;
  if (writing) {
    return <Tip content="Stop Rewriting">
      <button type="button" className="prompt-action prompt-assistant is-busy" {...keepFocus} aria-label="Stop Rewriting" onClick={assistant.stop}><Square size={13} fill="currentColor" aria-hidden="true" /></button>
    </Tip>;
  }
  const label = `Rewrite Prompt · ${assistant.presetLabel}`;
  if (phone && focused) {
    return <button type="button" className="prompt-action prompt-assistant" {...keepFocus} aria-label={label} aria-description={note || undefined} disabled={!hasPrompt || Boolean(assistant.busy)} onClick={() => assistant.rewrite()}><Sparkles size={16} aria-hidden="true" /></button>;
  }
  if (phone) {
    return <Dropdown
      variant="icon"
      className="prompt-action prompt-assistant prompt-assistant-menu"
      label="Prompt Assistant"
      triggerLabel={note ? `Prompt Assistant. ${note}` : 'Prompt Assistant'}
      summary={assistant.busy === 'loras' ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
      options={presetOptions(assistant)}
      value={assistant.preset}
      reselect
      onChange={(id) => assistant.rewrite(id)}
      actions={presetActions(assistant)}
    />;
  }
  return <span className="prompt-assistant-split">
    <Tip content={<span className="prompt-assistant-tip">{label}{note ? <small>{note}</small> : null}</span>}>
      <button type="button" className="prompt-action prompt-assistant" aria-label={label} aria-description={note || undefined} disabled={!hasPrompt || Boolean(assistant.busy)} onClick={() => assistant.rewrite()}>
        {assistant.busy === 'loras' ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
      </button>
    </Tip>
    <Dropdown
      variant="icon"
      className="prompt-action prompt-assistant-caret"
      label="Rewrite Presets"
      summary={<ChevronDown size={12} aria-hidden="true" />}
      options={presetOptions(assistant)}
      value={assistant.preset}
      disabled={Boolean(assistant.busy)}
      reselect
      onChange={(id) => assistant.rewrite(id)}
      actions={presetActions(assistant)}
    />
  </span>;
}

/** The negative writer beside Negative; absent where the model takes no negative. */
export function NegativeAssistantButton({ assistant, hasPrompt }: { assistant: PromptAssistant; hasPrompt: boolean }) {
  if (!assistant.negativeOffered) return null;
  const busy = assistant.busy === 'negative';
  return <Tip content="Write Negative Prompt">
    <button type="button" className="prompt-action prompt-assistant" aria-label="Write Negative Prompt" disabled={!hasPrompt || Boolean(assistant.busy)} aria-busy={busy || undefined} onClick={assistant.writeNegative}>
      {busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
    </button>
  </Tip>;
}

const strength = (value: number) => (Math.round(value * 100) / 100).toFixed(2).replace(/0$/, '');

/** One suggested LoRA: its title, strength and trigger words; a tap adds it (or takes it off again). */
function SuggestionChip({ item, added, onToggle }: { item: LoraSuggestion; added: boolean; onToggle: () => void }) {
  const triggers = (item.triggers || []).filter(Boolean);
  return <button type="button" className={cn('assistant-chip', added && 'is-added')} aria-pressed={added} aria-label={`${added ? 'Remove' : 'Add'} ${item.title}, strength ${strength(item.strength)}${triggers.length ? `, triggers ${triggers.join(', ')}` : ''}`} title={item.reason || undefined} onClick={onToggle}>
    {added ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
    <strong>{item.title}</strong>
    <em>{strength(item.strength)}</em>
    {triggers.length ? <small>{triggers.slice(0, 2).join(', ')}{triggers.length > 2 ? ` +${triggers.length - 2}` : ''}</small> : null}
  </button>;
}

/** The suggestions under the prompt: a row of chips ending in Add All, scrolling sideways on a phone. */
export function LoraSuggestionChips({ assistant }: { assistant: PromptAssistant }) {
  const list = assistant.suggestions;
  if (!assistant.lorasOffered || !list.length) return null;
  const waiting = list.filter((item) => !assistant.isAdded(item.name));
  return <div className="assistant-chips" role="group" aria-label="Suggested LoRAs">
    <span className="assistant-chips-label" aria-hidden="true"><Sparkles size={14} /></span>
    <div className="assistant-chips-scroll">
      {list.map((item) => <SuggestionChip key={item.name} item={item} added={assistant.isAdded(item.name)} onToggle={() => assistant.isAdded(item.name) ? assistant.removeSuggestion(item.name) : assistant.addSuggestion(item)} />)}
      {waiting.length > 1 ? <button type="button" className="assistant-chip is-all" onClick={assistant.addAllSuggestions}>Add All</button> : null}
    </div>
    <Tip content="Dismiss Suggestions">
      <button type="button" className="prompt-action assistant-chips-dismiss" aria-label="Dismiss Suggestions" onClick={assistant.dismissSuggestions}><X size={14} aria-hidden="true" /></button>
    </Tip>
  </div>;
}
