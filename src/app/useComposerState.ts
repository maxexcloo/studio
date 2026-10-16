import { useState } from "react";
import type { InpaintMask, LoraSelection, Mode, Preferences, SelectedReferenceAsset } from "./types";
import { loadDraft } from "./api";
import { normalizeLoras } from "./loras";

/** The composer draft belongs to this App, including its unsaved mask and references. */
export function useComposerState(initialDraft: ReturnType<typeof loadDraft>, prefs: Preferences) {
  const [mode, setMode] = useState<Mode>(initialDraft.mode === "video" ? "video" : "image");
  const [prompt, setPrompt] = useState(String(initialDraft.prompt || ""));
  const [negative, setNegative] = useState(String(initialDraft.negative || ""));
  const [model, setModel] = useState(String(initialDraft.model || ""));
  const [textEncoder, setTextEncoder] = useState(String(initialDraft.textEncoder || ""));
  // Built-in families can need several encoders (Flux.1 two, HiDream four), one per slot.
  const [textEncoders, setTextEncoders] = useState<string[]>(Array.isArray(initialDraft.textEncoders) ? initialDraft.textEncoders.map(String) : []);
  const [vae, setVae] = useState(String(initialDraft.vae || ""));
  const [clipType, setClipType] = useState(String(initialDraft.clipType || ""));
  const [weightDtype, setWeightDtype] = useState(String(initialDraft.weightDtype || "default"));
  const [width, setWidth] = useState(Number(initialDraft.width || 1024));
  const [height, setHeight] = useState(Number(initialDraft.height || 1024));
  const [steps, setSteps] = useState(Number(initialDraft.steps || prefs.defaultImageSteps));
  const [cfg, setCfg] = useState(Number(initialDraft.cfg ?? 1));
  const [denoise, setDenoise] = useState(Number(initialDraft.denoise ?? 0.65));
  // Inpainting: a mask painted on the first reference (never saved with the draft or a run),
  // how much the painted part may change, and how softly it blends back in.
  const [inpaintMask, setInpaintMask] = useState<InpaintMask | null>(null);
  const [inpaintStrength, setInpaintStrength] = useState(Number(initialDraft.inpaintStrength ?? 1));
  const [inpaintFeather, setInpaintFeather] = useState(Number(initialDraft.inpaintFeather ?? 0.4));
  const [seed, setSeed] = useState(String(initialDraft.seed || ""));
  const [count, setCount] = useState(Number(initialDraft.count || (initialDraft.mode === "video" ? 1 : prefs.defaultImageCount)));
  const [frames, setFrames] = useState(Number(initialDraft.frames || prefs.defaultVideoFrames));
  const [fps, setFps] = useState(Number(initialDraft.fps || prefs.defaultFps));
  const [duration, setDuration] = useState(Number(initialDraft.duration || 6));
  const [resolution, setResolution] = useState(String(initialDraft.resolution || ""));
  const [sampler, setSampler] = useState(String(initialDraft.sampler || "euler_ancestral"));
  const [scheduler, setScheduler] = useState(String(initialDraft.scheduler || "beta"));
  const [loras, setLoras] = useState<LoraSelection[]>(() => normalizeLoras(initialDraft.loras));
  const [customSize, setCustomSize] = useState(Boolean(initialDraft.customSize));
  const [startImage, setStartImage] = useState("");
  const [startImageId, setStartImageId] = useState(String(initialDraft.startImageId || ""));
  const [startImageName, setStartImageName] = useState(String(initialDraft.startImageName || ""));
  const [referenceAssets, setReferenceAssets] = useState<SelectedReferenceAsset[]>(() => Array.isArray(initialDraft.referenceAssets) ? initialDraft.referenceAssets : []);

  return {
    mode, setMode,
    prompt, setPrompt,
    negative, setNegative,
    model, setModel,
    textEncoder, setTextEncoder,
    textEncoders, setTextEncoders,
    vae, setVae,
    clipType, setClipType,
    weightDtype, setWeightDtype,
    width, setWidth,
    height, setHeight,
    steps, setSteps,
    cfg, setCfg,
    denoise, setDenoise,
    inpaintMask, setInpaintMask,
    inpaintStrength, setInpaintStrength,
    inpaintFeather, setInpaintFeather,
    seed, setSeed,
    count, setCount,
    frames, setFrames,
    fps, setFps,
    duration, setDuration,
    resolution, setResolution,
    sampler, setSampler,
    scheduler, setScheduler,
    loras, setLoras,
    customSize, setCustomSize,
    startImage, setStartImage,
    startImageId, setStartImageId,
    startImageName, setStartImageName,
    referenceAssets, setReferenceAssets,
  };
}
