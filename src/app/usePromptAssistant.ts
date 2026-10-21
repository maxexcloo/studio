import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiFetch, apiJson, scopedStorageKey } from './api';
import { insertTriggers, removeTriggers, saysAny, stillWritten } from './assistantText';
import { refreshPrompts } from './recentPrompts';
import type { ShowToast } from './toast';
import type { GalleryItem, LoraSelection, Profile, SelectedReferenceAsset } from './types';

/**
 * The prompt assistant in the composer (UI-PATTERNS › Composer): the magic button's rewrite, which
 * streams into the prompt in place, the negative writer and LoRA suggestions. Every message goes
 * to the status pill; nothing asks first, and each change has Undo. The engine is the server's
 * (server/assistant-routes.js), shared with MCP.
 */

export type AssistantPreset = { id: string; label: string; description: string };
export type LoraSuggestion = { name: string; title: string; strength: number; triggers: string[]; reason: string };
/** What a generation records about the assistant (gallery items' `assistant`). */
export type AssistantRecord = { preset: string; model?: string; source: 'ui' | 'chat'; lorasSuggested?: string[] };
export type AssistantBusy = 'rewrite' | 'negative' | 'loras' | null;

type Info = { available: boolean; presets: AssistantPreset[]; model?: string; vision?: boolean; spicy?: boolean; loras?: boolean; noNegative?: string[]; defaultPreset?: string };
type RewriteResult = { prompt: string; preset: string; model?: string; vision?: boolean; referencesRead?: boolean; source: 'assistant' | 'fallback'; reason?: string };

export type PromptAssistant = {
  /** Whether this account has the assistant and a model is configured; nothing shows otherwise. */
  available: boolean;
  presets: AssistantPreset[];
  preset: string;
  presetLabel: string;
  busy: AssistantBusy;
  rewrite: (preset?: string) => void;
  stop: () => void;
  /** A muted second line for the magic button's tooltip ("References not read by this model."). */
  referencesNote: string;
  negativeOffered: boolean;
  writeNegative: () => void;
  lorasOffered: boolean;
  suggestLoras: () => void;
  /** The chips under the prompt, after a rewrite or Suggest LoRAs. */
  suggestions: LoraSuggestion[];
  dismissSuggestions: () => void;
  addSuggestion: (suggestion: LoraSuggestion) => void;
  addAllSuggestions: () => void;
  /** Takes a suggested LoRA off the stack again (its trigger words are offered for removal). */
  removeSuggestion: (name: string) => void;
  isAdded: (name: string) => boolean;
  /** For the generation request: what the assistant did, while the prompt is still its own. */
  record: () => AssistantRecord | null;
  /** Recreate: a result's record comes along with its prompt, so the rerun says how it was written too. */
  adopt: (record: GalleryItem["assistant"] | null, prompt: string) => void;
};

type Options = {
  prompt: string;
  setPrompt: (value: string) => void;
  negative: string;
  setNegative: (value: string) => void;
  clampPrompt: (value: string) => string;
  clampNegative: (value: string) => string;
  profile: Profile | null;
  loras: LoraSelection[];
  setLoras: (next: LoraSelection[]) => void;
  /** The LoRA files this model offers, and how many it takes. */
  loraOptions: string[];
  loraCap: number;
  cfg?: number;
  references: SelectedReferenceAsset[];
  showToast: ShowToast;
  /** A friendly LoRA name for messages. */
  loraTitle: (name: string) => string;
};

const presetKey = 'studio-assistant-preset';
/** A rewrite that hasn't finished in this long is stopped (the server gives up at 90 s). */
const rewriteTimeoutMs = 100_000;
const referenceEdge = 1024;
const off: Info = { available: false, presets: [] };

/** The server-sent events of a streamed rewrite: { event, data } as they arrive. */
async function* serverEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let at;
    while ((at = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const block = buffer.slice(0, at);
      buffer = buffer.slice(at).replace(/^\r?\n\r?\n/, '');
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (!data.length) continue;
      try { yield { event, data: JSON.parse(data.join('\n')) }; } catch { /* A broken event is skipped. */ }
    }
    if (done) return;
  }
}

