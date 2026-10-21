import { Dices, RotateCcw } from 'lucide-react';
import { fallbackSamplers, fallbackSchedulers } from './constants';
import { cn } from './format';
import { maxLoras } from './loras';
import { NumberPicker } from './components';
import { LoraPanel } from './LoraPanel';
import { ModelSetup } from './ModelSetup';
import { ListItem, ListSection, ListSelect } from './SheetList';
import { partOptions } from './partNames';
import { usePhone } from './device';
import { Switch } from './SettingsControls';
import React from 'react';

function loraSetup(view: any) {
  const { currentProfile, mode, models, profileOptions } = view;
  // Always file names; tolerate {name} entries so an odd server can't crash the picker.
  const loraOptions: string[] = (profileOptions.loras || models?.loras || [])
    .map((option: unknown) => typeof option === "string" ? option : String((option as { name?: string })?.name || ""))
    .filter(Boolean);
  const loraLimit = Math.min(maxLoras, currentProfile?.maxLoras || maxLoras);
  const loraUnavailable = currentProfile && !currentProfile.capabilities.lora
    ? { title: "This Model Doesn’t Support LoRAs" }
    : !loraOptions.length
      ? { title: "No LoRAs Yet", hint: "Add LoRA files to ComfyUI, then rescan in Settings › Models." }
      : null;
  return { loraOptions, loraLimit, loraUnavailable };
}

/**
 * A steps range worth stepping through. A workflow's own limit is usually
 * ComfyUI's technical maximum (10000); the range here is built around the
 * workflow's default instead (a turbo model at 4 steps gets 1-24, one at 20
 * gets 1-60). It still reaches whatever is set now, never past the real limit.
 */
export function practicalStepRange(profile: any, meta: { min?: number; max?: number; default?: number } | undefined, current: number) {
  const hardMin = Math.max(1, Number(meta?.min || 1));
  const hardMax = Math.max(hardMin, Number(meta?.max || 10000));
  const recommended = Number(profile?.defaults?.steps || meta?.default || 0);
  const base = recommended || 20;
  const practical = Math.min(100, Math.max(12, base * 3, base + 20));
  const max = Math.min(hardMax, Math.max(practical, Number(current) || 0));
  return { min: hardMin, max, recommended: recommended && recommended >= hardMin && recommended <= hardMax ? recommended : 0 };
}

/**
 * Advanced Settings, one flat list (UI-PATTERNS › Lists) for the desktop
 * popover and the phone sheet: one line per setting, the label on the left
 * and its control on the right. Steppers for numbers, the shared dropdown on
 * both devices, friendly names for the
 * model parts, Upscale for the run, and Back to Recommended. Steps sit
 * in the composer (the phone's Create footer); width and height belong to Size.
 */
