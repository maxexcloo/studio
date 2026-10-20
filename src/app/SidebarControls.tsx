import { imageDimension } from './generationOptions';
import { GrokMediaControls } from './GrokMediaControls';
import { VideoDurationControls } from './VideoDurationControls';
import { modelName } from './catalogueNames';
import { ChevronRight, Dices, GalleryHorizontalEnd, RotateCcw, Wand2, X } from 'lucide-react';
import { fallbackSamplers, fallbackSchedulers } from './constants';
import { cn } from './format';
import { maxLoras } from './loras';
import { Field, NumberPicker, Skeleton, StudioSelect as Select, Tip } from './components';
import { LoraPanel } from './LoraPanel';
import { ModelSetup } from './ModelSetup';
import { ModelFoldersNotice } from './ModelFoldersNotice';
import { workflowState } from './workflowStatus';
import { useComfyRestarting } from './ComfyRestart';
import type { WorkflowSummary } from './types';
import { SafeImg } from './SafeImg';
import { referenceName } from './ReferenceMediaPicker';
import { ListItem, ListSection, ListSelect } from './SheetList';
import { partOptions } from './partNames';
import { usePhone } from './device';
import React from 'react';

function WorkflowPreviewCard({ workflow, onOpen }: { workflow: WorkflowSummary | null; onOpen: () => void }) {
  const comfyRestarting = useComfyRestarting();
  if (!workflow) return (
    <button type="button" className="workflow-card" onClick={onOpen}>
      <div className="workflow-card-thumb"><GalleryHorizontalEnd size={18} /></div>
      <div className="workflow-card-info">
        <strong>No Model Selected</strong>
        <span>Browse Models</span>
      </div>
      <ChevronRight size={15} className="workflow-card-arrow" />
    </button>
  );

  const status = workflowState(workflow.validation, comfyRestarting);
  return (
    <Tip content="Change Model">
      <button type="button" className={cn("workflow-card", status.state !== "ready" && "has-issues")} onClick={onOpen}>
        <div className="workflow-card-thumb">
          <SafeImg src={workflow.thumbnail} fallback={<Wand2 size={18} />} />
        </div>
        <div className="workflow-card-info">
          <strong>{modelName({ label: workflow.name, kind: workflow.kind }).name}</strong>
          {status.state === "ready"
            ? <span>{modelName({ label: workflow.name, kind: workflow.kind, family: workflow.family }).detail || (workflow.source === "builtin" ? "Built In" : "Imported")}</span>
            : <span className={cn("wf-status", `is-${status.state}`)}><i aria-hidden="true" />{status.label}</span>}
        </div>
        <ChevronRight size={15} className="workflow-card-arrow" />
      </button>
    </Tip>
  );
}

export type SidebarTab = "basics" | "loras" | "advanced";

/** What LoRAs the current workflow can take, shared by both composers. */
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
 * and its control on the right. Steppers for numbers, the studio's select on
 * the desktop and the phone's own picker on a phone, friendly names for the
 * model parts. The phone adds Steps, which the desktop has in the composer.
 */