/** A reference as a downscaled JPEG data URL, for a vision model to read. */
async function referenceImage(item: SelectedReferenceAsset) {
  const response = await apiFetch(item.asset.url || `/api/reference-assets/${encodeURIComponent(item.asset.id)}/media`);
  if (!response.ok) throw new Error('reference');
  const bitmap = await createImageBitmap(await response.blob());
  const scale = Math.min(1, referenceEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** The pill's words for a failure, by the engine's reason or the HTTP status. */
function failureText(reason: string, status = 0) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'You’re offline. Try again once connected';
  if (status === 503) return 'The prompt assistant isn’t set up';
  if (status === 429 || /429/.test(reason)) return 'The prompt assistant is busy. Try again shortly';
  if (status === 504 || reason === 'timeout') return 'The prompt assistant took too long';
  if (status === 0 || reason === 'unreachable' || /HTTP 5\d\d/.test(reason)) return 'Couldn’t reach the prompt assistant';
  return '';
}

export function usePromptAssistant(options: Options): PromptAssistant {
  const latest = useRef(options);
  latest.current = options;
  const { profile, prompt, loras, references, showToast } = options;
  const [info, setInfo] = useState<Info>(off);
  const [preset, setPresetState] = useState(() => { try { return localStorage.getItem(scopedStorageKey(presetKey)) || ''; } catch { return ''; } });
  const [busy, setBusy] = useState<AssistantBusy>(null);
  const [chips, setChips] = useState<{ profileId: string; list: LoraSuggestion[] }>({ profileId: '', list: [] });
  const abort = useRef<AbortController | null>(null);
  const stopped = useRef(false);
  const suggestionCache = useRef(new Map<string, LoraSuggestion[]>());
  /** The last rewrite: its text, preset and model, for the generation record. */
  const written = useRef<{ prompt: string; preset: string; model?: string; source?: 'ui' | 'chat' } | null>(null);
  /** Suggested LoRAs added from the chips, and the trigger words each one inserted. */
  const chosen = useRef(new Set<string>());
  const triggerWords = useRef(new Map<string, string[]>());

  const load = useCallback(() => {
    apiJson<Info & { ok?: boolean }>('/api/assistant').then((data) => setInfo(data?.available ? data : off)).catch(() => setInfo(off));
  }, []);
  useEffect(() => { load(); }, [load]);

  const available = info.available && info.presets.length > 0 && Boolean(profile);
  const chosenPreset = info.presets.find((item) => item.id === preset) || info.presets.find((item) => item.id === info.defaultPreset) || info.presets[0];
  const profileId = profile?.id || '';
  const negativeOffered = available && profile?.capabilities?.negativePrompt !== false && !(info.noNegative || []).includes(profileId);
  const lorasOffered = available && Boolean(info.loras) && Boolean(profile?.capabilities?.lora) && options.loraOptions.length > 0;
  const referencesNote = available && references.length && !info.vision ? 'References not read by this model.' : '';

  // Suggestions belong to the model they were made for.
  useEffect(() => { setChips((current) => current.profileId && current.profileId !== profileId ? { profileId: '', list: [] } : current); }, [profileId]);

  // A suggested LoRA taken off the stack offers to take its trigger words out of the prompt too.
  const previous = useRef(loras);
  useEffect(() => {
    const before = previous.current;
    previous.current = loras;
    for (const item of before) {
      if (loras.some((lora) => lora.name === item.name)) continue;
      chosen.current.delete(item.name);
      const words = triggerWords.current.get(item.name);
      triggerWords.current.delete(item.name);
      if (!words?.length || !saysAny(latest.current.prompt, words)) continue;
      latest.current.showToast(`Removed ${latest.current.loraTitle(item.name)}`, 'default', { group: `assistant-triggers-${item.name}`, action: { label: 'Remove Trigger Words', onClick: () => latest.current.setPrompt(removeTriggers(latest.current.prompt, words)) } });
    }
  }, [loras]);

  const post = useCallback(<T,>(route: string, body: Record<string, unknown>, signal?: AbortSignal) => apiJson<T>(`/api/assistant/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal }), []);
  const stackNames = () => latest.current.loras.filter((item) => item.enabled !== false && item.name).map((item) => item.name);

  /** A failure in the pill, with Try Again where trying again can help; a 503 or 403 hides the assistant until it is back. */
  const fail = useCallback((what: string, error: unknown, retry?: () => void) => {
    const status = error instanceof ApiError ? error.status : 0;
    const reason = typeof error === 'string' ? error : '';
    if (status === 503 || status === 403) load();
    const known = failureText(reason, status);
    const message = known ? `Couldn’t ${what}. ${known}` : error instanceof Error && error.message ? error.message : `Couldn’t ${what}`;
    latest.current.showToast(message, 'error', retry && status !== 403 && status !== 503 ? { action: { label: 'Try Again', onClick: retry } } : undefined);
  }, [load]);

  const remember = (text: string, kind: 'positive' | 'negative') => {
    if (!text.trim()) return;
    void apiJson('/api/prompts/record', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, kind }) }).then(() => refreshPrompts(kind)).catch(() => undefined);
  };

  const fetchSuggestions = useCallback(async (text: string, signal?: AbortSignal) => {
    const key = `${latest.current.profile?.id}\n${text.trim()}`;
    const cached = suggestionCache.current.get(key);
    if (cached) return cached;
    const { loras: list = [] } = await post<{ loras: LoraSuggestion[] }>('loras', { profileId: latest.current.profile?.id, prompt: text }, signal);
    const offered = new Set(latest.current.loraOptions);
    const usable = list.filter((item) => offered.has(item.name));
    suggestionCache.current.set(key, usable);
    if (suggestionCache.current.size > 50) suggestionCache.current.delete(suggestionCache.current.keys().next().value!);
    return usable;
  }, [post]);

  const showChips = useCallback(async (text: string, quiet: boolean) => {
    try {
      const list = await fetchSuggestions(text);
      setChips({ profileId: latest.current.profile?.id || '', list });
      if (!list.length && !quiet) latest.current.showToast('No LoRAs fit this prompt', 'default');
    } catch (error) { if (!quiet) fail('suggest LoRAs', error, () => { void showChips(text, false); }); }
  }, [fetchSuggestions, fail]);

  const stop = useCallback(() => { stopped.current = true; abort.current?.abort(); }, []);

  const rewrite = useCallback(async (presetId?: string) => {
    if (abort.current) { stop(); return; }
    const { prompt: original, negative: originalNegative, profile: current, references: refs } = latest.current;
    const id = presetId || chosenPreset?.id;
    if (!current || !id) return;
    if (!original.trim()) { latest.current.showToast('Write a prompt to rewrite first', 'default'); return; }
    if (presetId) {
      setPresetState(presetId);
      try { localStorage.setItem(scopedStorageKey(presetKey), presetId); } catch { /* Not remembered. */ }
    }
    const label = info.presets.find((item) => item.id === id)?.label || 'Enhance';
    const retry = () => { void rewrite(id); };
    if (navigator.onLine === false) { fail('rewrite the prompt', 'offline', retry); return; }
    const controller = new AbortController();
    abort.current = controller;
    stopped.current = false;
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, rewriteTimeoutMs);
    setBusy('rewrite');
    const restore = () => latest.current.setPrompt(original);
    try {
      // Only a vision model reads the references; otherwise the rewrite is text only (referencesNote says so).
      const images = info.vision && refs.length ? (await Promise.all(refs.slice(0, 4).map((item) => referenceImage(item).catch(() => '')))).filter(Boolean) : [];
      const response = await apiFetch('/api/assistant/rewrite', {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ profileId: current.id, prompt: original, preset: id, references: images, loras: stackNames(), stream: true })
      });
      if (!response.ok || !/text\/event-stream/.test(response.headers.get('content-type') || '') || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new ApiError(typeof data?.error === 'string' ? data.error : response.statusText || 'Request failed', response.ok ? 502 : response.status, '');
      }
      let streamed = '';
      let result: RewriteResult | null = null;
      for await (const { event, data } of serverEvents(response.body)) {
        if (event === 'delta' && typeof data?.text === 'string') {
          streamed += data.text;
          latest.current.setPrompt(latest.current.clampPrompt(streamed.trimStart()));
        } else if (event === 'done') result = data as RewriteResult;
        else if (event === 'error') throw new ApiError(String(data?.error || 'The rewrite failed'), 502, '');
      }
      if (!result) throw new ApiError('', 502, '');
      if (result.source === 'fallback' || !result.prompt?.trim()) { restore(); fail('rewrite the prompt', result.reason || 'unavailable', retry); return; }
      const text = latest.current.clampPrompt(result.prompt);
      latest.current.setPrompt(text);
      remember(original, 'positive');
      // The negative follows the rewrite where the model uses one; one Undo covers both.
      let nextNegative = originalNegative;
      if (negativeOffered) {
        setBusy('negative');
        try {
          const answer = await post<{ negative: string | null; unused: boolean }>('negative', { profileId: current.id, prompt: text, cfg: latest.current.cfg, loras: stackNames() }, controller.signal);
          if (!answer.unused && answer.negative?.trim()) {
            nextNegative = latest.current.clampNegative(answer.negative);
            latest.current.setNegative(nextNegative);
            if (originalNegative.trim() && originalNegative.trim() !== nextNegative.trim()) remember(originalNegative, 'negative');
          }
        } catch { /* The rewrite stands without a new negative. */ }
      }
      written.current = { prompt: text, preset: result.preset, model: result.model };
      latest.current.showToast(nextNegative !== originalNegative ? `Prompt and negative rewritten · ${label}` : `Prompt rewritten · ${label}`, 'default', {
        action: { label: 'Undo', onClick: () => { latest.current.setPrompt(original); latest.current.setNegative(originalNegative); written.current = null; } }
      });
      if (lorasOffered) void showChips(text, true);
    } catch (error) {
      restore();
      if (stopped.current) latest.current.showToast('Rewrite stopped', 'default');
      else if (timedOut) fail('rewrite the prompt', 'timeout', retry);
      else if ((error as Error)?.name === 'AbortError') latest.current.showToast('Rewrite stopped', 'default');
      else fail('rewrite the prompt', error instanceof ApiError || typeof error === 'string' ? error : new ApiError('', 0, ''), retry);
    } finally {
      window.clearTimeout(timer);
      if (abort.current === controller) abort.current = null;
      setBusy(null);
    }
  }, [chosenPreset?.id, info.presets, info.vision, negativeOffered, lorasOffered, fail, post, showChips, stop]);

  const writeNegative = useCallback(async () => {
    if (abort.current) return;
    const { prompt: text, negative: before, profile: current } = latest.current;
    if (!current) return;
    if (!text.trim()) { latest.current.showToast('Write a prompt first, then its negative', 'default'); return; }
    const controller = new AbortController();
    abort.current = controller;
    setBusy('negative');
    try {
      const answer = await post<{ negative: string | null; unused: boolean; source?: string; reason?: string }>('negative', { profileId: current.id, prompt: text, cfg: latest.current.cfg, loras: stackNames() }, controller.signal);
      if (answer.unused || !answer.negative?.trim()) { latest.current.showToast('This model doesn’t use a negative prompt', 'default'); return; }
      const next = latest.current.clampNegative(answer.negative);
      latest.current.setNegative(next);
      if (before.trim() && before.trim() !== next.trim()) remember(before, 'negative');
      latest.current.showToast(answer.source === 'fallback' ? 'Negative set from the model’s guide' : 'Negative written', 'default', { action: { label: 'Undo', onClick: () => latest.current.setNegative(before) } });
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') fail('write a negative', error, () => { void writeNegative(); });
    } finally {
      if (abort.current === controller) abort.current = null;
      setBusy(null);
    }
  }, [post, fail]);

  const suggestLoras = useCallback(async () => {
    const text = latest.current.prompt;
    if (!text.trim()) { latest.current.showToast('Write a prompt first, then ask for LoRAs', 'default'); return; }
    setBusy('loras');
    try { await showChips(text, false); } finally { setBusy(null); }
  }, [showChips]);

  /** Adds suggestions to the stack with their strengths, inserting their triggers, all with one Undo. */
  const add = useCallback((list: LoraSuggestion[]) => {
    const { loras: stack, prompt: before, loraCap } = latest.current;
    const fresh = list.filter((item) => !stack.some((lora) => lora.name === item.name)).slice(0, Math.max(0, loraCap - stack.length));
    if (!fresh.length) { if (list.length && stack.length >= loraCap) latest.current.showToast(`This model takes ${loraCap} LoRA${loraCap === 1 ? '' : 's'}`, 'warning'); return; }
    let text = before;
    const inserted = new Map<string, string[]>();
    for (const item of fresh) {
      const next = insertTriggers(text, item.triggers || []);
      text = next.prompt;
      if (next.inserted.length) inserted.set(item.name, next.inserted);
    }
    latest.current.setLoras([...stack, ...fresh.map((item) => ({ name: item.name, enabled: true, strength: item.strength }))]);
    if (text !== before) latest.current.setPrompt(latest.current.clampPrompt(text));
    for (const item of fresh) chosen.current.add(item.name);
    for (const [name, words] of inserted) triggerWords.current.set(name, words);
    const what = fresh.length === 1 ? (fresh[0].title || latest.current.loraTitle(fresh[0].name)) : `${fresh.length} LoRAs`;
    latest.current.showToast(`Added ${what}${inserted.size ? ` with trigger word${[...inserted.values()].flat().length === 1 ? '' : 's'}` : ''}`, 'default', {
      action: { label: 'Undo', onClick: () => {
        // Forgotten first, so taking them off again doesn't offer to remove the words Undo restores.
        for (const item of fresh) { triggerWords.current.delete(item.name); chosen.current.delete(item.name); }
        latest.current.setLoras(stack);
        latest.current.setPrompt(before);
      } }
    });
  }, []);

  const record = useCallback((): AssistantRecord | null => {
    const last = written.current;
    if (!last || !stillWritten(latest.current.prompt, last.prompt)) return null;
    const stacked = new Set(stackNames());
    const picked = [...chosen.current].filter((name) => stacked.has(name));
    return { preset: last.preset, ...(last.model ? { model: last.model } : {}), source: last.source || 'ui', ...(picked.length ? { lorasSuggested: picked } : {}) };
  }, []);

  const adopt = useCallback((recorded: GalleryItem["assistant"] | null, text: string) => {
    if (!recorded?.preset || !text.trim()) { written.current = null; return; }
    written.current = { prompt: text, preset: recorded.preset, ...(recorded.model ? { model: recorded.model } : {}), source: recorded.source === 'chat' ? 'chat' : 'ui' };
    for (const name of recorded.lorasSuggested || []) chosen.current.add(name);
  }, []);

  const suggestions = chips.profileId === profileId ? chips.list : [];
  return useMemo(() => ({
    available, presets: info.presets, preset: chosenPreset?.id || '', presetLabel: chosenPreset?.label || '', busy,
    rewrite: (id?: string) => { void rewrite(id); }, stop, referencesNote,
    negativeOffered, writeNegative: () => { void writeNegative(); },
    lorasOffered, suggestLoras: () => { void suggestLoras(); },
    suggestions, dismissSuggestions: () => setChips({ profileId: '', list: [] }),
    addSuggestion: (item: LoraSuggestion) => add([item]), addAllSuggestions: () => add(suggestions),
    removeSuggestion: (name: string) => latest.current.setLoras(latest.current.loras.filter((item) => item.name !== name)),
    isAdded: (name: string) => loras.some((item) => item.name === name),
    record, adopt
  }), [available, info.presets, chosenPreset, busy, rewrite, stop, referencesNote, negativeOffered, writeNegative, lorasOffered, suggestLoras, suggestions, add, loras, record, adopt]);
}
