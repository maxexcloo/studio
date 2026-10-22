import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, Eraser, Ratio, RefreshCw, Wand2, X } from 'lucide-react';
import { useMotionTween } from '@/lib/springs';
import { PromptField } from './PromptField';
import { LoraSuggestionChips, NegativeAssistantButton, PromptAssistantButton } from './PromptAssistant';
import { ComposerModeSelect } from './ComposerModeSelect';
import { modelName } from './catalogueNames';
import { cn } from './format';
import { NumberPicker } from './components';
import { Sheet } from './Sheet';
import { ReferenceSlots } from './ReferenceMediaPicker';
import { estimatePhrase } from './useGenerationEstimate';
import { sizeMenuModel, type SizeTier } from './SizeMenu';
import { ratioName } from './sizing';
import { ListButton, ListItem } from './SheetList';
import { AdvancedPopover, ComposerSurface } from './LoraPopover';
import { practicalStepRange, StablePhoneAdvancedControls, stepsOffered } from './SidebarControls';
import { PromptHistorySheet } from './PromptHistory';
import { usePromptHistory } from './recentPrompts';
import { PhoneModelList, PhoneSize } from './PhoneCreatePickers';
import type { PhoneView } from './PhoneStudio';

/**
 * The phone's Create sheet (UI-PATTERNS › Phone): the prompt takes the room
 * that's left, then one row per choice (Model, References, LoRAs, Size,
 * Advanced), with Steps, the count, Image | Video, Clear All and Generate
 * always in view in its footer. Model, Size and Advanced open one pop-up over
 * it at a time.
 */
