import { Download, RefreshCw, X } from 'lucide-react';
import { EmptyState } from './EmptyState';
import { Group, Row } from './SettingsControls';
import type { ModelDownload } from './types';
import { FileStatus, folderName, post, size } from './libraryShared';
import { ProgressBar, transferWords } from './Progress';

/*
 * Library › Downloads: every model download, running, failed and done, as
 * rows with the shared progress bar (`set-progress`), the state on the right
 * and one action: Cancel while it runs, Retry or Resume when it stopped.
 * Failures say why under the name; the status pill says what an action did.
 */

const running = (item: ModelDownload) => ['queued', 'downloading', 'paused'].includes(item.status);
const failed = (item: ModelDownload) => ['error', 'canceled'].includes(item.status);

export function LibraryDownloads({ downloads, busy, run, onChanged }: { downloads: ModelDownload[]; busy: boolean; run: (action: () => Promise<void>) => void; onChanged: () => void }) {
  const groups = [
    { title: 'Running', items: downloads.filter(running) },
    { title: 'Failed', items: downloads.filter(failed) },
    { title: 'Done', items: downloads.filter((item) => item.status === 'done') }
  ].filter((group) => group.items.length);
  const retry = (item: ModelDownload) => run(async () => { await post('/api/models/downloads', { id: item.id }); onChanged(); });
  const cancel = (item: ModelDownload) => run(async () => { await post('/api/models/downloads/cancel', { id: item.id }); onChanged(); });

  return <div className="library-page">
    <header className="set-page-head">
      <h3 id="library-panel-title">Downloads</h3>
      <p>Model files on their way to the worker’s model library, and what happened to the last ones.</p>
    </header>
    {groups.length ? groups.map((group) => <Group key={group.title} title={group.title}>
      {group.items.map((item) => <Row key={`${item.id}:${item.finishedAt || item.status}`} className="library-download" label={item.label && item.label !== item.file ? item.label : item.file} description={<>
        <span className="library-line">{[item.label && item.label !== item.file ? item.file : '', folderName(item.folder), size(item.totalBytes)].filter(Boolean).join(' · ')}</span>
        {item.status === 'downloading' || item.status === 'paused' ? <ProgressBar value={item.totalBytes ? (item.receivedBytes || 0) / item.totalBytes : 0} tone={item.status === 'paused' ? 'paused' : 'live'} label={`${item.file} Progress`} /> : null}
        {item.error && item.status !== 'done' ? <span className="library-line library-error" role="alert">{item.error}</span> : null}
      </>}>
        <FileStatus status={item.status}>{transferWords(item)}</FileStatus>
        {item.status === 'downloading' || item.status === 'queued' ? <button type="button" className="btn is-sm is-ghost" disabled={busy} aria-label={`Cancel ${item.file}`} onClick={() => cancel(item)}><X size={14} />Cancel</button> : null}
        {(failed(item) || item.status === 'paused') && item.retryable !== false && item.id ? <button type="button" className="btn is-sm" disabled={busy} aria-label={`${item.status === 'paused' ? 'Resume' : 'Retry'} ${item.file}`} onClick={() => retry(item)}>{item.status === 'paused' ? <Download size={14} /> : <RefreshCw size={14} />}{item.status === 'paused' ? 'Resume' : 'Retry'}</button> : null}
      </Row>)}
    </Group>) : <EmptyState title="No Downloads Yet">Files from imports, saved images and model setup show here while they download.</EmptyState>}
  </div>;
}
