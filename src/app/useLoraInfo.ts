import React from 'react';
import { loraCompatibility } from './catalogueNames';
import { apiJson } from './api';
import type { Profile } from './types';

/** What a LoRA was trained for and its trigger words, as the server read them from the file. */
export type LoraInfo = { families: string[]; base: string; triggers: string[]; about?: string; description?: string; sourceUrl?: string; title?: string; role?: 'effect' | 'acceleration' | 'supporting'; note?: string; /** How to prompt with it, from the catalogue. */ guidance?: string; compatibility?: import('../../server/lora-policy').LoraCompatibility; strengthRange?: import('../../server/lora-policy').LoraStrengthRange };
export type LoraFit = 'fits' | 'other' | 'unknown';

// One answer shared by every panel. It is fetched on idle after the app loads (prefetchLoraInfo), so the
// chooser opens on its final names and families; a changed LoRA list, or an answer over a minute old,
// is asked again in the background while the panels keep showing the last one.
let cached: { key: string; loras: Record<string, LoraInfo>; at: number } | null = null;
let pending: { key: string; promise: Promise<Record<string, LoraInfo>> } | null = null;
const listeners = new Set<(loras: Record<string, LoraInfo>) => void>();
const staleAfter = 60_000;

/** What the panels last learned about the LoRAs, for checks outside them (Reuse settings); null before the first answer. */
export function knownLoraInfo(): Record<string, LoraInfo> | null {
  return cached?.loras || null;
}

/** The LoRA answer, asked for now when no panel has needed it yet. */
export function fetchLoraInfo(): Promise<Record<string, LoraInfo>> {
  return cached ? Promise.resolve(cached.loras) : load(pending?.key || '');
}

/** Asks for the LoRA answer for `options` in the background, unless a fresh one for them is already here. */
export function prefetchLoraInfo(options: string[]) {
  const key = options.join('\n');
  if (cached?.key === key && Date.now() - cached.at < staleAfter) return;
  void load(key).catch(() => null);
}

function load(key: string) {
  if (pending?.key === key) return pending.promise;
  const promise = apiJson<{ loras?: Record<string, LoraInfo> }>('/api/loras/info')
    .then((data) => {
      const next = data.loras || {};
      // The same answer keeps the same object, so nothing re-renders or reorders for a refresh.
      const same = cached && JSON.stringify(cached.loras) === JSON.stringify(next);
      cached = { key, loras: same ? cached!.loras : next, at: Date.now() };
      if (!same) listeners.forEach((listener) => listener(cached!.loras));
      return cached.loras;
    })
    .finally(() => { if (pending?.promise === promise) pending = null; });
  pending = { key, promise };
  return promise;
}

/**
 * The LoRA answer and whether it is here. `ready` stays false only on the very
 * first ask while nothing is known yet (or until a slow first answer gives up
 * waiting), so a chooser can hold its rows rather than show file names that
 * then change.
 */
export function useLoraInfoState(options: string[]) {
  const key = options.join('\n');
  const [loras, setLoras] = React.useState<Record<string, LoraInfo>>(() => cached?.loras || {});
  const [ready, setReady] = React.useState(() => Boolean(cached) || !options.length);
  React.useEffect(() => {
    const listener = (next: Record<string, LoraInfo>) => setLoras(next);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  React.useEffect(() => {
    if (!options.length) { setReady(true); return; }
    if (cached) { setLoras(cached.loras); setReady(true); }
    let live = true;
    // Without an answer the panel shows no hints: a failed or very slow first ask stops holding the rows.
    const giveUp = window.setTimeout(() => { if (live) setReady(true); }, 4000);
    if (!cached || cached.key !== key || Date.now() - cached.at >= staleAfter) {
      load(key).then((next) => { if (live) setLoras(next); }).catch(() => null).finally(() => { if (live) setReady(true); });
    }
    return () => { live = false; window.clearTimeout(giveUp); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { loras, ready };
}

export function useLoraInfo(options: string[]) {
  return useLoraInfoState(options).loras;
}

/**
 * Whether a LoRA fits the model: "fits" when it was trained on this family,
 * "other" only when its file clearly says another one, "unknown" otherwise
 * (an imported workflow, a LoRA that says nothing).
 */
export function loraFit(info: LoraInfo | undefined, profile: Profile | null): LoraFit {
  return loraCompatibility(info, profile);
}
