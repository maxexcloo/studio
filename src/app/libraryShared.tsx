import React from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { apiJson } from './api';
import { cn } from './format';
import { Tip } from './components';
import type { ModelDownload } from './types';

/*
 * What the Library's pages share (UI-PATTERNS › Library): requests, folder
 * names, the grade chip, the source links and the footer the review pages
 * fill. Kept apart from the shell so each page stays small.
 */

export type Grade = { value: 'exact' | 'close' | 'partial'; reasons: string[]; missingFields: string[] };
export type Links = { civitaiCom?: string; civitaiRed?: string; hf?: string };

export const post = <T,>(url: string, body: object) => apiJson<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
export const size = (bytes?: number) => !bytes ? '' : bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
export const FOLDERS: Record<string, string> = { checkpoints: 'Checkpoints', clip_vision: 'CLIP Vision', diffusion_models: 'Diffusion Models', loras: 'LoRAs', text_encoders: 'Text Encoders', unet: 'Diffusion Models', vae: 'VAE' };
export const folderName = (folder?: string) => folder ? FOLDERS[folder] || folder : '';
export const percent = (item: { receivedBytes?: number; totalBytes?: number }) => item.totalBytes ? Math.min(100, Math.round((item.receivedBytes || 0) / item.totalBytes * 100)) : 0;
export const downloadWords = (item: ModelDownload) => item.status === 'downloading' ? item.verifying ? 'Checking…' : item.totalBytes ? `${percent(item)}%` : 'Downloading…'
  : item.status === 'done' ? 'Done' : item.status === 'error' ? 'Failed' : item.status === 'canceled' ? 'Cancelled' : item.status === 'paused' ? 'Paused' : 'Queued';
export const gradeWords: Record<Grade['value'], string> = { exact: 'Exact', close: 'Close', partial: 'Partial' };
export const errorText = (error: unknown, fallback = 'Something went wrong. Try again.') => error instanceof Error ? error.message : fallback;

/** Exact, Close or Partial in one chip; its reasons in the tooltip (and listed where there is room). */
export function GradeChip({ grade, count, className }: { grade?: Grade | null; count?: number; className?: string }) {
  if (!grade) return null;
  const words = `${gradeWords[grade.value]}${count ? ` · ${count} Missing` : ''}`;
  const chip = <span className={cn('library-grade', `is-${grade.value}`, className)} aria-label={`${words}${grade.reasons.length ? `: ${grade.reasons.join('; ')}` : ''}`}>{grade.value === 'exact' ? <Check size={12} aria-hidden="true" /> : null}{words}</span>;
  return grade.reasons.length ? <Tip content={grade.reasons.join(' · ')}>{chip}</Tip> : chip;
}

/** Civitai's two sites as small "com" and "red" pills, and Hugging Face as "HF" (the LoRA rows' View Source). */
export function SourceLinks({ links, label }: { links?: Links; label: string }) {
  const com = links?.civitaiCom || (links?.civitaiRed ? links.civitaiRed.replace('://civitai.red/', '://civitai.com/') : '');
  const red = links?.civitaiRed || (com ? com.replace('://civitai.com/', '://civitai.red/') : '');
  const list = [com && { short: 'com', host: 'civitai.com', url: com }, red && { short: 'red', host: 'civitai.red', url: red }, links?.hf && { short: 'HF', host: 'Hugging Face', url: links.hf }].filter(Boolean) as Array<{ short: string; host: string; url: string }>;
  if (!list.length) return null;
  return <span className="lora-sources library-sources">{list.map((item) => <Tip key={item.short} content={`View ${label} on ${item.host}`}>
    <a className="lora-source" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`View ${label} on ${item.host}`}><span aria-hidden="true">{item.short}</span></a>
  </Tip>)}</span>;
}

/** A file's state on the right of its row: quiet, the check when it is there. */
export function FileStatus({ status, children }: React.PropsWithChildren<{ status: string }>) {
  return <span className={cn('library-status', `is-${status}`)}>{status === 'installed' || status === 'done' ? <Check size={14} /> : null}{children}</span>;
}

/* ------------------------------------------------------------- Footer */

type FooterSlot = { slot: HTMLElement | null; claim: (on: boolean) => void };
export const LibraryFooterContext = React.createContext<FooterSlot>({ slot: null, claim: () => undefined });

/** A page's footer actions, shown in the sheet's footer while the page is open. */
export function LibraryFooter({ children }: React.PropsWithChildren) {
  const { slot, claim } = React.useContext(LibraryFooterContext);
  React.useLayoutEffect(() => { claim(true); return () => claim(false); }, [claim]);
  return slot ? createPortal(children, slot) : null;
}
