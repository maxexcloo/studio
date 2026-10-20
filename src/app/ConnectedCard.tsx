import { useEffect } from 'react';
import { toast } from './toast';

/**
 * When ComfyUI comes back while the gallery has images, the status pill says
 * so for a moment, and leaves by itself.
 */
const SHOW_MS = 2800;

// The last reconnect shown. The card unmounts whenever the gallery empties, and
// must not replay the same reconnect when it comes back.
let played = 0;

export function ConnectedCard({ at }: { at: number; device?: string }) {
  useEffect(() => {
    if (!at || at === played) return;
    played = at;
    toast.success('ComfyUI connected', { id: 'comfy-connected', duration: SHOW_MS });
  }, [at]);
  return null;
}
