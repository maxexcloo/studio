import { cn } from './format';

/*
 * The one progress pattern for files on their way somewhere (UI-PATTERNS ›
 * Library › Downloads): model and LoRA imports, Library › Downloads, model
 * setup, the upscale weights and the activity pill for worker transfers.
 * One bar (`set-progress`: the accent fill on a well), one set of state
 * words, and the failure said once: under the file's name in a list, in the
 * status pill everywhere else.
 */

/** How far along, 0–100, from bytes received of bytes expected. */
export const percentOf = (item: { receivedBytes?: number; totalBytes?: number }) => item.totalBytes ? Math.min(100, Math.round((item.receivedBytes || 0) / item.totalBytes * 100)) : 0;

export type TransferState = { status: string; receivedBytes?: number; totalBytes?: number; verifying?: boolean };

/** A file's state on the right of its row: Queued, Downloading 45%, Checking…, Paused, Done, Failed or Cancelled. */
export function transferWords(item: TransferState) {
  switch (item.status) {
    case 'queued': return 'Queued';
    case 'downloading': return item.verifying ? 'Checking…' : item.totalBytes ? `Downloading ${percentOf(item)}%` : 'Downloading…';
    case 'paused': return 'Paused';
    case 'done': return 'Done';
    case 'error': return 'Failed';
    case 'canceled': return 'Cancelled';
    default: return 'Queued';
  }
}

/**
 * The shared bar. `value` runs from 0 to 1; a paused transfer dims its fill
 * and a finished one fills in the foreground. It is a labelled progressbar,
 * so it reads the same wherever it shows.
 */
export function ProgressBar({ value, label, tone = 'live', className }: { value: number; label: string; tone?: 'live' | 'paused' | 'done'; className?: string }) {
  const percent = Math.round(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100);
  return (
    <span className={cn('set-progress', tone !== 'live' && `is-${tone}`, className)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <span style={{ width: `${percent}%` }} />
    </span>
  );
}
