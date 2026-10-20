import { compatibilityNote, strengthRange as publishedStrengthRange } from '../../server/lora-policy';
import { optionalLoras } from './modelRecipes';
import { loraName, modelFamilyLabel, modelLoras } from './catalogueNames';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, Reorder, useDragControls } from 'framer-motion';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronUp, ExternalLink, GripVertical, Info, Layers, Plus, RotateCcw, Save, Search, Star, X } from 'lucide-react';
import { cn } from './format';
import { defaultLoraStrength, loraGroups, maxLoras, recommendedLoras, rankedLoras, type FitOf } from './loras';
import { Switch } from './SettingsControls';
import { Tip } from './components';
import { EmptyState } from './EmptyState';
import { useReorderDrag } from './useReorderDrag';
import { ClearSelection } from './SheetList';
import { copyText } from './api';
import { showToastTone } from './toast';
import { loraFit, useLoraInfo, type LoraInfo } from './useLoraInfo';
import type { LoraSnapshot } from './lora-storage';
import type { LoraSelection, Profile } from './types';

export type LoraLibraryApi = {
  familyLabel: string;
  stacks: LoraSnapshot[];
  favorites: string[];
  recents: string[];
  loadStack: (stack: LoraSnapshot) => void;
  saveStack: (name: string) => LoraSnapshot;
  updateStack: (id: string) => void;
  renameStack: (id: string, name: string) => void;
  deleteStack: (stack: LoraSnapshot) => Promise<boolean>;
  toggleFavorite: (name: string) => void;
  recordRecents: (names: string[]) => void;
};

const strengthMin = 0;
const strengthMax = 2;

function fileName(name: string) {
  const parts = name.split(/[\\/]/);
  return (parts[parts.length - 1] || name).replace(/\.(safetensors|ckpt|pt|bin)$/i, '');
}

function folderOf(name: string) {
  const parts = name.split(/[\\/]/).filter(Boolean);
  return parts.slice(0, -1).join(' / ');
}

function sameStack(a: LoraSelection[], b: LoraSelection[]) {
  return a.length === b.length && a.every((item, index) => item.name === b[index].name && item.enabled === b[index].enabled && Math.abs(item.strength - b[index].strength) < 0.001);
}

const round = (value: number) => Math.round(value * 100) / 100;

/* ------------------------------------------------------------------ Card */

function StrengthControl({ value, onChange, disabled, label, info }: { value: number; onChange: (next: number) => void; disabled?: boolean; label: string; info?: LoraInfo }) {
  const [draft, setDraft] = useState<string | null>(null);
  const bounds = publishedStrengthRange(info);
  const min = bounds?.min ?? strengthMin;
  const max = bounds?.max ?? strengthMax;
  const clamp = (next: number) => Math.max(bounds?.min ?? -4, Math.min(bounds?.max ?? 4, next));
  const fill = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const commit = () => {
    if (draft === null) return;
    const next = Number(draft.replace(',', '.'));
    if (Number.isFinite(next)) onChange(round(clamp(next)));
    setDraft(null);
  };
  return (
    <div className={cn('lora-strength', disabled && 'is-disabled')}>
      <input
        type="range"
        disabled={disabled}
        aria-label={`${label} Strength`}
        min={min}
        max={max}
        step={bounds?.step ?? 0.05}
        value={Math.max(min, Math.min(max, value))}
        style={{ '--fill': `${fill * 100}%` } as React.CSSProperties}
        onChange={(event) => onChange(round(Number(event.target.value)))}
        onDoubleClick={() => onChange(clamp(bounds?.default ?? defaultLoraStrength))}
      />
      <Tip content="Type a value. Arrow keys nudge by 0.01, Shift by 0.1">
        <input
          className="lora-strength-value is-bare"
          disabled={disabled}
          aria-label={`${label} Strength Value`}
          inputMode="decimal"
          value={draft ?? value.toFixed(2)}
          onFocus={(event) => { setDraft(value.toFixed(2)); requestAnimationFrame(() => event.target.select()); }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); commit(); (event.target as HTMLInputElement).blur(); }
            if (event.key === 'Escape') { event.stopPropagation(); setDraft(null); (event.target as HTMLInputElement).blur(); }
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              const step = event.shiftKey ? 0.1 : 0.01;
              const moved = value + (event.key === 'ArrowUp' ? step : -step);
              const next = round(bounds ? clamp(moved) : moved);
              onChange(next);
              setDraft(next.toFixed(2));
            }
          }}
        />
      </Tip>
    </div>
  );
}

/**
 * One LoRA: name and its on/off switch on top, strength underneath, all on
 * one left edge. The grip and remove button stay out of the way until the
 * card is hovered or focused.
 */