export function PhoneAdvancedControls({ view }: { view: any }) {
  const {
    canUseStartImage, cfg, cfgMeta, currentProfile, customSize, aspectLocked, denoise, denoiseMeta,
    height, heightMeta, mode, models, profileOptions, sampler, scheduler, seed,
    setCfg, setDenoise, setHeight, setSampler, setScheduler, setSeed, setTextEncoder, setVae,
    setWeightDtype, setWidth, textEncoder, vae, weightDtype, width, widthMeta,
    textEncoders, setTextEncoders, refreshModels, refreshWorkflows, showToast,
    inpaintActive, inpaintStrength, setInpaintStrength, inpaintFeather, setInpaintFeather, steps, stepsMeta, setSteps
  } = view;
  const phone = usePhone();
  const samplers = profileOptions.samplers?.length ? profileOptions.samplers : models?.samplers?.length ? models.samplers : fallbackSamplers;
  const schedulers = profileOptions.schedulers?.length ? profileOptions.schedulers : models?.schedulers?.length ? models.schedulers : fallbackSchedulers;
  const sizeStep = widthMeta.step || (mode === "video" ? 32 : 64);
  const encoderSlots = (currentProfile?.encoderSlots || []).filter((slot: { options: string[] }) => slot.options.length);
  const showVae = currentProfile?.capabilities.vae && (currentProfile.vaeBuiltIn || (profileOptions.vaes || []).length || (models?.vaes || []).length);
  const parts = encoderSlots.length || currentProfile?.capabilities.textEncoder || showVae || currentProfile?.capabilities.weightDtype;
  const sampling = currentProfile?.capabilities.sampler !== false;
  const { min: stepMin, max: stepMax } = practicalStepRange(currentProfile, stepsMeta, steps);
  const fixedSeed = String(seed || "").trim();
  const select = (label: string, value: string, options: Array<string | { label: string; value: string }>, onChange: (value: string) => void, friendly = false) => (
    <ListItem label={label}><ListSelect native={phone} label={label} value={value} options={friendly ? partOptions(options) : options.map((option) => typeof option === "string" ? { value: option, label: option } : option)} onChange={onChange} /></ListItem>
  );
  const stepper = (label: string, value: number, onChange: (value: number) => void, min: number, max: number, step: number, precision?: number) => (
    <ListItem label={label}><NumberPicker label={label} value={value} onChange={onChange} min={min} max={max} step={step} precision={precision} size="sm" density="compact" /></ListItem>
  );
  return (
    <div className="advanced-list">
      {currentProfile ? <ModelSetup key={currentProfile.id} profile={currentProfile} showToast={showToast} onInstalled={() => { refreshModels(false); refreshWorkflows(); }} /> : null}

      <ListSection title="Sampling">
        {phone && currentProfile?.family !== "grok" && currentProfile?.capabilities.steps !== false ? stepper("Steps", steps, setSteps, stepMin, stepMax, 1) : null}
        {sampling ? select("Sampler", sampler, samplers, setSampler) : null}
        {sampling ? select("Scheduler", scheduler, schedulers, setScheduler) : null}
        {stepper("Prompt Strength (CFG)", cfg, setCfg, cfgMeta.min ?? 0, Math.min(cfgMeta.max ?? 30, 30), cfgMeta.step || 0.5, 1)}
        <ListItem label="Seed">
          {/* Random until a seed is kept: then the number shows, to edit or copy. */}
          {fixedSeed ? <input className="list-field" inputMode="numeric" pattern="[0-9]*" value={seed} aria-label="Seed" onChange={(event) => setSeed(event.target.value.replace(/[^0-9]/g, ""))} /> : null}
          <button type="button" className={cn("list-toggle", !fixedSeed && "is-on")} aria-pressed={!fixedSeed} aria-label="Random Seed" title={fixedSeed ? "Use a new seed every time" : "Keep one seed: the same picture every time"} onClick={() => setSeed(fixedSeed ? "" : String(Math.floor(Math.random() * 2 ** 32)))}><Dices size={15} aria-hidden="true" /><span>Random</span></button>
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

      {customSize && !aspectLocked ? (
        <ListSection title="Size">
          {stepper("Width", width, (value) => setWidth(imageDimension(value, widthMeta)), widthMeta.min ?? 64, widthMeta.max ?? 4096, sizeStep)}
          {stepper("Height", height, (value) => setHeight(imageDimension(value, heightMeta)), heightMeta.min ?? 64, heightMeta.max ?? 4096, heightMeta.step || sizeStep)}
        </ListSection>
      ) : aspectLocked ? <p className="list-note">The size follows the image being edited ({width}×{height}).</p> : null}

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
    </div>
  );
}

export function ModelLoraControls({ view, browseFirst = false }: { view: any; browseFirst?: boolean }) {
  const { loraOptions, loraLimit, loraUnavailable } = loraSetup(view);
  return <section className="model-loras" aria-label="Optional LoRAs"><h3>Optional LoRAs</h3><LoraPanel browseFirst={browseFirst} loras={view.loras} setLoras={view.setLoras} options={loraOptions} profile={view.currentProfile} limit={loraLimit} library={view.loraLibrary} rememberedStrength={view.rememberedLoraStrength} unavailableReason={loraUnavailable} /></section>;
}

