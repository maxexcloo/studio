import { useEffect, useState } from 'react';
import type React from 'react';
import { scopedStorageKey } from './api';
import type { StarterPick } from './StarterModels';
import { showToastTone as showToast } from './toast';
import type { Mode, Models } from './types';

/** A downloaded starter model, selected once ComfyUI reports it ready (and remembered across a reload until then). */
export function useStarterPick({ models, mode, changeMode, pickModel, refreshModels, promptRef }: {
  models: Models | null;
  mode: Mode;
  changeMode: (next: Mode) => void;
  pickModel: (profileId: string) => void;
  refreshModels: (notify?: boolean) => unknown;
  promptRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const starterKey = scopedStorageKey("studio:starter-pick");
  const [starterPick, setStarterPick] = useState<StarterPick | null>(() => {
    try { return JSON.parse(localStorage.getItem(starterKey) || "null"); } catch { return null; }
  });
  function rememberStarter(pick: StarterPick | null) {
    setStarterPick(pick);
    try { if (pick) localStorage.setItem(starterKey, JSON.stringify(pick)); else localStorage.removeItem(starterKey); } catch { /* it just won't survive a reload */ }
  }
  const profileForFile = (file: string) => models?.profiles.find((profile) => profile.model === file || profile.model.split(/[\\/]/).pop() === file);
  function selectStarterModel(file: string) {
    const profile = profileForFile(file);
    if (!profile) { rememberStarter({ family: "", file, title: file }); refreshModels(false); return; }
    if (profile.kind !== mode) changeMode(profile.kind);
    pickModel(profile.id);
  }
  useEffect(() => {
    if (!starterPick || !models) return;
    const profile = profileForFile(starterPick.file);
    if (!profile || profile.ready === false) return;
    rememberStarter(null);
    if (profile.kind !== mode) changeMode(profile.kind);
    pickModel(profile.id);
    showToast(`${starterPick.title || profile.displayName || "The model"} is ready.`, "success");
    window.setTimeout(() => promptRef.current?.focus(), 0);
  }, [models, starterPick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { starterPick, rememberStarter, selectStarterModel };
}