export function CreateSheet({ view, open, onClose, canUseNegativePrompt, comfyOffline }: { view: PhoneView; open: boolean; onClose: () => void; canUseNegativePrompt: boolean; comfyOffline: boolean }) {
  const heightTween = useMotionTween();
  const {
    prompt, setPrompt, promptLimit, clampText, negative, setNegative, negativeLimit, currentProfile,
    aspectOptions, aspectPickerValue, aspectValue, aspectLocked, defaultAspectSize, mode, count, countMeta, setCount, steps, stepsMeta, setSteps,
    referenceInputs, referenceInpaint, referenceRole, referenceAssets, selectReferenceAsset, removeReferenceAsset, showToast,
    generate, generateDisabled, generateDisabledReason, comfyStatus, retryComfyStatus, comfyRetrying, seed, generationEstimate,
    customSize, sizeTier, sizeMax, customLimits, sizeArea, sampler, assistant
  } = view;
  const picked = referenceAssets;
  // One pop-up over Create at a time (UI-PATTERNS › Surfaces): Model, Size or Advanced; References and LoRAs have their own.
  const [pop, setPop] = React.useState<'' | 'model' | 'size' | 'advanced'>('');
  React.useEffect(() => { if (!open) setPop(''); }, [open]);
  const toggle = (which: 'model' | 'size' | 'advanced') => setPop((current) => current === which ? '' : which);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyKind, setHistoryKind] = React.useState<'positive' | 'negative'>('positive');
  const { prompts: recentNegatives } = usePromptHistory(open, 'negative');
  const { prompts: recentPrompts } = usePromptHistory(open);
  const restarting = Boolean(comfyStatus?.restarting);
  const variations = mode === 'video' || currentProfile?.capabilities?.variations !== false;
  const maxCount = Math.max(1, Number(countMeta?.max || 8));
  // The size row reads like the desktop's size button: the shape, its name, the size it makes.
  const tier: SizeTier = customSize ? 'custom' : sizeTier || 'none';
  const size = sizeMenuModel({ value: aspectPickerValue, options: aspectOptions || [], currentSize: aspectValue, defaultSize: defaultAspectSize, tier, native: currentProfile?.native, sizeMax, limits: customLimits, targetArea: sizeArea || 0 });
  const sizeText = `${ratioName(size.shown.width, size.shown.height)} · ${size.shown.width}×${size.shown.height}`;
  // A long run says so before it starts; a quick one needs no warning.
  const estimate = generationEstimate?.ms && generationEstimate.ms >= 45_000 ? `Takes ${estimatePhrase(generationEstimate)}.` : '';
  const hasReferences = Boolean((referenceInputs || []).length);
  const lorasOffered = mode !== 'video' || currentProfile?.capabilities?.lora;
  const fixedSeed = String(seed || '').trim();
  const showSteps = stepsOffered(currentProfile);
  const advancedText = [sampler ? String(sampler) : '', fixedSeed ? `Seed ${fixedSeed}` : '', Number(view.prefs?.runUpscale) ? `Upscale ${Number(view.prefs.runUpscale) === 4096 ? '4K' : '2K'}` : ''].filter(Boolean).join(' · ');
  const blocked = restarting || (!comfyOffline && (!prompt.trim() || generateDisabled));
  const { min: stepMin, max: stepMax } = practicalStepRange(currentProfile, stepsMeta, steps);

  // Clear at the end of the References and LoRAs rows, with Undo in the status pill.
  const clearReferences = () => {
    const cleared = [...picked];
    removeReferenceAsset(cleared.map((item) => item.slot));
    showToast('References cleared', 'default', { action: { label: 'Undo', onClick: () => cleared.forEach((item) => selectReferenceAsset(item.slot, item.asset)) } });
  };

  // A focused Prompt or Negative shows only itself, above the keyboard (useTextFocus).
  const [textFocus, setTextFocus] = React.useState(false);
  React.useEffect(() => { if (!open) setTextFocus(false); }, [open]);

  const go = () => {
    if (comfyOffline) { retryComfyStatus(); return; }
    if (restarting) return;
    // generate() explains anything missing; only close when it can actually run.
    const ready = prompt.trim() && !generateDisabled;
    generate();
    if (ready) onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      full
      className={cn('phone-create', textFocus && 'is-text-focus')}
      title="Create"
      footer={
        <>
          {/* Two lines, always in view: Steps and the count, then Image | Video, Clear and Generate. */}
          {showSteps || (variations && maxCount > 1) ? (
            <div className="create-footer-tune">
              {showSteps ? <NumberPicker className="create-tune create-steps" label="Steps" value={steps} min={stepMin} max={stepMax} step={1} onChange={setSteps} size="sm" /> : null}
              {variations && maxCount > 1 ? <NumberPicker className="create-tune composer-count-picker create-count" label={mode === 'video' ? 'Videos' : 'Images'} value={count} min={countMeta.min || 1} max={maxCount} step={countMeta.step || 1} onChange={setCount} size="sm" /> : null}
            </div>
          ) : null}
          <div className="create-footer">
            <ComposerModeSelect mode={mode} onChange={view.changeMode} tips={false} />
            <button type="button" className="phone-icon create-reset" aria-label="Clear All" aria-description="Clears the prompt, negative prompt, references and LoRAs" onClick={view.resetCreation}><Eraser size={20} /></button>
            <button type="button" className={cn('phone-generate create-generate', restarting && 'is-restarting', comfyOffline && !restarting && 'is-offline')} aria-label={comfyOffline ? 'Check Again' : 'Generate'} aria-description={(generateDisabled && prompt.trim() ? generateDisabledReason : estimate) || undefined} aria-disabled={blocked || undefined} onClick={go}>
              {restarting || comfyOffline ? <RefreshCw size={18} className={cn((restarting || comfyRetrying) && 'spin')} /> : <ArrowUp size={18} strokeWidth={2.4} />}
              <span>{restarting ? 'Restarting' : comfyOffline ? 'Check Again' : 'Generate'}</span>
            </button>
          </div>
        </>
      }
    >
      {/* One flat column: the prompt takes the room that's left, then one row per choice. */}
      <div className="create-flow">
        <div className="create-prompts">
          <PromptField kind="positive" fill selectAll focusMode onFocusModeChange={setTextFocus} value={prompt} ariaLabel="Prompt" onChange={(value) => setPrompt(clampText(value, promptLimit))} onClear={() => setPrompt('')} historyAvailable={Boolean(recentPrompts.length)} historyOpen={historyOpen && historyKind === 'positive'} onHistory={() => { setHistoryKind('positive'); setHistoryOpen(true); }}
            assistant={assistant?.available ? ({ focused, keepFocus }) => <PromptAssistantButton assistant={assistant} phone focused={focused} keepFocus={keepFocus} hasPrompt={Boolean(prompt.trim())} /> : null} busy={assistant?.busy === 'rewrite'} />
          {assistant ? <LoraSuggestionChips assistant={assistant} /> : null}
          {currentProfile?.capabilities?.negativePrompt !== false ? <PromptField kind="negative" minRows={2} focusMode onFocusModeChange={setTextFocus} value={negative} onChange={(value) => setNegative(clampText(value, negativeLimit))} onClear={() => setNegative('')} historyAvailable={Boolean(recentNegatives.length)} historyOpen={historyOpen && historyKind === 'negative'} onHistory={() => { setHistoryKind('negative'); setHistoryOpen(true); }}
            assistant={assistant?.negativeOffered ? <NegativeAssistantButton assistant={assistant} hasPrompt={Boolean(prompt.trim())} /> : null} busy={assistant?.busy === 'negative'} /> : null}
        </div>
        <div className="list-group create-options">
          <ListButton className="phone-model-browse" label="Model" value={currentProfile ? modelName(currentProfile).name : 'Choose'} data-open-trigger aria-label="Choose Model" aria-haspopup="dialog" aria-expanded={pop === 'model'} onClick={() => toggle('model')} />
          {hasReferences ? (
            // The chooser's button lands here (ReferenceSlots portals into the tools), as wide as the row; Clear sits at its end.
            <div className={cn('list-row is-static create-references', picked.length > 0 && 'has-picks')}>
              <span className="list-row-label">References</span>
              <div className="composer-reference-tools" />
              {picked.length ? <button type="button" className="list-row-clear" aria-label="Clear References" onClick={clearReferences}><X size={16} aria-hidden="true" /></button> : null}
            </div>
          ) : null}
          {/* Edit or Reference, in plain sight: on a phone there's no hover to open the chip's menu, and no tooltip to say what each does. */}
          <AnimatePresence initial={false}>
            {referenceRole ? (
              <motion.div key="role" className="phone-ref-role" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={heightTween}>
                <div className={cn('ref-menu-role', referenceRole.value === 'reference' && 'is-ref', referenceRole.locked && 'is-locked')} role="radiogroup" aria-label="What This Image Is">
                  <i aria-hidden="true" />
                  {(['edit', 'reference'] as const).map((value) => (
                    // A painted mask settles it as Edit: Reference stays, unavailable, and the line says why.
                    <button key={value} type="button" role="radio" aria-checked={referenceRole.value === value} aria-disabled={(referenceRole.locked && value === 'reference') || undefined} className={cn(referenceRole.value === value && 'is-active')} onClick={() => { if (referenceRole.locked && value === 'reference') { return; } referenceRole.onChange(value); }}>
                      {value === 'edit' ? 'Edit' : 'Reference'}
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
          {lorasOffered ? (
            <div className={cn('list-row-wrap', view.loraSummary && 'has-clear')}>
              <ListButton label="LoRAs" value={view.loraSummary || 'None'} end={view.loraSummary ? 'none' : 'chevron'} data-open-trigger aria-label="LoRAs" aria-haspopup="dialog" aria-expanded={Boolean(view.lorasOpen)} onClick={() => view.openLoras()} />
              {view.loraSummary ? <button type="button" className="list-row-clear" aria-label="Clear LoRAs" onClick={view.clearLoras}><X size={16} aria-hidden="true" /></button> : null}
            </div>
          ) : null}
          {!aspectLocked ? (
            <ListButton label="Size" value={sizeText} data-open-trigger aria-label={`Size: ${sizeText}`} aria-haspopup="dialog" aria-expanded={pop === 'size'} onClick={() => toggle('size')} />
          ) : <ListItem label="Size"><span className="list-row-value">Follows the image · {size.shown.width}×{size.shown.height}</span></ListItem>}
          <ListButton label="Advanced" value={advancedText} data-open-trigger aria-label="Advanced Settings" aria-haspopup="dialog" aria-expanded={pop === 'advanced'} onClick={() => toggle('advanced')} />
        </div>
        <ReferenceSlots
          scope={`${mode}:${view.model}`}
          inputs={referenceInputs || []}
          inpaint={referenceInpaint}
          role={referenceRole}
          selected={referenceAssets || []}
          onSelect={selectReferenceAsset}
          onRemove={removeReferenceAsset}
          onError={(message) => showToast(message, 'error')}
        />
      </div>
      <PromptHistorySheet
        kind={historyKind}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onPick={(text) => { if (historyKind === 'negative') setNegative(clampText(text, negativeLimit)); else setPrompt(clampText(text, promptLimit)); setHistoryOpen(false); }}
        onError={(message) => showToast(message, 'error')}
      />

      <AnimatePresence>
        {open && pop === 'model' ? <ComposerSurface key="model" title="Model" icon={<Wand2 size={16} />} trigger='[data-open-trigger][aria-label="Choose Model"][aria-expanded="true"]' className="phone-model-pop" bodyClassName="phone-model-pop-body" onClose={() => setPop('')}><PhoneModelList view={view} onPicked={() => setPop('')} /></ComposerSurface> : null}
        {open && pop === 'size' ? <ComposerSurface key="size" title="Size" icon={<Ratio size={16} />} trigger='[data-open-trigger][aria-label^="Size:"][aria-expanded="true"]' className="phone-size-pop" bodyClassName="phone-size-pop-body" onClose={() => setPop('')}><PhoneSize view={view} /></ComposerSurface> : null}
      </AnimatePresence>
      <AdvancedPopover open={open && pop === 'advanced'} onClose={() => setPop('')}><StablePhoneAdvancedControls view={view.sidebarView} /></AdvancedPopover>
    </Sheet>
  );
}
