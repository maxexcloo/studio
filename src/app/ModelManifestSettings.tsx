import React from 'react';
import { Download, RefreshCw, ShieldCheck, Upload } from 'lucide-react';
import { apiFetch, apiJson } from './api';
import { Group, Row } from './SettingsControls';
import type { ShowToast } from './toast';

/** What /api/models/manifest reports (server/model-manifest.js). */
type ManifestItem = { path: string; size: number; status: 'verified' | 'present' | 'missing' | 'wrong-size' | 'mismatch' | 'external'; reason?: string; restoreNote?: string; restorable?: boolean };
type ManifestStatus = {
  source: 'deployment' | 'imported' | 'none';
  error?: string;
  total: number;
  counts: Record<ManifestItem['status'], number>;
  restorable: number;
  items: ManifestItem[];
  verify: { running: boolean; done: number; total: number; current: string; error: string };
};

const problemWords: Partial<Record<ManifestItem['status'], string>> = { missing: 'Missing', 'wrong-size': 'Wrong Size', mismatch: 'Checksum Mismatch' };
const shortPath = (value: string) => value.replace(/^models\/comfyui\//, '');

/** The deployment's pinned model list: what is here, what is wrong, and getting it back. */
export function ModelManifestGroup({ showToast }: { showToast: ShowToast }) {
  const [status, setStatus] = React.useState<ManifestStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const refresh = React.useCallback(async () => {
    try { setStatus(await apiJson<ManifestStatus & { ok: boolean }>('/api/models/manifest', { cache: 'no-store' })); } catch { setStatus(null); }
  }, []);
  React.useEffect(() => { void refresh(); }, [refresh]);
  // Follows a running verification.
  React.useEffect(() => {
    if (!status?.verify.running) return;
    const timer = window.setTimeout(() => void refresh(), 1500);
    return () => window.clearTimeout(timer);
  }, [status, refresh]);

  const post = async (url: string, body: unknown, done: (data: Record<string, unknown>) => string) => {
    setBusy(true);
    try {
      const response = await apiFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(data.error || 'That didn’t work.'));
      showToast(done(data), 'success');
      await refresh();
    } catch (error) { showToast(error instanceof Error ? error.message : 'That didn’t work.', 'error'); }
    finally { setBusy(false); }
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    try { await post('/api/models/manifest', JSON.parse(await file.text()), () => 'Manifest Imported'); }
    catch { showToast('That file isn’t a JSON model manifest.', 'error'); }
  };

  if (!status || (status.source === 'none' && !status.total)) {
    return <Group title="Model Manifest" note="A pinned list of every model the deployment expects, with checksums. Set STUDIO_MODEL_MANIFEST, or import one.">
      <Row label="No Manifest"><button className="btn is-ghost" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={14} /> Import</button></Row>
      <input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={(event) => { void importFile(event.target.files?.[0]); event.currentTarget.value = ''; }} />
    </Group>;
  }
  const problems = status.items.filter((item) => problemWords[item.status]);
  const { counts, verify } = status;
  return <Group title="Model Manifest" note={status.source === 'imported' ? 'Using an imported manifest. The deployment’s copy stays the disaster-recovery record.' : 'From the deployment’s manifest. Studio checks it and restores what it can; the deployment’s tooling covers the rest.'}>
    {status.error ? <Row label="Manifest Unreadable" description={status.error} /> : null}
    <Row label={`${status.total} Models`} description={`${counts.verified} verified · ${counts.present} present, not yet verified · ${counts.missing} missing · ${counts['wrong-size'] + counts.mismatch} wrong · ${counts.external} outside ComfyUI’s folder`}>
      <button className="btn is-ghost" disabled={busy || verify.running || !(counts.present + counts.verified + counts.mismatch)} onClick={() => void post('/api/models/manifest/verify', {}, () => 'Verifying Checksums')}><ShieldCheck size={14} /> {verify.running ? `Verifying ${verify.done}/${verify.total}` : 'Verify'}</button>
    </Row>
    {verify.running && verify.current ? <Row label="Checking" description={shortPath(verify.current)} /> : null}
    {counts.missing ? <Row label="Restore Missing" description={status.restorable ? `${status.restorable} of ${counts.missing} can download here, checked against their SHA-256.` : 'None of the missing files can download here; restore them with the deployment’s tooling.'}>
      <button className="btn is-primary" disabled={busy || !status.restorable} onClick={() => void post('/api/models/manifest/restore', {}, (data) => `${(data.queued as string[] | undefined)?.length || 0} Downloads Queued`)}><RefreshCw size={14} /> Restore</button>
    </Row> : null}
    {problems.slice(0, 30).map((item) => <Row key={item.path} label={<span className="set-model-name" title={item.path}>{shortPath(item.path)}</span>} description={`${problemWords[item.status]}${item.restoreNote ? ` · ${item.restoreNote}` : ''}`} />)}
    {problems.length > 30 ? <Row label={`${problems.length - 30} More`} description="Export the manifest to see every entry." /> : null}
    <Row label="Manifest File">
      <a className="btn is-ghost" href="/api/models/manifest/export" download="models.json"><Download size={14} /> Export</a>
      <button className="btn is-ghost" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={14} /> Import</button>
      {status.source === 'imported' ? <button className="btn is-ghost" disabled={busy} onClick={() => void post('/api/models/manifest', { reset: true }, () => 'Using the Deployment’s Manifest')}>Use Deployment’s</button> : null}
    </Row>
    <input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={(event) => { void importFile(event.target.files?.[0]); event.currentTarget.value = ''; }} />
  </Group>;
}