/** The words a LoRA was trained to answer to; a click copies one for the prompt. */
function TriggerWords({ words }: { words: string[] }) {
  const [copied, setCopied] = useState('');
  if (!words.length) return null;
  const copy = async (word: string) => {
    if (!await copyText(word)) return;
    setCopied(word);
    window.setTimeout(() => setCopied((current) => (current === word ? '' : current)), 1400);
  };
  return (
    <p className="lora-triggers">
      <span>Trigger</span>
      {words.map((word) => (
        <Tip key={word} content={copied === word ? 'Copied' : 'Copy for the Prompt'}>
          <button type="button" className={cn('lora-trigger', copied === word && 'is-copied')} onClick={() => copy(word)}>{word}</button>
        </Tip>
      ))}
    </p>
  );
}

/** Where a LoRA came from (its Civitai or Hugging Face page), as a link icon beside its info. */
function LoraSource({ info, label }: { info?: LoraInfo; label: string }) {
  const source = info?.sourceUrl && /^https?:\/\//i.test(info.sourceUrl) ? info.sourceUrl : '';
  if (!source) return null;
  return <Tip content="View Source"><a className="lora-source" href={source} target="_blank" rel="noopener noreferrer" aria-label={`View Source of ${label}`}><ExternalLink size={14} /></a></Tip>;
}

function LoraDetails({ info, label }: { info?: LoraInfo; label: string }) {
  const description = info?.description || info?.about;
  return <details className="lora-details">
    <summary aria-label={`Information About ${label}`} title="Info"><Info size={14} /></summary>
    <div>
      {description ? <p>{description}</p> : <p>No description is available.</p>}
      {info?.note ? <p>{info.note}</p> : null}
      {info?.guidance ? <p className="lora-guidance">{info.guidance}</p> : null}
      {info?.triggers?.length ? <TriggerWords words={info.triggers} /> : null}
    </div>
  </details>;
}

function LoraCard({ item, index, count, missing, overLimit, info, otherModel, policyNote, onChange, onRemove, onSwap, onMove }: {
  item: LoraSelection;
  index: number;
  count: number;
  missing: boolean;
  overLimit: boolean;
  info?: LoraInfo;
  /** Made for another model than this one: its name for it, else empty. */
  otherModel: string;
  policyNote: string;
  onChange: (patch: Partial<LoraSelection>) => void;
  onRemove: () => void;
  onSwap: () => void;
  onMove: (to: number) => void;
}) {
  const controls = useDragControls();
  const label = loraName(item.name, info);
  return (
    <Reorder.Item as="div" value={item} dragListener={false} dragControls={controls} style={{ position: 'relative' }} whileDrag={{ scale: 1.02, zIndex: 5, boxShadow: '0 12px 32px rgb(0 0 0 / 0.45), inset 0 0 0 1px rgb(255 255 255 / 0.14)' }} className={cn('lora-card', !item.enabled && 'is-off', (missing || overLimit) && 'has-warning')}>
      {count > 1 ? (
        <button
          type="button"
          className="lora-grip"
          aria-label={`Reorder ${label}. Use the arrow keys to move it.`}
          onPointerDown={(event) => controls.start(event)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' && index > 0) { event.preventDefault(); onMove(index - 1); }
            if (event.key === 'ArrowDown' && index < count - 1) { event.preventDefault(); onMove(index + 1); }
          }}
        >
          <GripVertical size={13} />
        </button>
      ) : null}
      <div className="lora-card-top">
        <Tip content={`${item.name} · Click to Swap`}>
          <button type="button" className="lora-name" onClick={onSwap}>{label}</button>
        </Tip>
        <Tip content="Remove"><button type="button" className="lora-remove" aria-label={`Remove ${label}`} onClick={onRemove}><X size={13} /></button></Tip>
        <Switch size="sm" label={item.enabled ? `Turn Off ${label}` : `Turn On ${label}`} checked={item.enabled} onChange={(enabled) => onChange({ enabled })} />
      </div>
      <StrengthControl label={label} info={info} value={item.strength} disabled={!item.enabled} onChange={(strength) => onChange({ strength })} />
      {!missing && item.enabled && info?.triggers?.length ? <TriggerWords words={info.triggers} /> : null}
      {missing ? <p className="lora-warning"><AlertTriangle size={12} /> Not in ComfyUI’s LoRA folder</p> : null}
      {!missing && overLimit ? <p className="lora-warning"><AlertTriangle size={12} /> Over this workflow’s limit, so it isn’t used</p> : null}
      {!missing && info?.role && info.role !== 'effect' ? <p className="lora-warning is-soft"><AlertTriangle size={12} />{info.role === 'acceleration' ? 'Use its prepared recipe instead of stacking accelerators.' : 'Supporting file; not an optional generation effect.'} {info.note || ''}</p> : null}
      {!missing && policyNote ? <p className="lora-warning is-soft"><AlertTriangle size={12} />{policyNote}</p> : null}
      {!missing && !overLimit && otherModel && !policyNote ? <p className="lora-warning is-soft"><AlertTriangle size={12} /> Made for {otherModel}, so it may not work here</p> : null}
    </Reorder.Item>
  );
}