export function PhoneAdvancedControls({ view }: { view: any }) {
  const {
    canUseStartImage, cfg, cfgMeta, currentProfile, customSize, aspectLocked, denoise, denoiseMeta,
    height, heightMeta, mode, models, profileOptions, sampler, scheduler, seed,
    setCfg, setDenoise, setHeight, setSampler, setScheduler, setSeed, setTextEncoder, setVae,
    setWeightDtype, setWidth, textEncoder, vae, weightDtype, width, widthMeta,
    textEncoders, setTextEncoders, refreshModels, refreshWorkflows, showToast,
    inpaintActive, inpaintStrength, setInpaintStrength, inpaintFeather, setInpaintFeather, steps, stepsMeta, setSteps,
    prefs, setPrefs, upscaleStatus, recommended
  } = view;
  const phone = usePhone();
  // Upscale as part of the run (server/run-upscale.js): offered for pictures once Settings › Studio has it on.
  const upscaleOffered = mode === "image" && Boolean(prefs?.smartUpscale) && currentProfile?.family !== "grok";
  const runUpscale = Number(prefs?.runUpscale) || 0;
  const faceDetailReady = Boolean(upscaleStatus?.faceDetail?.nodesInstalled);
  const samplers = profileOptions.samplers?.length ? profileOptions.samplers : models?.samplers?.length ? models.samplers : fallbackSamplers;
  const schedulers = profileOptions.schedulers?.length ? profileOptions.schedulers : models?.schedulers?.length ? models.schedulers : fallbackSchedulers;
  const sizeStep = widthMeta.step || (mode === "video" ? 32 : 64);
  const encoderSlots = (currentProfile?.encoderSlots || []).filter((slot: { options: string[] }) => slot.options.length);
  const showVae = currentProfile?.capabilities.vae && (currentProfile.vaeBuiltIn || (profileOptions.vaes || []).length || (models?.vaes || []).length);
  const parts = encoderSlots.length || currentProfile?.capabilities.textEncoder || showVae || currentProfile?.capabilities.weightDtype;
  const sampling = currentProfile?.capabilities.sampler !== false;
  const fixedSeed = String(seed || "").trim();
  const select = (label: string, value: string, options: Array<string | { label: string; value: string }>, onChange: (value: string) => void, friendly = false) => (
    <ListItem label={label}><ListSelect label={label} value={value} options={friendly ? partOptions(options) : options.map((option) => typeof option === "string" ? { value: option, label: option } : option)} onChange={onChange} /></ListItem>
  );
  const stepper = (label: string, value: number, onChange: (value: number) => void, min: number, max: number, step: number, precision?: number) => (
    <ListItem label={label}><NumberPicker label={label} value={value} onChange={onChange} min={min} max={max} step={step} precision={precision} size="sm" density="compact" /></ListItem>
  );
  return (
    <div className="advanced-list">
      {currentProfile ? <ModelSetup key={currentProfile.id} profile={currentProfile} showToast={showToast} onInstalled={() => { refreshModels(false); refreshWorkflows(); }} /> : null}

      <ListSection title="Sampling">
        {sampling ? select("Sampler", sampler, samplers, setSampler) : null}
        {sampling ? select("Scheduler", scheduler, schedulers, setScheduler) : null}
        {/* Distilled profiles run at their own guidance (capabilities.cfg false): no CFG to set. */}
        {currentProfile?.capabilities?.cfg !== false ? stepper("Prompt Strength (CFG)", cfg, setCfg, cfgMeta.min ?? 0, Math.min(cfgMeta.max ?? 30, 30), cfgMeta.step || 0.5, 1) : null}
        <ListItem label="Seed">
          {/* Random until a seed is kept: then the number shows, to edit or copy. */}
          {fixedSeed ? <input className="list-field" inputMode="numeric" pattern="[0-9]*" value={seed} aria-label="Seed" onChange={(event) => setSeed(event.target.value.replace(/[^0-9]/g, ""))} /> : null}
          <button type="button" className={cn("list-toggle", !fixedSeed && "is-on")} aria-pressed={!fixedSeed} aria-label="Random Seed" title={fixedSeed ? "Use a new seed every time" : "Keep one seed: the same picture every time"} onClick={() => setSeed(fixedSeed ? "" : String(Math.floor(Math.random() * 2 ** 32)))}><Dices size={16} aria-hidden="true" /><span>Random</span></button>
        </ListItem>
      </ListSection>

      {inpaintActive ? (
        <ListSection title="Inpainting">
          {currentProfile?.capabilities.denoise ? stepper("Inpaint Strength (%)", Math.round(inpaintStrength * 100), (value) => setInpaintStrength(value / 100), 5, 100, 5) : null}
          {stepper("Edge Softness (%)", Math.round(inpaintFeather * 100), (value) => setInpaintFeather(value / 100), 0, 100, 5)}
        </ListSection>
      ) : canUseStartImage && currentProfile?.capabilities.denoise ? (
        <ListSection title="Reference">
          {stepper("Change Amount (%)", Math.round(denoise * 100), (value) => setDenoise(value / 100), Math.round((denoiseMeta.min ?? 0) * 100), Math.round((denoiseMeta.max ?? 1) * 100), Math.max(1, Math.round((denoiseMeta.step || 0.05) * 100)))}
        </ListSection>
      ) : null}

      {upscaleOffered ? (
        <ListSection title="Upscale">
          {select("Upscale", String(runUpscale), [{ value: "0", label: "Off" }, { value: "2048", label: "2K" }, { value: "4096", label: "4K" }], (value) => setPrefs({ runUpscale: Number(value) }))}
          {runUpscale ? (
            <ListItem label="Face Detail">
              <Switch label="Face Detail" checked={Boolean(prefs.upscaleFaceDetail) && faceDetailReady} disabled={!faceDetailReady} onChange={(next) => setPrefs({ upscaleFaceDetail: next })} />
            </ListItem>
          ) : null}
          {runUpscale && !upscaleStatus?.ready ? <p className="list-note">Upscale needs its models first: set it up in Settings › Studio.</p> : null}
        </ListSection>
      ) : null}

      {parts ? (
        <ListSection title="Model Parts">
          {encoderSlots.length
            ? encoderSlots.map((slot: { slot: string; label: string; options: string[]; default: string }, index: number) => (
              <React.Fragment key={slot.slot}>{select(encoderSlots.length > 1 ? slot.label : "Text Encoder", textEncoders?.[index] || slot.default, slot.options, (value) => setTextEncoders((current: string[]) => { const next = [...(current || [])]; next[index] = value; return next; }), true)}</React.Fragment>
            ))
            : currentProfile?.capabilities.textEncoder ? select("Text Encoder", textEncoder, profileOptions.textEncoders || models?.textEncoders || [], setTextEncoder, true) : null}
          {currentProfile?.encoderBuiltIn ? <ListItem label="Text Encoder"><span className="list-row-value">Built into the Checkpoint</span></ListItem> : null}
          {showVae ? select("VAE", vae || (currentProfile.vaeBuiltIn ? "__builtin" : ""), [...(currentProfile.vaeBuiltIn ? [{ label: "Built into the Checkpoint", value: "__builtin" }] : []), ...(profileOptions.vaes || models?.vaes || [])], (value) => setVae(value === "__builtin" ? "" : value), true) : null}
          {currentProfile?.capabilities.weightDtype ? select("Weight Type", weightDtype, profileOptions.weightDtypes || models?.weightDtypes || [], setWeightDtype, true) : null}
        </ListSection>
      ) : null}
      {recommended?.differs ? <button type="button" className="list-row list-row-action" onClick={recommended.restore}><RotateCcw size={16} aria-hidden="true" /><span className="list-row-label">Back to Recommended</span></button> : null}
    </div>
  );
}

export function ModelLoraControls({ view, browseFirst = false }: { view: any; browseFirst?: boolean }) {
  const { loraOptions, loraLimit, loraUnavailable } = loraSetup(view);
  return <section className="model-loras" aria-label="Optional LoRAs"><h3>Optional LoRAs</h3><LoraPanel browseFirst={browseFirst} loras={view.loras} setLoras={view.setLoras} options={loraOptions} profile={view.currentProfile} limit={loraLimit} library={view.loraLibrary} rememberedStrength={view.rememberedLoraStrength} unavailableReason={loraUnavailable} assistant={view.assistant} /></section>;
}