export function SidebarControls({ view }: { view: any }) {
  const {
    canUseStartImage, cfg, cfgMeta, count, countMeta, currentProfile, currentWorkflow,
    customSize, aspectLocked, denoise, denoiseMeta, height, heightMeta, loras,
    loraActiveCount, mode, models, profileOptions, sampler, scheduler, seed,
    setCfg, setCount, setDenoise, setHeight, setLoras, setSampler,
    setScheduler, setSeed, setSteps, setTextEncoder, setVae,
    setWeightDtype, setWidth, steps, stepsMeta, textEncoder, vae, weightDtype,
    width, widthMeta, setWorkflowGalleryOpen, loraLibrary, rememberedLoraStrength,
    textEncoders, setTextEncoders, refreshModels, refreshWorkflows, showToast, modelFolders,
    sidebarTab: tab, setSidebarTab: setTab, recommended, sidebarReference,
    inpaintActive, inpaintStrength, setInpaintStrength, inpaintFeather, setInpaintFeather
  } = view as Record<string, any> & { sidebarTab: SidebarTab; setSidebarTab: (tab: SidebarTab) => void; recommended?: { differs: boolean; restore: () => void; family: string } };

  // What the model's makers ship, one tap away once anything has moved from it.
  const backToRecommended = recommended?.differs ? (
    <button type="button" className="btn is-ghost sidebar-recommended" onClick={recommended.restore} title={`The steps, prompt strength, sampler and scheduler recommended for ${recommended.family || "this model"}`}>
      <RotateCcw size={13} /> <span>Back to Recommended</span>
    </button>
  ) : null;

  return (
    <>
      <div className="sidebar-scroll">
      <WorkflowPreviewCard workflow={currentWorkflow} onOpen={() => setWorkflowGalleryOpen(true)} />
      <ModelLoraControls view={view} />
      <GrokMediaControls view={view} />
      <VideoDurationControls view={view} />

      {modelFolders ? <ModelFoldersNotice folders={modelFolders} /> : null}

      {/* Always mounted: it shows what is missing, and a moment of "ready" when the last part lands. */}
      {currentProfile ? (
        <ModelSetup key={currentProfile.id} profile={currentProfile} showToast={showToast} onInstalled={() => { refreshModels(false); refreshWorkflows(); }} />
      ) : null}

      <div className="sidebar-subtabs" role="tablist" aria-label="Sidebar Sections">
        {(["basics", "advanced"] as SidebarTab[]).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={cn("sidebar-subtab", tab === id && "active")} onClick={() => setTab(id)}>
            <span>{id === "basics" ? "Basics" : "Advanced"}</span>
          </button>
        ))}
      </div>

      <div className="sidebar-body">
        {tab !== "advanced" ? (
          <>
            {sidebarReference ? (
              <section className="sidebar-reference" aria-label={sidebarReference.label}>
                <div className="sidebar-reference-row">
                  <span className="sidebar-reference-thumb"><SafeImg src={sidebarReference.asset.thumbnailUrl || sidebarReference.asset.url || ""} alt="" /></span>
                  <span className="sidebar-reference-copy">
                    <strong>{sidebarReference.label}</strong>
                    <small>{referenceName(sidebarReference.asset.name)}</small>
                  </span>
                  <Tip content={`Remove ${sidebarReference.label.toLowerCase()}`}>
                    <button type="button" className="icon-button sidebar-reference-remove" aria-label={`Remove ${sidebarReference.label.toLowerCase()}`} onClick={sidebarReference.remove}><X size={14} /></button>
                  </Tip>
                </div>
                {inpaintActive ? (
                  <>
                    {/* Edit models edit the crop whole, so only image-to-image models have a strength here. */}
                    {currentProfile?.capabilities.denoise ? (
                      <>
                        <NumberPicker label="Inpaint Strength" value={inpaintStrength} onChange={setInpaintStrength} min={0.05} max={1} step={0.05} precision={2} fill />
                        <div className="sidebar-scale-hint" aria-hidden="true"><span>Touch it up</span><span>Paint it anew</span></div>
                      </>
                    ) : null}
                    <NumberPicker label="Edge Softness" value={inpaintFeather} onChange={setInpaintFeather} min={0} max={1} step={0.05} precision={2} fill />
                    <div className="sidebar-scale-hint" aria-hidden="true"><span>Crisp</span><span>Soft</span></div>
                  </>
                ) : canUseStartImage && currentProfile?.capabilities.denoise ? (
                  <>
                    <NumberPicker label="Change from the Reference" value={denoise} onChange={setDenoise} min={denoiseMeta.min ?? 0} max={denoiseMeta.max ?? 1} step={denoiseMeta.step || 0.05} precision={2} fill />
                    <div className="sidebar-scale-hint" aria-hidden="true"><span>Keep it close</span><span>Change a lot</span></div>
                  </>
                ) : null}
              </section>
            ) : null}
            <div className="number-row">
              {currentProfile?.capabilities.steps !== false ? <NumberPicker label="Steps" value={steps} onChange={setSteps} min={stepsMeta.min || 1} max={stepsMeta.max ?? 150} step={stepsMeta.step || 1} fill /> : null}
              {mode === "image" ? (
                <NumberPicker label="Images" value={count} onChange={setCount} min={countMeta.min || 1} max={countMeta.max ?? 8} step={countMeta.step || 1} fill />
              ) : null}
            </div>
            <Field label="Seed"><input inputMode="numeric" value={seed} placeholder="Random" onChange={(event) => setSeed(event.target.value.replace(/[^0-9]/g, ""))} /></Field>
            <p className="sidebar-hint">{String(seed || "").trim() ? "The same picture every time." : "A new picture every time."}</p>
            {customSize && !aspectLocked ? (
              <div className="number-row">
                <NumberPicker label="Width" value={width} onChange={(value) => setWidth(imageDimension(value, widthMeta))} min={widthMeta.min ?? 64} max={widthMeta.max ?? 4096} step={widthMeta.step || (mode === "video" ? 32 : 64)} fill />
                <NumberPicker label="Height" value={height} onChange={(value) => setHeight(imageDimension(value, heightMeta))} min={heightMeta.min ?? 64} max={heightMeta.max ?? 4096} step={heightMeta.step || (mode === "video" ? 32 : 64)} fill />
              </div>
            ) : null}
            {aspectLocked ? (
              <p className="sidebar-hint">Output size follows the image being edited ({width}&times;{height}).</p>
            ) : null}
            {backToRecommended}
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
              {currentProfile?.encoderSlots
                ? currentProfile.encoderSlots.filter((slot: { options: string[] }) => slot.options.length).map((slot: { slot: string; label: string; options: string[]; default: string }, index: number) => (
                  <Field key={slot.slot} label={currentProfile.encoderSlots.length > 1 ? slot.label : "Text Encoder"}>
                    <Select value={textEncoders?.[index] || slot.default} onChange={(value: string) => setTextEncoders((current: string[]) => {
                      const next = [...(current || [])];
                      next[index] = value;
                      return next;
                    })} options={slot.options} />
                  </Field>
                ))
                : currentProfile?.capabilities.textEncoder ? <Field label="Text Encoder"><Select value={textEncoder} onChange={setTextEncoder} options={profileOptions.textEncoders || models?.textEncoders || []} /></Field> : null}
              {currentProfile?.encoderBuiltIn ? <Field label="Text Encoder"><span className="encoder-slot-builtin">Built into the Checkpoint</span></Field> : null}
              {currentProfile?.capabilities.vae && (currentProfile.vaeBuiltIn || (profileOptions.vaes || []).length) ? (
                <Field label="VAE">
                  <Select
                    value={vae || (currentProfile.vaeBuiltIn ? "__builtin" : "")}
                    onChange={(value: string) => setVae(value === "__builtin" ? "" : value)}
                    options={[...(currentProfile.vaeBuiltIn ? [{ label: "Built into the Checkpoint", value: "__builtin" }] : []), ...(profileOptions.vaes || models?.vaes || [])]}
                  />
                </Field>
              ) : null}
              {currentProfile?.capabilities.weightDtype ? <Field label="Weight Type"><Select value={weightDtype} onChange={setWeightDtype} options={profileOptions.weightDtypes || models?.weightDtypes || []} /></Field> : null}
            </div>
            <NumberPicker label="Prompt Strength (CFG)" value={cfg} onChange={setCfg} min={cfgMeta.min ?? 0} max={cfgMeta.max ?? 30} step={cfgMeta.step || 0.5} precision={1} fill />
            <div className="sidebar-scale-hint" aria-hidden="true"><span>Looser</span><span>Follows the prompt closely</span></div>
            {currentProfile?.capabilities.sampler !== false ? (
              <div className="advanced-grid">
                <Field label="Sampler"><Select value={sampler} onChange={setSampler} options={profileOptions.samplers?.length ? profileOptions.samplers : models?.samplers?.length ? models.samplers : fallbackSamplers} /></Field>
                <Field label="Scheduler"><Select value={scheduler} onChange={setScheduler} options={profileOptions.schedulers?.length ? profileOptions.schedulers : models?.schedulers?.length ? models.schedulers : fallbackSchedulers} /></Field>
              </div>
            ) : null}
            {backToRecommended}
          </>
        ) : null}
      </div>
      </div>
    </>
  );
}
