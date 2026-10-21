import React from 'react';
import { apiJson } from './api';
import { copyToClipboard } from './clipboardNotices';
import { assistantSummary } from './format';
import { showToastTone as showToast } from './toast';
import type { GalleryItem } from './types';

/*
 * Refine in Chat (Details, desktop and phone): hands a result to the deployment's chat
 * (LibreChat, STUDIO_CHAT_URL) as a Handover-style message with its prompt, profile and stable
 * job ID, which the chat's Review and Reuse take. LibreChat v0.8.8 fills its input from
 * `/c/new?prompt=` without sending; without a chat address the message is copied instead.
 * The server records the handover so the chat may use the result (server/chat-handover.js).
 */

const maxPromptCharacters = 1500;
let chatAddress: Promise<string> | null = null;

/** The chat's address, asked once per page ('' when the deployment set none). */
export function useChatAddress() {
  const [url, setUrl] = React.useState('');
  React.useEffect(() => {
    let live = true;
    chatAddress ||= apiJson<{ url?: string }>('/api/chat').then((data) => String(data?.url || '')).catch(() => '');
    void chatAddress.then((value) => { if (live) setUrl(value); });
    return () => { live = false; };
  }, []);
  return url;
}

const clipped = (text: string) => text.length > maxPromptCharacters ? `${text.slice(0, maxPromptCharacters - 1)}…` : text;

/** The message the chat receives: what to refine, then the result as Handover lists results. */
export function refineMessage(item: GalleryItem, profileName = '') {
  const settings = (item.settings || {}) as Record<string, unknown>;
  const profileId = typeof settings.profileId === 'string' ? settings.profileId : '';
  const written = assistantSummary(item);
  const details = [
    item.prompt ? `Prompt: ${clipped(item.prompt)}` : '',
    item.negative ? `Negative: ${clipped(item.negative)}` : '',
    profileName || profileId ? `Profile: ${[profileName, profileId && profileId !== profileName ? `(${profileId})` : ''].filter(Boolean).join(' ')}` : '',
    written ? `Written By: ${written}` : ''
  ].filter(Boolean).join('\n');
  const result = `Studio Result\n- job_id ${item.jobId}${item.index ? `, output_index ${item.index}` : ''}`;
  return ['Refine this Studio result with me.', details, result, 'Call Review with this job_id to see the image, then Reuse with it for changes. Do not regenerate unless asked.'].filter(Boolean).join('\n\n');
}

/** Opens the chat with the message filled in, or copies it; says which in the status pill. Call inside the tap. */
export function refineInChat(item: GalleryItem, { chatUrl, profileName = '' }: { chatUrl: string; profileName?: string }) {
  if (!item.jobId) return;
  const message = refineMessage(item, profileName);
  // Recorded before the chat can ask for it; keepalive lets it finish while the chat opens.
  void apiJson('/api/chat/handover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: item.jobId }), keepalive: true }).catch(() => showToast('Couldn’t hand this result to chat', 'error'));
  if (chatUrl) {
    window.open(`${chatUrl}/c/new?prompt=${encodeURIComponent(message)}`, '_blank', 'noopener');
    showToast('Opened in chat with this result', 'success');
    return;
  }
  void copyToClipboard(message).then((copied) => { if (copied) showToast('Job reference copied: paste it in chat', 'success'); });
}
