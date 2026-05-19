import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, GalleryHorizontalEnd, Minus, Plus, Search, Trash2, X } from 'lucide-react';
import { fallbackSamplers, fallbackSchedulers } from './constants';
import { cn } from './format';
import { defaultLoraStrength, maxLoras, rankedLoras, recommendedLoras } from './loras';
import { Field, NumberPicker, Skeleton, StudioSelect as Select, Tip } from './components';
import type { LoraSelection, Profile } from './types';

const LORA_COLORS = [
  "hsl(280 60% 60%)",
  "hsl(45 80% 55%)",
  "hsl(190 70% 50%)",
  "hsl(0 70% 55%)",
  "hsl(150 60% 50%)",
  "hsl(30 80% 55%)",
  "hsl(220 70% 60%)",
  "hsl(340 65% 55%)",
];

function LoraNamePicker({
  value,
  options,
  profile,
  onChange
}: {
  value: string;
  options: string[];
  profile: Profile | null;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = query || value;
  const recommended = useMemo(() => recommendedLoras(options, profile, query).slice(0, 8), [options, profile, query]);
  const ranked = useMemo(() => rankedLoras(options, profile, query).slice(0, 18), [options, profile, query]);
  const choose = (name: string) => {
    onChange(name);
    setQuery("");
    setOpen(false);
  };
  const list = (label: string, items: string[]) => items.length ? (
    <div className="lora-option-group">
      <span>{label}</span>
      {items.map((name) => (
        <button key={`${label}-${name}`} type="button" className={cn(name === value && "active")} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(name)}>
          {name}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className="lora-picker" data-open-surface={open || undefined}>
      <input
        value={open ? search : value}
        placeholder="Choose LoRA"
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          setQuery(event.target.value);
          onChange(event.target.value);
          setOpen(true);
        }}
      />
      {open ? (
        <div className="lora-menu">
          {list("Recommended", recommended)}
          {list("All", ranked)}
          {!ranked.length ? <div className="lora-empty">No LoRAs found</div> : null}
        </div>
      ) : null}
    </div>
  );
}

type SidebarTab = "basics" | "advanced" | "loras";

export function SidebarControls({ view }: { view: any }) {
  const {
    canUseStartImage, cfg, cfgMeta, changeMode, count, countMeta, currentProfile, customSize,
    denoise, denoiseMeta, fps, fpsMeta, frameMeta, frames, height, heightMeta, loras,
    loraActiveCount, mode, models, profileOptions, readStartImage, sampler, scheduler, seed,
    setCfg, setCount, setDenoise, setFps, setFrames, setHeight, setLoras, setSampler,
    setScheduler, setSeed, setStartImage, setStartImageId, setStartImageName, setSteps, setTextEncoder, setVae,
    setWeightDtype, setWidth, startImageName, steps, stepsMeta, textEncoder, vae, weightDtype,
    width, widthMeta, confirmAction, setWorkflowGalleryOpen
  } = view;

  const [tab, setTab] = useState<SidebarTab>("basics");

  const loraOptions = profileOptions.loras || models?.loras || [];
  const canUseLora = mode === "image" && Boolean(currentProfile?.capabilities.lora) && loraOptions.length > 0;

  useEffect(() => {
    if (!canUseLora && tab === "loras") setTab("basics");
  }, [canUseLora, tab]);
  const updateLora = (index: number, patch: Partial<LoraSelection>) => {
    setLoras((current: LoraSelection[]) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };
  const removeLora = (index: number) => setLoras((current: LoraSelection[]) => current.filter((_, itemIndex) => itemIndex !== index));
  const addLora = () => {
    setLoras((current: LoraSelection[]) => {
      if (current.length >= maxLoras) return current;
      const first = recommendedLoras(loraOptions, currentProfile)[0] || rankedLoras(loraOptions, currentProfile)[0] || "";
      return [...current, { name: first, enabled: true, strength: defaultLoraStrength }];
    });
  };

  return (
    <>
      <div className="mode-tabs" role="tablist" aria-label="Generation mode">
        <Tip content="Image generation"><button className={cn(mode === "image" && "active")} onClick={() => changeMode("image")}>Image</button></Tip>
        <Tip content="Video generation"><button className={cn(mode === "video" && "active")} onClick={() => changeMode("video")}>Video</button></Tip>
      </div>

      <Tip content="Browse workflows"><button type="button" className="workflow-sidebar-button" onClick={() => setWorkflowGalleryOpen(true)}>
        <GalleryHorizontalEnd size={15} />
        Workflow Gallery
      </button></Tip>

      <div className="sidebar-subtabs">
        <button className={cn("sidebar-subtab", tab === "basics" && "active")} onClick={() => setTab("basics")}>Basics</button>
        <button className={cn("sidebar-subtab", tab === "advanced" && "active")} onClick={() => setTab("advanced")}>Advanced</button>
        {canUseLora ? (
          <button className={cn("sidebar-subtab", tab === "loras" && "active")} onClick={() => setTab("loras")}>
            LoRAs
            {loraActiveCount > 0 ? <span className="sidebar-subtab-count">{loraActiveCount}</span> : null}
          </button>
        ) : null}
      </div>

      <div className="sidebar-body">
        {tab === "basics" ? (
          <>
            {mode === "video" ? (
              <div className="number-row">
                <NumberPicker label="Frames" value={frames} onChange={setFrames} min={frameMeta.min || 1} max={frameMeta.max ?? 240} step={frameMeta.step || 4} fill />
                <NumberPicker label="FPS" value={fps} onChange={setFps} min={fpsMeta.min || 1} max={fpsMeta.max ?? 60} step={fpsMeta.step || 1} fill />
              </div>
            ) : null}
            <div className="number-row">
              <NumberPicker label="Steps" value={steps} onChange={setSteps} min={stepsMeta.min || 1} max={stepsMeta.max ?? 150} step={stepsMeta.step || 1} fill />
              {mode === "image" ? (
                <NumberPicker label="Variants" value={count} onChange={setCount} min={countMeta.min || 1} max={countMeta.max ?? 8} step={countMeta.step || 1} fill />
              ) : null}
            </div>
            <Field label="Seed"><input value={seed} placeholder="Random" onChange={(event) => setSeed(event.target.value)} /></Field>
            {customSize ? (
              <div className="number-row">
                <NumberPicker label="Width" value={width} onChange={setWidth} min={widthMeta.min ?? 64} max={widthMeta.max ?? 4096} step={widthMeta.step || (mode === "video" ? 32 : 64)} fill />
                <NumberPicker label="Height" value={height} onChange={setHeight} min={heightMeta.min ?? 64} max={heightMeta.max ?? 4096} step={heightMeta.step || (mode === "video" ? 32 : 64)} fill />
              </div>
            ) : null}
            <Field label="Sampler"><Select value={sampler} onChange={setSampler} options={profileOptions.samplers?.length ? profileOptions.samplers : models?.samplers?.length ? models.samplers : fallbackSamplers} /></Field>
            <Field label="Scheduler"><Select value={scheduler} onChange={setScheduler} options={profileOptions.schedulers?.length ? profileOptions.schedulers : models?.schedulers?.length ? models.schedulers : fallbackSchedulers} /></Field>
          </>
        ) : null}

        {tab === "advanced" ? (
          <>
            <div className="advanced-grid">
              {!models ? (
                <>
                  <Skeleton className="skeleton-control" />
                  <Skeleton className="skeleton-control" />
                </>
              ) : null}
              {currentProfile?.capabilities.textEncoder ? <Field label="Text encoder"><Select value={textEncoder} onChange={setTextEncoder} options={profileOptions.textEncoders || models?.textEncoders || []} /></Field> : null}
              {currentProfile?.capabilities.vae ? <Field label="VAE"><Select value={vae} onChange={setVae} options={profileOptions.vaes || models?.vaes || []} /></Field> : null}
              {currentProfile?.capabilities.weightDtype ? <Field label="Weight dtype"><Select value={weightDtype} onChange={setWeightDtype} options={profileOptions.weightDtypes || models?.weightDtypes || []} /></Field> : null}
              <NumberPicker label="CFG" value={cfg} onChange={setCfg} min={cfgMeta.min ?? 0} max={cfgMeta.max ?? 30} step={cfgMeta.step || 0.5} precision={1} fill />
            </div>
            {canUseStartImage ? (
              <Field label="Start image">
                <label className="file-pick">
                  <input type="file" accept="image/*" onChange={(event) => readStartImage(event.target.files?.[0])} />
                  <span>{startImageName || "Choose image"}</span>
                  {startImageName ? <Tip content="Clear start image"><button type="button" onClick={(event) => { event.preventDefault(); if (confirmAction("Clear the selected start image?")) { setStartImage(""); setStartImageId(""); setStartImageName(""); } }}>Clear</button></Tip> : null}
                </label>
                {currentProfile?.capabilities.denoise ? (
                  <NumberPicker label="Denoise" value={denoise} onChange={setDenoise} min={denoiseMeta.min ?? 0} max={denoiseMeta.max ?? 1} step={denoiseMeta.step || 0.05} precision={2} fill />
                ) : null}
              </Field>
            ) : null}
          </>
        ) : null}

        {tab === "loras" && canUseLora ? (
          <div className="lora-tab">
            <div className="lora-list">
              {loras.length ? loras.map((item: LoraSelection, index: number) => (
                <div className={cn("lora-list-row", !item.enabled && "is-disabled")} key={index}>
                  <div className="lora-swatch" style={{ background: LORA_COLORS[index % LORA_COLORS.length] }} />
                  <button
                    type="button"
                    className={cn("lora-check", item.enabled && "on")}
                    onClick={() => updateLora(index, { enabled: !item.enabled })}
                    aria-label={item.enabled ? "Disable LoRA" : "Enable LoRA"}
                  />
                  <div className="lora-list-info">
                    <LoraNamePicker value={item.name} options={loraOptions} profile={currentProfile} onChange={(name) => updateLora(index, { name })} />
                  </div>
                  <div className="lora-weight-ctrl">
                    <button type="button" onClick={() => updateLora(index, { strength: Math.round((item.strength - 0.05) * 100) / 100 })}><Minus size={11} /></button>
                    <span className="wval">{item.strength.toFixed(2)}</span>
                    <button type="button" onClick={() => updateLora(index, { strength: Math.round((item.strength + 0.05) * 100) / 100 })}><Plus size={11} /></button>
                  </div>
                  <Tip content="Remove LoRA"><button type="button" className="lora-del" onClick={() => removeLora(index)}><Trash2 size={12} /></button></Tip>
                </div>
              )) : (
                <div className="lora-list-empty">No LoRAs added yet</div>
              )}
            </div>
            <Tip content={loras.length >= maxLoras ? `Up to ${maxLoras} LoRAs` : "Add LoRA"}>
              <button type="button" className="lora-add-btn" onClick={addLora} disabled={loras.length >= maxLoras}>
                <Plus size={14} />
                Add LoRA
              </button>
            </Tip>
          </div>
        ) : null}
      </div>
    </>
  );
}
