import { ChevronDown, ImagePlus, Layers, Wand2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Tip } from './components';
import { normalizeLoras } from './loras';
import { useDismiss } from './useDismiss';
import type { GalleryItem } from './types';

export function ViewerReuseAction({ compact = false, onUseSettings, onUsePrompts }: {
  compact?: boolean;
  onUseSettings: () => void;
  onUsePrompts: () => void;
}) {
  const [reuseOpen, setReuseOpen] = useState(false);
  const reuseRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const dismiss = () => { setReuseOpen(false); triggerRef.current?.focus(); };
  useDismiss(reuseRef, reuseOpen, dismiss);
  return (
    <div className={cn('viewer-reuse-split', compact && 'is-compact')} ref={reuseRef}>
      <Tip content="Load its model, prompts and compatible settings. You can undo this.">
        <button type="button" className="btn is-primary viewer-action-main" onClick={onUseSettings}><Wand2 size={compact ? 21 : 15} /><span>Use This Model</span></button>
      </Tip>
      <button ref={triggerRef} type="button" className="btn is-primary viewer-reuse-more" aria-label="Reuse Options" aria-controls={menuId} aria-expanded={reuseOpen} aria-haspopup="menu" onClick={() => setReuseOpen(!reuseOpen)} onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault(); setReuseOpen(true);
        requestAnimationFrame(() => reuseRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
      }}><ChevronDown size={16} /></button>
      {reuseOpen ? <div className="viewer-reuse-menu" role="menu" id={menuId} aria-label="Reuse Options" onKeyDown={(event) => {
        if (event.key === 'Tab') setReuseOpen(false);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); reuseRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus(); }
      }}><button type="button" role="menuitem" onClick={() => { dismiss(); onUsePrompts(); }}>Prompts Only</button></div> : null}
    </div>
  );
}

/**
 * The detail panel's actions. One clear move, loading the whole recipe back
 * into the composer, gets the full-width button; the smaller ones share a row
 * under it and only show when they apply: no LoRAs, no LoRA button.
 *
 * Short visible labels keep three to a row in the 380px panel; the hidden
 * words give each button its full name ("Use as reference") for a screen reader.
 */
export function ViewerActions({ item, copied, onUseSettings, onUsePrompts, onCopySettings, onUseLoras, onUseAsReference }: {
  item: GalleryItem;
  onUseSettings: () => void;
  onUsePrompts: () => void;
  onCopySettings: () => void;
  onUseLoras: () => void;
  /** Left out when this output can't be a reference (not an image, locked, from another folder). */
  onUseAsReference?: () => void;
}) {
  // An earlier image shown from another folder carries a prompt at most: Copy prompt above covers it.
  const canUse = !(item.library && !item.prompt);
  const loraCount = item.library ? 0 : normalizeLoras(item.settings?.loras).length;
  const hasSecondary = loraCount > 0 || Boolean(onUseAsReference);
  if (!canUse && !hasSecondary) return null;
  return (
    <div className="viewer-actions">
      {canUse ? (
        <ViewerReuseAction onUseSettings={onUseSettings} onUsePrompts={onUsePrompts} />
      ) : null}
      {hasSecondary ? (
        <div className="viewer-action-row">
          {loraCount > 0 ? (
            <Tip content={`Load its ${loraCount === 1 ? 'LoRA' : `${loraCount} LoRAs`} into the composer`}>
              <button type="button" className="btn viewer-action" onClick={onUseLoras}>
                <Layers size={14} />
                <span className="viewer-action-label"><span className="sr-only">Use its </span>{loraCount === 1 ? 'LoRA' : 'LoRAs'}</span>
                {loraCount > 1 ? <span className="viewer-action-count" aria-hidden="true">{loraCount}</span> : null}
              </button>
            </Tip>
          ) : null}
          {onUseAsReference ? (
            <Tip content="Use as the reference image for the next run">
              <button type="button" className="btn viewer-action" onClick={onUseAsReference}>
                <ImagePlus size={14} />
                <span className="viewer-action-label"><span className="sr-only">Use as </span>Reference</span>
              </button>
            </Tip>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