/* ---------------------------------------------------------------- Picker */

type PickerRow = { key: string; name: string };
type PickerSection = { id: string; label: string; rows: PickerRow[]; collapsible?: boolean };

function LoraPicker({ options, profile, fitOf, baseOf, nameOf, policyNoteOf, current, favorites, recents, remaining, max, swapping, libraryView = false, inlineSelection, stackControls, onToggleFavorite, onClearAll, onAdd, onSwap, onClose }: {
  options: string[];
  profile: Profile | null;
  fitOf: FitOf;
  /** What a LoRA was made for, as people call it. */
  baseOf: (name: string) => string;
  nameOf: (name: string) => string;
  policyNoteOf: (name: string) => string;
  current: string[];
  favorites: string[];
  recents: string[];
  remaining: number;
  /** How many this model takes in all. */
  max: number;
  swapping: string | null;
  libraryView?: boolean;
  stackControls?: React.ReactNode;
  inlineSelection?: {
    items: LoraSelection[];
    move: (from: number, to: number) => void;
    infoOf: (name: string) => LoraInfo | undefined;
    toggle: (name: string) => void;
    update: (name: string, patch: Partial<LoraSelection>) => void;
  };
  onToggleFavorite: (name: string) => void;
  /** Takes every LoRA off; shown beside the tabs while some are picked. */
  onClearAll?: () => void;
  onAdd: (names: string[]) => void;
  onSwap: (name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  // This Model | All Models | Selected n/max, as in the reference chooser.
  const [view, setView] = useState<'model' | 'all' | 'selected'>('model');
  const showAll = view === 'all';
  const reviewing = libraryView && view === 'selected';
  const [selected, setSelected] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  // Rows keep their places: a pick shows as its tick and number, never by moving
  // the row. The Selected tab lists the picks in stack order.
  const move = (from: number, to: number) => { inlineSelection?.move(from, to); };
  const reorder = useReorderDrag((inlineSelection?.items || []).map((item) => item.name), move, listRef);

  const filteredOptions = useMemo(() => [...new Set([...modelLoras(options, fitOf, showAll), ...(libraryView ? current : [])])], [options, fitOf, showAll, libraryView, current]);
  const available = useMemo(() => new Set(filteredOptions), [filteredOptions]);
  const sections = useMemo<PickerSection[]>(() => {
    const q = query.trim().toLowerCase();
    if (q) return [{ id: 'results', label: 'Results', rows: rankedLoras(filteredOptions.filter((name) => `${name} ${nameOf(name)}`.toLowerCase().includes(q)), profile, '', fitOf).map((name) => ({ key: `q:${name}`, name })) }];
    if (reviewing) return [{ id: 'selected', label: '', rows: current.map((name) => ({ key: name, name })) }];
    if (libraryView) {
      const ranked = rankedLoras(filteredOptions, profile, '', fitOf);
      return [{ id: 'all', label: '', rows: [...ranked.filter((name) => favorites.includes(name)), ...ranked.filter((name) => !favorites.includes(name)), ...current.filter((name) => !ranked.includes(name))].map(name => ({ key: name, name })) }];
    }
    const out: PickerSection[] = [];
    const fav = favorites.filter((name) => available.has(name));
    const rec = recents.filter((name) => available.has(name) && !fav.includes(name)).slice(0, 5);
    const suggested = recommendedLoras(filteredOptions, profile, '', fitOf).filter((name) => !fav.includes(name) && !rec.includes(name)).slice(0, 6);
    if (fav.length) out.push({ id: 'favorites', label: 'Favourites', rows: fav.map((name) => ({ key: `f:${name}`, name })) });
    if (rec.length) out.push({ id: 'recents', label: 'Recent', rows: rec.map((name) => ({ key: `r:${name}`, name })) });
    if (suggested.length) out.push({ id: 'suggested', label: modelFamilyLabel(profile) ? `Suggested for ${modelFamilyLabel(profile)}` : 'Suggested', rows: suggested.map((name) => ({ key: `s:${name}`, name })) });
    for (const group of loraGroups(filteredOptions, profile, '', fitOf)) {
      out.push({ id: group.id, label: group.label, collapsible: true, rows: group.loras.map((name) => ({ key: `${group.id}:${name}`, name })) });
    }
    return out;
  }, [available, favorites, fitOf, filteredOptions, nameOf, profile, query, recents, libraryView, current, reviewing]);

  const hasRows = sections.some((section) => section.rows.length > 0);
  const visibleRows = useMemo(() => sections.flatMap((section) => collapsed.has(section.id) ? [] : section.rows), [collapsed, sections]);
  useEffect(() => { setHighlight(0); }, [query, view]);
  // Nothing left to review: back to this model's LoRAs.
  useEffect(() => { if (view === 'selected' && !current.length) setView('model'); }, [current.length, view]);
  useEffect(() => {
    listRef.current?.querySelector('[data-highlight="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const multi = !swapping;
  const isAdded = (name: string) => current.includes(name) && name !== swapping;
  const full = selected.length >= remaining;
  // A LoRA made for another family is shown under All Models, but never added; a picked one can still come off.
  const blocked = (name: string) => fitOf(name) === 'other' && !current.includes(name);
  const blockedNote = (name: string) => policyNoteOf(name) || `This LoRA does not support the selected model variant${baseOf(name) ? ` (made for ${baseOf(name)})` : ''}.`;
  const choose = (name: string) => {
    if (blocked(name)) return;
    if (libraryView && inlineSelection && !swapping) {
      const adding = !inlineSelection.items.some((item) => item.name === name);
      inlineSelection.toggle(name);
      // Bring the new strength controls into view once they have opened.
      if (adding) window.setTimeout(() => listRef.current?.querySelector(`[data-lora-name="${CSS.escape(name)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 260);
      return;
    }
    if (isAdded(name)) return;
    if (!multi) { onSwap(name); return; }
    setSelected((list) => list.includes(name) ? list.filter((item) => item !== name) : list.length >= remaining ? list : [...list, name]);
  };

  let rowIndex = -1;
  return (
    <div className={cn("lora-picker", libraryView && "is-library is-list")} role={libraryView ? "group" : "dialog"} aria-label={libraryView ? 'LoRA Library' : swapping ? 'Replace LoRA' : 'Add LoRAs'}>
      {!libraryView ? <div className="lora-picker-head">
        <button type="button" className="btn is-ghost lora-picker-back" onClick={onClose}><ArrowLeft size={14} /> Back</button>
        <span>{swapping ? <>Replace <strong>{fileName(swapping)}</strong></> : remaining > 0 ? `Add up to ${remaining}` : 'Stack is full'}</span>
      </div> : null}
      {profile?.loraNote ? <p className="lora-picker-note">{profile.loraNote}</p> : null}
      <label className={cn("lora-picker-search", libraryView && "picker-search")}>
        <Search size={14} />
        <input
          ref={inputRef}
          className={libraryView ? undefined : "is-framed"}
          value={query}
          placeholder={libraryView ? "Search LoRAs" : `Search ${options.length} LoRAs`}
          aria-label="Search LoRAs"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight((value) => Math.min(visibleRows.length - 1, value + 1)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight((value) => Math.max(0, value - 1)); }
            if ((event.key === 'Home' || event.key === 'End') && !query) { event.preventDefault(); setHighlight(event.key === 'Home' ? 0 : Math.max(0, visibleRows.length - 1)); }
            if (event.key === 'Enter') {
              event.preventDefault();
              if ((event.metaKey || event.ctrlKey) && selected.length) { onAdd(selected); return; }
              const row = visibleRows[highlight];
              if (row) choose(row.name);
            }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (query) setQuery(''); else onClose(); }
          }}
        />
        {query ? <button type="button" aria-label="Clear Search" onClick={() => { setQuery(''); inputRef.current?.focus(); }}><X size={13} /></button> : null}
      </label>
      <div className="lora-filter">
        <div className="reference-tabs lora-library-tabs" role="group" aria-label="LoRA Model Filter">
          <button type="button" className={cn(view === 'model' && 'active')} aria-pressed={view === 'model'} onClick={() => setView('model')}>This Model</button>
          <button type="button" className={cn(view === 'all' && 'active')} aria-pressed={view === 'all'} onClick={() => setView('all')}>All Models</button>
          {libraryView ? <button type="button" className={cn('reference-selected-tab', view === 'selected' && 'active', current.length >= max && 'is-full')} aria-pressed={view === 'selected'} aria-label={`Selected ${current.length} of ${max}`} disabled={!current.length} onClick={() => setView('selected')}>Selected <em>{current.length}/{max}</em></button> : null}
        </div>
        {libraryView && current.length > 0 && onClearAll ? <ClearSelection onClick={onClearAll} /> : null}
      </div>
      <div className="lora-picker-list" ref={listRef} role={libraryView ? "group" : "listbox"} aria-label={libraryView ? "LoRAs" : undefined} aria-multiselectable={libraryView ? undefined : multi}>
        {hasRows ? sections.map((section) => {
          const isCollapsed = collapsed.has(section.id);
          return (
            <div className="lora-picker-section" key={section.id}>
              {section.collapsible ? (
                <button type="button" className="lora-picker-heading" aria-expanded={!isCollapsed} onClick={() => setCollapsed((set) => { const next = new Set(set); if (next.has(section.id)) next.delete(section.id); else next.add(section.id); return next; })}>
                  <span>{section.label}</span><em>{section.rows.length}</em><ChevronDown size={12} className={cn(isCollapsed && 'is-collapsed')} />
                </button>
              ) : section.label ? <div className="lora-picker-heading is-static"><span>{section.label}</span></div> : null}
              {!isCollapsed ? <div className="lora-picker-items">{section.rows.map((row) => {
                rowIndex += 1;
                const index = rowIndex;
                const added = isAdded(row.name);
                const checked = selected.includes(row.name);
                const favorite = favorites.includes(row.name);
                if (libraryView && inlineSelection && !swapping) {
                  const item = inlineSelection.items.find(item => item.name === row.name);
                  const label = nameOf(row.name);
                  const info = inlineSelection.infoOf(row.name);
                  return <div key={row.key} data-lora-name={row.name} data-reorder-key={reviewing ? row.name : undefined} className={cn('lora-library-row', item && 'is-selected', reorder.rowState(row.name).dragging && 'is-dragging', reorder.rowState(row.name).over && 'is-drop-target')}>
                    {item && reviewing && inlineSelection.items.length > 1 ? <button type="button" className="lora-library-grip" aria-label={`Drag ${label} to Reorder`} {...reorder.grip(row.name)}><GripVertical size={14} /></button> : null}
                    <button type="button" role="checkbox" aria-checked={Boolean(item)} aria-label={`Select ${label}`} disabled={(!item && remaining <= 0) || blocked(row.name)} className="lora-library-select" data-highlight={index === highlight} onMouseEnter={() => setHighlight(index)} onClick={() => choose(row.name)}>
                      {/* Picked: its place in the stack, as a picked reference shows its number. */}
                      <span className={cn('picker-order', item && 'is-on')} aria-hidden="true">{item ? inlineSelection.items.indexOf(item) + 1 : null}</span>
                      <span className="lora-option-copy"><strong>{label}</strong><span title={row.name}>{row.name}</span></span>
                    </button>
                    <LoraSource info={info} label={label} />
                    <LoraDetails info={info} label={label} />
                    <button type="button" className={cn('lora-option-star', favorite && 'active')} aria-label={favorite ? `Remove ${fileName(row.name)} from Favourites` : `Add ${fileName(row.name)} to Favourites`} onClick={() => onToggleFavorite(row.name)}><Star size={13} fill={favorite ? 'currentColor' : 'none'} /></button>
                    {blocked(row.name) ? <p className="lora-library-note">{blockedNote(row.name)}</p> : policyNoteOf(row.name) ? <p className="lora-library-note">{policyNoteOf(row.name)}</p> : fitOf(row.name) === 'other' && baseOf(row.name) ? <p className="lora-library-note">Made for {baseOf(row.name)}</p> : null}
                    {/* A pick only gains its number where it stands (UI-PATTERNS › Pickers): strength and on/off are tuned in the Selected tab, so nothing below moves. */}
                    {item && reviewing ? <div className="lora-library-expansion"><div className="lora-library-settings">
                      <Switch size="sm" label={item.enabled ? `Turn Off ${label}` : `Turn On ${label}`} checked={item.enabled} onChange={enabled => inlineSelection.update(row.name, { enabled })} />
                      <StrengthControl label={label} info={info} value={item.strength} disabled={!item.enabled} onChange={strength => inlineSelection.update(row.name, { strength })} />
                      {reviewing && inlineSelection.items.length > 1 ? <span className="lora-library-order">
                        <button type="button" className="prompt-action" aria-label={`Move ${label} Up`} disabled={inlineSelection.items.indexOf(item) === 0} onClick={() => { const index = inlineSelection.items.indexOf(item); move(index, index - 1); }}><ChevronUp size={14} /></button>
                        <button type="button" className="prompt-action" aria-label={`Move ${label} Down`} disabled={inlineSelection.items.indexOf(item) === inlineSelection.items.length - 1} onClick={() => { const index = inlineSelection.items.indexOf(item); move(index, index + 1); }}><ChevronDown size={14} /></button>
                      </span> : null}
                      {item.enabled && info?.triggers?.length ? <TriggerWords words={info.triggers} /> : null}
                    </div></div> : null}
                  </div>;
                }
                return (
                  <div
                    key={row.key}
                    role="option"
                    aria-selected={checked || added}
                    tabIndex={added || blocked(row.name) || (multi && full && !checked) ? -1 : 0}
                    onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); choose(row.name); } }}
                    aria-disabled={added || blocked(row.name) || (multi && full && !checked) || undefined}
                    data-highlight={index === highlight}
                    className={cn('lora-option', checked && 'is-selected', added && 'is-added', index === highlight && 'is-highlight')}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => choose(row.name)}
                  >
                    {libraryView ? <span className="lora-option-preview" aria-hidden="true"><Layers size={24} /></span> : null}
                    {multi ? <span className="lora-option-check" aria-hidden="true">{checked || added ? <Check size={11} strokeWidth={3} /> : null}</span> : null}
                    <span className="lora-option-copy">
                      <strong>{nameOf(row.name)}</strong>
                      <span title={row.name}>{row.name}</span>
                      {blocked(row.name) ? <span>{blockedNote(row.name)}</span> : policyNoteOf(row.name) ? <span>{policyNoteOf(row.name)}</span> : null}
                      {folderOf(row.name) && (query || !section.collapsible) ? <span>{folderOf(row.name)}</span> : null}
                    </span>
                    {added ? <em>Added</em> : fitOf(row.name) === 'other' && baseOf(row.name) ? <em className="lora-fit" title={`Made for ${baseOf(row.name)}`}>{baseOf(row.name)}</em> : null}
                    <button
                      type="button"
                      className={cn('lora-option-star', favorite && 'active')}
                      aria-label={favorite ? `Remove ${fileName(row.name)} from Favourites` : `Add ${fileName(row.name)} to Favourites`}
                      onClick={(event) => { event.stopPropagation(); onToggleFavorite(row.name); }}
                    >
                      <Star size={13} fill={favorite ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                );
              })}</div> : null}
            </div>
          );
        }) : query
          ? <EmptyState title="No Matching LoRAs">Try a different name.</EmptyState>
          : reviewing
            ? <EmptyState title="Nothing Selected">Pick LoRAs from This Model or All Models.</EmptyState>
            : <EmptyState title="No LoRAs for This Model">Choose All Models to browse the rest.</EmptyState>}
      </div>
      {libraryView && stackControls ? <div className="lora-library-footer">{stackControls}</div> : null}
      {multi && !libraryView ? (
        <div className="lora-picker-foot">
          <span>{full && remaining > 0 ? `This workflow takes ${remaining} more` : selected.length ? `${selected.length} selected` : 'Click to select, Enter to toggle'}</span>
          <button type="button" className="btn is-primary" disabled={!selected.length} onClick={() => onAdd(selected)}>
            <Plus size={14} /> Add{selected.length > 1 ? ` ${selected.length}` : ''}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- Stacks */

/** A short default name from the LoRAs themselves: "Anime Watercolor +1". */
function suggestStackName(loras: LoraSelection[], taken: string[]) {
  const pretty = (item: LoraSelection) => fileName(item.name)
    .replace(/[-_.]+/g, ' ')
    .replace(/\b(v\d+(\.\d+)*|lora|loha|lycoris|epoch\s*\d+|e\d+|\d{3,})\b/gi, '')
    .replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const enabled = loras.filter((item) => item.enabled);
  const lead = [...(enabled.length ? enabled : loras)].sort((x, y) => y.strength - x.strength)[0];
  let name = lead ? pretty(lead) : '';
  if (!name) name = 'My stack';
  if (name.length > 22) name = `${name.slice(0, 21).trim()}…`;
  if (loras.length > 1) name += ` +${loras.length - 1}`;
  let unique = name;
  for (let n = 2; taken.includes(unique); n++) unique = `${name} (${n})`;
  return unique;
}

function NameField({ initial, action, onSave, onCancel }: { initial: string; action: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const save = () => { const name = value.trim(); if (name) onSave(name); else onCancel(); };
  return (
    <form className="lora-name-field" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <input
        autoFocus
        className="is-framed"
        aria-label="Stack Name"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); } }}
      />
      <button type="submit" className="lora-chip-action is-primary" disabled={!value.trim()}>{action}</button>
      <button type="button" className="lora-chip-action" aria-label="Cancel" onClick={onCancel}><X size={13} /></button>
    </form>
  );
}

/**
 * Stacks live in plain sight as chips: one click loads one, the active one is
 * lit, and saving only appears when there is something new to save.
 */
function Stacks({ library, loras, activeId, setActiveId, onLoad }: {
  library: LoraLibraryApi;
  loras: LoraSelection[];
  activeId: string;
  setActiveId: (id: string) => void;
  onLoad: (stack: LoraSnapshot) => void;
}) {
  const [naming, setNaming] = useState<null | { mode: 'new' } | { mode: 'rename'; id: string }>(null);
  // The stack you're working from: the one you loaded, an exact match, or one with
  // the same LoRAs (so nudging a strength reads as "changed", not "unsaved").
  const sameSet = (stack: LoraSnapshot) => stack.loras.length === loras.length && stack.loras.every((item) => loras.some((current) => current.name === item.name));
  const active = library.stacks.find((stack) => stack.id === activeId)
    || library.stacks.find((stack) => sameStack(stack.loras, loras))
    || (loras.length ? library.stacks.find(sameSet) : null)
    || null;
  const modified = Boolean(active && loras.length && !sameStack(active.loras, loras));
  const matchesSaved = library.stacks.some((stack) => sameStack(stack.loras, loras));
  const canSaveNew = loras.length > 0 && !matchesSaved && !modified;
  const family = library.familyLabel || 'this model';

  if (!library.stacks.length && !loras.length) return null;
  const remove = async (stack: LoraSnapshot) => { if (await library.deleteStack(stack) && stack.id === activeId) setActiveId(''); };

  return (
    <section className="lora-stacks" aria-label={`Saved Stacks for ${family}`}>
      {library.stacks.length ? (
        <div className="lora-chips">
          {library.stacks.map((stack) => {
            const isActive = stack.id === active?.id;
            if (naming?.mode === 'rename' && naming.id === stack.id) {
              return <NameField key={stack.id} initial={stack.name} action="Rename" onSave={(name) => { library.renameStack(stack.id, name); setNaming(null); }} onCancel={() => setNaming(null)} />;
            }
            return (
              <Tip key={stack.id} content={<>{stack.loras.map((item) => fileName(item.name)).join(', ') || 'Empty'}<br /><span className="lora-tip-hint">Double-click to rename</span></>}>
                <span className={cn('lora-chip', isActive && 'is-active', isActive && modified && 'is-modified')}>
                  <button
                    type="button"
                    className="lora-chip-load"
                    aria-pressed={isActive}
                    onClick={() => { if (!isActive || modified) onLoad(stack); setActiveId(stack.id); }}
                    onDoubleClick={() => setNaming({ mode: 'rename', id: stack.id })}
                    onKeyDown={(event) => {
                      if (event.key === 'F2') { event.preventDefault(); setNaming({ mode: 'rename', id: stack.id }); }
                      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(stack); }
                    }}
                  >
                    <span className="lora-chip-name">{stack.name}</span>
                    <em>{stack.loras.length}</em>
                  </button>
                  <button type="button" className="lora-chip-remove" aria-label={`Delete Stack ${stack.name}`} onClick={() => remove(stack)}><X size={11} /></button>
                </span>
              </Tip>
            );
          })}
        </div>
      ) : null}

      {naming?.mode === 'new' ? (
        <NameField
          initial={suggestStackName(loras, library.stacks.map((stack) => stack.name))}
          action="Save"
          onSave={(name) => { const stack = library.saveStack(name); setActiveId(stack.id); setNaming(null); }}
          onCancel={() => setNaming(null)}
        />
      ) : modified && active ? (
        <div className="lora-stack-changes">
          <span><i aria-hidden="true" />Unsaved Changes</span>
          <Tip content={`Save These LoRAs into ${active.name}`}><button type="button" className="lora-text-action is-strong" onClick={() => library.updateStack(active.id)}>Update</button></Tip>
          <button type="button" className="lora-text-action" onClick={() => setNaming({ mode: 'new' })}>Save As New</button>
        </div>
      ) : canSaveNew ? (
        <button type="button" className="lora-save-chip" onClick={() => setNaming({ mode: 'new' })}>
          <Save size={12} /> Save Stack{library.stacks.length ? '' : <span> for every {family} workflow</span>}
        </button>
      ) : null}
    </section>
  );
}

/* ----------------------------------------------------------------- Panel */


export function LoraPanel({ loras, setLoras, options, profile, limit, library, rememberedStrength, unavailableReason, browseFirst = false }: {
  loras: LoraSelection[];
  setLoras: (update: LoraSelection[] | ((current: LoraSelection[]) => LoraSelection[])) => void;
  options: string[];
  profile: Profile | null;
  limit: number;
  library: LoraLibraryApi;
  rememberedStrength: (name: string, fallback: number) => number;
  unavailableReason: { title: string; hint?: string } | null;
  browseFirst?: boolean;
}) {
  const [picker, setPicker] = useState<{ swap: string | null } | null>(() => browseFirst ? { swap: null } : null);
  const [activeStackId, setActiveStackId] = useState('');
  useEffect(() => { setActiveStackId(''); }, [library.familyLabel]);

  const available = useMemo(() => new Set(options), [options]);
  // What each LoRA file says it was made for, so ones that fit list first and the rest say so.
  const infos = useLoraInfo(options);
  const fitOf = useMemo<FitOf>(() => (name) => loraFit(infos[name], profile), [infos, profile]);
  const baseOf = (name: string) => infos[name]?.base || '';
  const cap = Math.min(maxLoras, limit);
  const activeCount = loras.filter((item) => item.enabled).length;

  if (unavailableReason) {
    return (
      <div className="lora-panel">
        <EmptyState title={unavailableReason.title}>{unavailableReason.hint}</EmptyState>
      </div>
    );
  }

  /** Every change that drops LoRAs can be taken back from the status pill. */
  const withUndo = (label: string, next: LoraSelection[]) => {
    const before = loras;
    setLoras(next);
    showToastTone(label, "removed", { action: { label: "Undo", onClick: () => setLoras(before) } });
  };
  const update = (index: number, patch: Partial<LoraSelection>) => setLoras((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  const remove = (index: number) => withUndo(`Removed ${fileName(loras[index].name)}`, loras.filter((_, i) => i !== index));
  const clearAll = () => { withUndo(`Cleared ${loras.length} LoRA${loras.length === 1 ? '' : 's'}`, []); setActiveStackId(''); };
  const loadStack = (stack: LoraSnapshot) => {
    const unsaved = loras.length > 0 && !library.stacks.some((item) => sameStack(item.loras, loras));
    if (unsaved) withUndo(`Loaded ${stack.name}`, stack.loras);
    else library.loadStack(stack);
  };
  const allOff = loras.length > 0 && loras.every((item) => !item.enabled);
  const move = (from: number, to: number) => setLoras((current) => { const next = [...current]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; });
  const add = (names: string[]) => {
    const fresh = names.filter((name) => !loras.some((item) => item.name === name)).slice(0, Math.max(0, cap - loras.length));
    setLoras((current) => [...current, ...fresh.map((name) => ({ name, enabled: true, strength: rememberedStrength(name, defaultLoraStrength) }))]);
    library.recordRecents(fresh);
    setPicker(null);
  };
  // Swapping keeps the card's strength; only a newly added LoRA picks up its remembered one.
  const swap = (from: string, to: string) => {
    setLoras((current) => current.map((item) => item.name === from ? { ...item, name: to } : item));
    library.recordRecents([to]);
    setPicker(null);
  };

  if (picker || browseFirst) {
    return (
      <div className="lora-panel">
        <LoraPicker
          options={optionalLoras(options, infos, profile)}
          profile={profile}
          fitOf={fitOf}
          baseOf={baseOf}
          nameOf={(name) => loraName(name, infos[name])}
          policyNoteOf={(name) => compatibilityNote(infos[name], profile)}
          current={loras.map((item) => item.name)}
          favorites={library.favorites}
          recents={library.recents}
          remaining={Math.max(0, cap - loras.length)}
          max={cap}
          swapping={picker?.swap || null}
          libraryView={browseFirst}
          stackControls={browseFirst ? <>
            <Stacks library={library} loras={loras} activeId={activeStackId} setActiveId={setActiveStackId} onLoad={loadStack} />
            {loras.length ? <div className="lora-library-actions"><button type="button" className="lora-head-action" onClick={() => setLoras(current => current.map(item => ({ ...item, enabled: allOff })))}>{allOff ? 'Enable All' : 'Disable All'}</button></div> : null}
          </> : undefined}
          inlineSelection={{
            items: loras,
            move,
            infoOf: name => infos[name],
            toggle: name => {
              const selected = loras.some(item => item.name === name);
              if (!selected && loras.length >= cap) return;
              setLoras(current => current.some(item => item.name === name) ? current.filter(item => item.name !== name) : current.length < cap ? [...current, { name, enabled: true, strength: rememberedStrength(name, defaultLoraStrength) }] : current);
              if (!selected) library.recordRecents([name]);
            },
            update: (name, patch) => setLoras(current => current.map(item => item.name === name ? { ...item, ...patch } : item))
          }}
          onClearAll={browseFirst ? clearAll : undefined}
          onToggleFavorite={library.toggleFavorite}
          onAdd={add}
          onSwap={(name) => picker?.swap && swap(picker.swap, name)}
          onClose={() => setPicker(null)}
        />
      </div>
    );
  }

  return (
    <div className="lora-panel">
      <header className="lora-head">
        <span className="lora-count">{loras.length ? <>{activeCount} active <em>· {loras.length}/{cap}</em></> : `Up to ${cap} LoRAs`}</span>
        {loras.length ? (
          <>
            <Tip content={allOff ? 'Turn All LoRAs Back On' : 'Turn All LoRAs Off'}>
              <button type="button" className="lora-head-action" onClick={() => setLoras((current) => current.map((item) => ({ ...item, enabled: allOff })))}>{allOff ? 'All on' : 'All off'}</button>
            </Tip>
            <Tip content="Remove All LoRAs">
              <button type="button" className="lora-head-action" onClick={clearAll}>Clear</button>
            </Tip>
          </>
        ) : null}
      </header>

      <Stacks library={library} loras={loras} activeId={activeStackId} setActiveId={setActiveStackId} onLoad={loadStack} />

      {loras.length ? (
        <Reorder.Group as="div" axis="y" values={loras} onReorder={(next) => setLoras(next)} className="lora-list">
          {loras.map((item, index) => (
            <LoraCard
              key={item.name}
              item={item}
              index={index}
              count={loras.length}
              missing={!available.has(item.name)}
              overLimit={index >= cap}
              info={infos[item.name]}
              otherModel={fitOf(item.name) === 'other' ? baseOf(item.name) : ''}
              policyNote={compatibilityNote(infos[item.name], profile)}
              onChange={(patch) => update(index, patch)}
              onRemove={() => remove(index)}
              onSwap={() => setPicker({ swap: item.name })}
              onMove={(to) => move(index, to)}
            />
          ))}
        </Reorder.Group>
      ) : (
        <EmptyState title="No LoRAs Added">{library.stacks.length ? 'Load a saved stack above, or add one.' : 'LoRAs steer style, characters or detail on top of the model.'}</EmptyState>
      )}

      <button type="button" className="btn lora-add" onClick={() => setPicker({ swap: null })} disabled={loras.length >= cap}>
        <Plus size={14} /> {loras.length >= cap ? `This workflow takes ${cap}` : 'Add LoRA'}
      </button>
    </div>
  );
}
