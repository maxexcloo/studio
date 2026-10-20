import type React from 'react';
import { Copy, FastForward, ImagePlus, Layers, TextQuote, Video, Wand2 } from 'lucide-react';
import { cn } from './format';
import { Tip } from './components';
import { CopyIcon, useCopyFeedback } from './CopyFeedback';
import { normalizeLoras } from './loras';
import type { GalleryItem } from './types';

export function ViewerReuseAction({ compact = false, onUseSettings }: {
  compact?: boolean;
  onUseSettings: () => void;
}) {
  return (
    <div className={cn('viewer-reuse', compact && 'is-compact')}>
      <Tip content="Load its model, prompts and compatible settings. You can undo this.">
        <button type="button" className="btn is-primary viewer-action-main" onClick={onUseSettings}><Wand2 size={compact ? 21 : 15} /><span>Use Settings</span></button>
      </Tip>
    </div>
  );
}

/**
 * The detail panel's actions, in name order: Animate (Extend Video for a
 * video), Copy Prompt, Use Prompt and Use Settings, two to a row, the last
 * the main move. LoRAs and Reference share a quieter row under them and only
 * show when they apply: no LoRAs, no LoRA button.
 */
export function ViewerActions({ item, onAnimate, onCopyPrompt, onUsePrompt, onUseSettings, onUseLoras, onUseAsReference }: {
  item: GalleryItem;
  /** Animates a photo or extends a video; left out when no first-frame video profile can. */
  onAnimate?: () => void;
  onCopyPrompt: () => Promise<boolean>;
  onUsePrompt: () => void;
  onUseSettings: () => void;
  onUseLoras: () => void;
  /** Left out when this output can't be a reference (not an image, locked, from another folder). */
  onUseAsReference?: () => void;
}) {
  const copy = useCopyFeedback();
  // An earlier image shown from another folder carries a prompt at most: it can be copied, not reused.
  const canUse = !(item.library && !item.prompt);
  const hasPrompt = Boolean(item.prompt);
  const loraCount = item.library ? 0 : normalizeLoras(item.settings?.loras).length;
  const hasSecondary = loraCount > 0 || Boolean(onUseAsReference);
  const animate = onAnimate ? (
    item.type === 'video'
      ? { label: 'Extend Video', Icon: FastForward, tip: 'Continue this video from its last frame' }
      : { label: 'Animate', Icon: Video, tip: 'Make a video from this image' }
  ) : null;
  const main = [
    animate && { label: animate.label, node: <Tip key="animate" content={animate.tip}><button type="button" className="btn viewer-action" onClick={onAnimate}><animate.Icon size={14} /><span className="viewer-action-label">{animate.label}</span></button></Tip> },
    hasPrompt && { label: 'Copy Prompt', node: <button key="copy" type="button" className={cn('btn viewer-action', copy.copied && 'is-copied')} onClick={() => { void copy.copyWith(onCopyPrompt); }}>{copy.copied ? <CopyIcon copied size={14} /> : <Copy size={14} />}<span className="viewer-action-label">Copy Prompt</span></button> },
    hasPrompt && canUse && { label: 'Use Prompt', node: <Tip key="prompt" content="Load its prompts into the prompt box"><button type="button" className="btn viewer-action" onClick={onUsePrompt}><TextQuote size={14} /><span className="viewer-action-label">Use Prompt</span></button></Tip> },
    canUse && { label: 'Use Settings', node: <ViewerReuseAction key="settings" onUseSettings={onUseSettings} /> },
  ].filter((entry): entry is { label: string; node: React.ReactElement } => Boolean(entry)).sort((a, b) => a.label.localeCompare(b.label));
  if (!main.length && !hasSecondary) return null;
  return (
    <div className="viewer-actions" role="group" aria-label="Reuse">
      {main.length ? <div className="viewer-action-grid">{main.map((entry) => entry.node)}</div> : null}
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
