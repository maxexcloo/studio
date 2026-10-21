import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { apiJson, loadPrefs, savePrefs } from './api';
import { clientJobUuid } from './format';
import { fitRatio, sameRatio, snapSide, type SideLimits, type Size } from './sizing';
import { showToastTone as showToast } from './toast';
import type { Preferences, SavedSize } from './types';

/**
 * Sizes saved for every device, kept on the server (/api/sizes). Named
 * Custom, Custom 2, … in turn; picking one puts it in Custom, fitted to this
 * model's limits; removing one can be undone from its toast. Changes show at
 * once and are sent behind; another device's arrive when this page comes back
 * into view.
 */
export function useSavedSizes({ width, height, customLimits, setCustomDimensions, setPrefsState }: {
  width: number;
  height: number;
  customLimits: { width: SideLimits; height: SideLimits };
  setCustomDimensions: (next: Size) => void;
  setPrefsState: React.Dispatch<React.SetStateAction<Preferences>>;
}) {
  const [savedSizes, setSavedSizesState] = useState<SavedSize[]>([]);
  const savedSizesRef = useRef<SavedSize[]>([]);
  // The ids last had from the server: sent with each save, so one another device added since is kept, not overwritten.
  const serverSizeIdsRef = useRef<string[]>([]);
  function updateSavedSizes(change: (current: SavedSize[]) => SavedSize[]) {
    const next = change(savedSizesRef.current);
    savedSizesRef.current = next;
    setSavedSizesState(next);
    apiJson<{ sizes: SavedSize[] }>("/api/sizes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ sizes: next, base: serverSizeIdsRef.current }) })
      .then((data) => {
        if (!Array.isArray(data.sizes)) return;
        serverSizeIdsRef.current = data.sizes.map((item) => item.id);
        // Another device's sizes come in with the answer, unless this page changed again meanwhile.
        if (savedSizesRef.current === next) { savedSizesRef.current = data.sizes; setSavedSizesState(data.sizes); }
      })
      .catch(() => showToast("Couldn’t save your sizes. They’re kept on this page until it reloads.", "error"));
  }
  useEffect(() => {
    let alive = true;
    const load = () => apiJson<{ sizes: SavedSize[] }>("/api/sizes").then((data) => {
      if (!alive) return;
      const sizes = Array.isArray(data.sizes) ? data.sizes : [];
      serverSizeIdsRef.current = sizes.map((item) => item.id);
      // Sizes saved in this browser before they lived on the server move over, once.
      const local = loadPrefs().savedSizes || [];
      if (local.length) {
        const known = new Set(sizes.map((item) => item.id));
        savedSizesRef.current = sizes;
        updateSavedSizes((current) => [...current, ...local.filter((item) => !known.has(item.id))]);
        setPrefsState((current) => {
          const { savedSizes: _moved, ...rest } = current;
          try { savePrefs(rest); } catch { /* moved either way */ }
          return rest;
        });
        return;
      }
      savedSizesRef.current = sizes;
      setSavedSizesState(sizes);
    }).catch(() => null);
    load();
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; document.removeEventListener("visibilitychange", onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function saveCustomSize() {
    if (savedSizesRef.current.some((item) => item.width === width && item.height === height)) return;
    updateSavedSizes((current) => {
      const names = new Set(current.map((item) => item.name));
      let name = "Custom";
      for (let n = 2; names.has(name); n += 1) name = `Custom ${n}`;
      return [...current, { id: clientJobUuid(), name, width, height }];
    });
  }
  function renameSavedSize(id: string, name: string) {
    const next = name.trim().slice(0, 32);
    if (!next) return;
    updateSavedSizes((current) => current.map((item) => item.id === id ? { ...item, name: next } : item));
  }
  function removeSavedSize(id: string) {
    const index = savedSizesRef.current.findIndex((item) => item.id === id);
    if (index < 0) return;
    const removed = savedSizesRef.current[index];
    updateSavedSizes((current) => current.filter((item) => item.id !== id));
    showToast(`Removed “${removed.name}”`, "removed", {
      action: { label: "Undo", onClick: () => updateSavedSizes((current) => {
        if (current.some((item) => item.id === removed.id)) return current;
        const restored = [...current];
        restored.splice(Math.min(index, restored.length), 0, removed);
        return restored;
      }) }
    });
  }
  function pickSavedSize(saved: SavedSize) {
    const snapped = { width: snapSide(saved.width, customLimits.width), height: snapSide(saved.height, customLimits.height) };
    // Past this model's limits: its shape at the largest size that fits, not each side cut on its own (a 2:1 turned 4:3).
    const fitted = sameRatio(snapped, saved) ? snapped : fitRatio(saved.width / saved.height, saved.width * saved.height, customLimits.width, customLimits.height, 16);
    setCustomDimensions(fitted);
    if (fitted.width !== saved.width || fitted.height !== saved.height) {
      showToast(`“${saved.name}” fitted to this model: ${fitted.width} × ${fitted.height}`, "default");
    }
  }
  return { savedSizes, saveCustomSize, renameSavedSize, removeSavedSize, pickSavedSize };
}
