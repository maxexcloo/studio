import { useRef, useState } from 'react';
import { apiFetch, apiJson } from './api';
import { tellPreviousExit } from './clipboardNotices';
import { setDeviceAdmin } from './access';
import { showToastTone as showToast } from './toast';
import type { ComfyStatus, Health } from './types';

/**
 * Studio's own health (/api/health) and its workers' (/api/comfy/status). A
 * status check already in flight is shared; a change in which workers answer
 * refreshes the models (`refreshModels`).
 */
export function useComfyStatus({ refreshModels }: { refreshModels: () => unknown }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [backendStatus, setComfyStatus] = useState<ComfyStatus>({ connected: false, checking: true });
  const comfyStatusRequestRef = useRef<Promise<void> | null>(null);
  const backendAvailabilityRef = useRef("");
  const [comfyRetrying, setComfyRetrying] = useState(false);

  function refreshHealth() {
    // 503 only means ComfyUI isn't answering: its body still says whether
    // this is the computer that looks after Studio, so read it either way.
    apiFetch("/api/health", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as Health | null;
        if (!data) throw new Error(response.statusText || "Connection failed");
        setHealth(data);
        // Single-user mode's administration (access.ts); with accounts the role decides.
        if (typeof data.thisComputer === "boolean") setDeviceAdmin(data.thisComputer);
        if (data.previousExit) tellPreviousExit(data.previousExit);
      })
      .catch((error) => setHealth({ ok: false, error: error instanceof Error && !/fetch|load failed/i.test(error.message) ? error.message : "Couldn’t reach Studio. Make sure it’s running" }));
  }

  /** The status poll mostly returns the same answer; a new object would re-render the whole app every five seconds. */
  function setComfyStatusIfChanged(next: ComfyStatus) {
    setComfyStatus((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  }

  function refreshComfyStatus(): Promise<void> {
    if (comfyStatusRequestRef.current) return comfyStatusRequestRef.current;
    // Only the first check shows as "checking". Later polls keep the last answer
    // on screen until the new one arrives, so the offline screen and the status
    // dot do not blink (and restart their animations) every five seconds.
    setComfyStatus((current) => (current.checked ? current : { ...current, checking: true }));
    const request = apiJson<ComfyStatus>("/api/comfy/status")
      .then((data) => {
        const availability = JSON.stringify(data.backends || {});
        // A change in which backends answer refreshes the models; the first answer only records
        // it (the models are already loading from the start, a second fetch would race them).
        if (availability !== backendAvailabilityRef.current) {
          const known = backendAvailabilityRef.current;
          backendAvailabilityRef.current = availability;
          if (known) refreshModels();
        }
        // Not at the saved address, but on ComfyUI Desktop's port (or the other way round): now saved.
        if (data.found) {
          showToast(`Found ComfyUI at ${data.found.replace(/^https?:\/\//, "")}`, "success");
          refreshHealth();
        }
        const { found: _found, ...status } = data;
        setComfyStatusIfChanged({ ...status, checking: false, checked: true });
      })
      .catch((error) => setComfyStatusIfChanged({ connected: false, checking: false, checked: true, error: error instanceof Error ? error.message : "Connection failed" }))
      .finally(() => { comfyStatusRequestRef.current = null; });
    comfyStatusRequestRef.current = request;
    return request;
  }

  /** A retry someone asked for: the buttons say "Checking…" for at least a beat, even when the answer is instant. */
  function retryComfyStatus() {
    if (comfyRetrying) return;
    setComfyRetrying(true);
    const shown = new Promise((resolve) => window.setTimeout(resolve, 700));
    Promise.all([refreshComfyStatus(), shown]).finally(() => setComfyRetrying(false));
  }

  return { health, backendStatus, setComfyStatus, comfyRetrying, refreshHealth, refreshComfyStatus, retryComfyStatus };
}
