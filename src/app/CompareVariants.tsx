import React from 'react';
import { apiJson } from './api';
import { Sheet } from './Sheet';
import { retryRequest } from './retry';
import { SafeImg } from './SafeImg';
import type { GalleryItem } from './types';
import { Dropdown } from './Dropdown';

type Comparison = { id: string; createdAt: string; seed: string; vote: string | null; variants: Array<{ jobId: string; item: GalleryItem | null }> };
type Variant = { prompt: string; settings: string };

/** Controlled runs share a seed; votes and history belong to the signed-in account. */
export function CompareVariants({ items, onClose }: { items: GalleryItem[]; onClose: () => void }) {
  const base = items[0];
  const [seed, setSeed] = React.useState(() => /^\d+$/.test(String(base?.settings?.seed ?? '')) ? String(base.settings!.seed) : String(crypto.getRandomValues(new Uint32Array(1))[0]));
  const variant = (item: GalleryItem): Variant => {
    const { prompt, seed: ignored, count, variationCount, kind, ...settings } = retryRequest(item).body;
    return { prompt: String(prompt), settings: JSON.stringify(settings, null, 2) };
  };
  const [variants, setVariants] = React.useState<Variant[]>(() => base ? (items.length > 1 ? items : [base, base]).slice(0, 4).map(variant) : []);
  const [history, setHistory] = React.useState<Comparison[]>([]);
  const [selected, setSelected] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const load = React.useCallback(async () => { const data = await apiJson<{ comparisons: Comparison[] }>('/api/comparisons'); setHistory(data.comparisons); }, []);
  React.useEffect(() => {
    let live = true;
    const refresh = () => { if (live) void load().catch(error => { if (live) setError(error.message); }); };
    refresh(); const timer = window.setInterval(refresh, 2000);
    return () => { live = false; window.clearInterval(timer); };
  }, [load]);
  const change = (index: number, patch: Partial<Variant>) => setVariants(current => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  const run = async () => {
    setBusy(true); setError(''); const queued: string[] = [];
    try {
      if (!/^\d+$/.test(seed)) throw new Error('Enter a numeric seed.');
      // Validate every editor before submitting any job. Each accepted job stays in the gallery on a later failure.
      const requests = variants.map(item => {
        if (!item.prompt.trim()) throw new Error('Every variant needs a prompt.');
        const settings = JSON.parse(item.settings);
        if (!settings || Array.isArray(settings) || typeof settings !== 'object') throw new Error('Settings must be a JSON object.');
        return { ...settings, kind: 'image', prompt: item.prompt, seed, count: 1, variationCount: 1, clientJobId: crypto.randomUUID() };
      });
      for (const request of requests) {
        const result = await apiJson<{ jobId: string }>('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
        queued.push(result.jobId);
      }
      const comparison = await apiJson<Comparison>('/api/comparisons', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobIds: queued }) });
      setSelected(comparison.id); await load();
    } catch (error) { setError(`${(error as Error).message}${queued.length ? ` ${queued.length} accepted job(s) remain in your gallery; nothing was resubmitted.` : ''}`); }
    finally { setBusy(false); }
  };
  const current = history.find(item => item.id === selected);
  const vote = async (jobId: string | null) => {
    if (!current) return;
    try { await apiJson(`/api/comparisons/${encodeURIComponent(current.id)}/vote`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId }) }); await load(); }
    catch (error) { setError((error as Error).message); }
  };
  return <Sheet open onClose={onClose} title="Compare Variants" full className="compare-variants">
    <div className="compare-history"><span aria-hidden="true">History</span><Dropdown label="Comparison History" variant="field" value={selected} options={[{ value: '', label: 'New Comparison' }, ...history.map(item => ({ value: item.id, label: `${new Date(item.createdAt).toLocaleString()} · ${item.variants.length} Variants · Seed ${item.seed}` }))]} onChange={setSelected} /></div>
    {error ? <p role="alert">{error}</p> : null}
    {current ? <><p>Seed {current.seed} · A shared seed helps compare changes. Different model families can interpret it differently.</p><div className="comparison-grid">{current.variants.map(({ jobId, item }, index) => <section key={jobId}><h3>Variant {String.fromCharCode(65 + index)}</h3>{item?.status === 'done' && item.url ? <SafeImg src={item.url} alt={`Variant ${String.fromCharCode(65 + index)}`} /> : <p>{item ? item.status === 'error' ? 'Generation failed; see the gallery for details.' : 'Generating…' : 'Image unavailable'}</p>}<p>{item?.prompt}</p>{item?.settings ? <details><summary>Settings</summary><pre>{JSON.stringify(item.settings, null, 2)}</pre></details> : null}<button type="button" className="btn" disabled={item?.status !== 'done'} aria-pressed={current.vote === jobId} onClick={() => void vote(current.vote === jobId ? null : jobId)}>{current.vote === jobId ? 'Voted' : `Vote for ${String.fromCharCode(65 + index)}`}</button></section>)}</div></> : base ? <>
      <p>Make 2–4 variants with one seed. Change a prompt or generation settings, then vote on the results.</p>
      <label>Seed<input aria-label="Comparison Seed" inputMode="numeric" value={seed} disabled={busy} onChange={event => setSeed(event.target.value)} /></label>
      <div className="comparison-grid">{variants.map((item, index) => <section key={index}><h3>Variant {String.fromCharCode(65 + index)}</h3><label>Prompt<textarea aria-label={`Variant ${String.fromCharCode(65 + index)} Prompt`} value={item.prompt} disabled={busy} onChange={event => change(index, { prompt: event.target.value })} /></label><details><summary>Settings</summary><label>Generation Settings<textarea aria-label={`Variant ${String.fromCharCode(65 + index)} Settings`} value={item.settings} disabled={busy} onChange={event => change(index, { settings: event.target.value })} /></label></details></section>)}</div>
      <div className="comparison-actions"><button type="button" className="btn" disabled={busy || variants.length >= 4} onClick={() => setVariants(current => [...current, { ...current.at(-1)! }])}>Add Variant</button><button type="button" className="btn" disabled={busy || variants.length <= 2} onClick={() => setVariants(current => current.slice(0, -1))}>Remove Variant</button><button type="button" className="btn is-primary" disabled={busy} onClick={() => void run()}>{busy ? 'Queueing…' : 'Generate Variants'}</button></div>
    </> : <p>Open an image and choose Compare Variants to create a comparison, or select one from History.</p>}
  </Sheet>;
}
