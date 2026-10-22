import { useEffect, useState } from 'react';
import { apiFetch } from './api';

let cached: Promise<string> | null = null;

/** The deployment's chat (STUDIO_CHAT_URL via /api/chat), fetched once; '' when there is none. */
export function useChatUrl() {
  const [url, setUrl] = useState('');
  useEffect(() => {
    cached ??= apiFetch('/api/chat').then((response) => response.ok ? response.json() : null).then((data) => String(data?.url || '')).catch(() => '');
    let live = true;
    void cached.then((value) => { if (live) setUrl(value); });
    return () => { live = false; };
  }, []);
  return url;
}

/** LibreChat's address for one conversation. */
export function conversationUrl(base: string, conversationId: string) {
  return `${base.replace(/\/+$/, '')}/c/${encodeURIComponent(conversationId)}`;
}
