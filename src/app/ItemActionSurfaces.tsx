import React from 'react';
import { Info, RefreshCw, Square } from 'lucide-react';
import { cn } from './format';
import { Tip } from './components';
import { CopyIcon, useCopyFeedback } from './CopyFeedback';
import { haptic, HapticTarget } from './phoneControls';
import { downloadName, prefetchShare } from './share';
import { Sheet } from './Sheet';
import { UpscaleArrow } from './UpscaleArrow';
import { UpscaleNoticePopover } from './UpscaleNotice';
import { ViewerReuseAction } from './ViewerActions';
import { shortLeft, upscaleLeftLine, upscaleTooltip, useUpscaleClock, type UpscaleNotice } from './useUpscale';
import { useItemActionHandlers, useItemActions, type ItemAction, type ItemActionExtras } from './itemActions';
import type { GalleryItem } from './types';

/* Every surface that renders the shared item actions (itemActions.ts). */

export function ActionIcon({ action, size }: { action: ItemAction; size: number }) {
  const { Icon } = action;
  return action.id === 'star' ? <Icon size={size} fill={action.pressed ? 'currentColor' : 'none'} /> : <Icon size={size} />;
}

function press(action: ItemAction) {
  if (action.haptic) haptic(action.haptic);
  action.run();
}

/* ------------------------------------------------------------ Phone sheet */

/** The sheet's upscale row; a running upscale says how long is left under its label. Its own component, so the clock re-renders it alone. */
function UpscaleSheetRow({ item, action, run }: { item: GalleryItem; action: ItemAction; run: (action: ItemAction) => void }) {
  const running = item.upscale?.status === 'running';
  const clock = useUpscaleClock(item);
  const busy = Boolean(useItemActionHandlers()?.upscaleBusy(item));
  return (
    <button type="button" className="phone-row" disabled={busy} onClick={() => run(action)}>
      {running ? <Square size={16} fill="currentColor" strokeWidth={0} /> : <UpscaleArrow size={20} />}
      <span>{action.label}{running && clock.leftMs !== null ? <small>{upscaleLeftLine(item, clock.leftMs)}</small> : null}</span>
    </button>
  );
}

function truncate(text: string, length: number) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > length ? `${clean.slice(0, length - 1)}…` : clean;
}

/** A compact action sheet keeps the picture and its actions within reach. */
export function ItemActionSheet({ item, onClose, onSelect }: { item: GalleryItem | null; onClose: () => void; onSelect?: (item: GalleryItem) => void }) {
  React.useEffect(() => { prefetchShare(item); }, [item]);
  const actions = useItemActions(item, 'sheet', { select: onSelect });
  const run = (action: ItemAction) => { onClose(); press(action); };
  return (
    <Sheet className="phone-item-actions" open={Boolean(item)} onClose={onClose} title={item?.prompt ? truncate(item.prompt, 60) : 'Image'}>
      {item ? (
        <div className="phone-group">
          {actions.map((action) => {
            if (action.id === 'upscale') return <UpscaleSheetRow key={action.id} item={item} action={action} run={run} />;
            const className = cn('phone-row', action.danger && 'is-danger', action.id === 'star' && action.pressed && 'is-starred');
            const body = <><ActionIcon action={action} size={20} /><span>{action.label}</span>{action.haptic ? <HapticTarget /> : null}</>;
            return <button key={action.id} type="button" className={className} onClick={() => run(action)}>{body}</button>;
          })}
        </div>
      ) : null}
    </Sheet>
  );
}

/* ------------------------------------------------------------ Phone viewer bar */

/** The viewer bar's upscale button: while running, its label is the time left (the stop square says what a tap does). */
function UpscaleBarButton({ item, action }: { item: GalleryItem; action: ItemAction }) {
  const running = item.upscale?.status === 'running';
  const clock = useUpscaleClock(item);
  const busy = Boolean(useItemActionHandlers()?.upscaleBusy(item));
  // The ring, as on a desktop tile: the learned time when there is one, else the step count, else a spinning arc.
  const stepRatio = item.upscale?.progress?.max ? Math.min(1, Math.max(0, item.upscale.progress.value / item.upscale.progress.max)) : 0;
  const ratio = clock.ratio ?? (clock.leftMs !== null ? 0 : stepRatio);
  const label = running
    ? clock.leftMs === null ? 'Stop' : clock.leftMs <= 1500 ? 'Almost' : shortLeft(clock.leftMs)
    : item.upscale?.url ? (item.upscaleActive ? 'Original' : 'Upscale') : 'Upscale';
  return (
    <button type="button" className={cn(item.upscaleActive && item.upscale?.url && 'is-on')} aria-label={running ? upscaleTooltip(item, clock.leftMs) : undefined} disabled={busy} onClick={action.run}>
      <i className={cn('viewer-phone-upscale', running && 'is-running', running && !ratio && 'is-indeterminate', running && clock.ratio !== null && 'is-timed')}>
        {busy ? <RefreshCw size={18} className="spin" /> : running ? <Square size={11} fill="currentColor" strokeWidth={0} /> : <UpscaleArrow size={19} />}
        {running ? (
          <svg className="viewer-phone-upscale-ring" viewBox="0 0 30 30" aria-hidden="true" focusable="false">
            <circle className="is-track" cx="15" cy="15" r="14" />
            <circle cx="15" cy="15" r="14" pathLength={100} strokeDasharray={ratio ? `${ratio * 100} 100` : '25 75'} />
          </svg>
        ) : null}
      </i>
      <span className={cn(running && clock.leftMs !== null && 'is-count')}>{label}</span>
    </button>
  );
}

/** Direct actions below the image, with Star and Details beside the close control. */
export function PhoneViewerBar({ item, showDetails, onToggleDetails, compare }: { item: GalleryItem; showDetails: boolean; onToggleDetails: () => void; compare: NonNullable<ItemActionExtras['compare']> }) {
  React.useEffect(() => { prefetchShare(item); }, [item]);
  const actions = useItemActions(item, 'bar', { compare });
  const promptCopy = useCopyFeedback();
  const star = actions.find((action) => action.id === 'star');
  return (
    <nav className="viewer-phone-bar" aria-label="Image actions">
      {actions.map((action) => {
        if (action.id === 'star') return null;
        if (action.id === 'upscale') return <UpscaleBarButton key={action.id} item={item} action={action} />;
        if (action.id === 'reuse') return <ViewerReuseAction key={action.id} compact onUseSettings={action.run} />;
        if (action.id === 'copyPrompt') return <button key={action.id} type="button" aria-label={action.label} onClick={() => { void promptCopy.copyWith(action.copy!); }}><CopyIcon copied={Boolean(promptCopy.copied)} size={21} /><span>{promptCopy.copied ? 'Copied' : action.label}</span></button>;
        const className = cn(action.danger && 'is-danger', action.id === 'compare' && action.pressed && 'is-on');
        const body = <><ActionIcon action={action} size={21} /><span>{action.short || action.label}</span>{action.haptic ? <HapticTarget /> : null}</>;
        return <button key={action.id} type="button" className={className} aria-label={action.short ? action.label : undefined} aria-pressed={action.id === 'compare' ? action.pressed : undefined} onClick={() => press(action)}>{body}</button>;
      })}
      {star ? (
        <button type="button" className={cn('viewer-phone-star', star.pressed && 'is-starred')} aria-label={star.label} aria-pressed={star.pressed} onClick={() => press(star)}>
          <ActionIcon action={star} size={21} /><HapticTarget />
        </button>
      ) : null}
      {/* Info sits beside Close at the top right, so the bar keeps room for actions. */}
      <button type="button" className={cn('viewer-phone-info', showDetails && 'is-on')} aria-pressed={showDetails} aria-label="Details" onClick={onToggleDetails}><Info size={20} /></button>
    </nav>
  );
}

/* ------------------------------------------------------------ Desktop viewer dock */

/**
 * The viewer's upscale button. Its own component, so a running upscale's
 * clock re-renders this alone each second; the tip and a small count beside
 * the icon say how long is left once the time is known.
 */
function ViewerUpscaleButton({ item, action }: { item: GalleryItem; action: ItemAction }) {
  const running = item.upscale?.status === 'running';
  const clock = useUpscaleClock(item);
  const busy = Boolean(useItemActionHandlers()?.upscaleBusy(item));
  const tip = upscaleTooltip(item, clock.leftMs);
  return (
    <Tip content={tip}>
      <button
        className={cn('icon-button', item.upscaleActive && item.upscale?.url && 'active', running && clock.leftMs !== null && 'has-count')}
        aria-label={running ? tip : 'Smart upscale'}
        aria-pressed={action.pressed}
        disabled={busy}
        onClick={action.run}
      >
        {busy ? <RefreshCw size={15} className="spin" /> : running ? <Square size={11} fill="currentColor" strokeWidth={0} /> : <UpscaleArrow size={16} />}
        {running && clock.leftMs !== null ? <span className="viewer-upscale-left" aria-hidden="true">{shortLeft(clock.leftMs)}</span> : null}
      </button>
    </Tip>
  );
}

// Keyboard shortcuts the viewer handles, named in the dock's tips.
const dockKeys: Partial<Record<ItemAction['id'], string>> = { star: 'F', delete: 'Del' };

/** The desktop viewer dock's item actions, between the zoom controls and Details. */
export function ViewerDockActions({ item, compare, upscaleNotice, onDismissUpscaleNotice }: { item: GalleryItem; compare: NonNullable<ItemActionExtras['compare']>; upscaleNotice?: UpscaleNotice; onDismissUpscaleNotice: () => void }) {
  React.useEffect(() => { prefetchShare(item); }, [item]);
  const actions = useItemActions(item, 'dock', { compare });
  const copy = useCopyFeedback();
  return (
    <>
      {actions.map((action) => {
        if (action.id === 'upscale') return (
          <span key={action.id} className="upscale-notice-anchor">
            {upscaleNotice ? <UpscaleNoticePopover notice={upscaleNotice} placement="viewer" onDismiss={onDismissUpscaleNotice} /> : null}
            <ViewerUpscaleButton item={item} action={action} />
          </span>
        );
        const name = action.tip || action.label;
        const tip = dockKeys[action.id] ? `${action.label} (${dockKeys[action.id]})` : name;
        const className = cn('icon-button', action.id === 'star' && 'viewer-star', action.id === 'star' && action.pressed && 'is-on', action.id === 'compare' && action.pressed && 'active', action.danger && 'danger-tone');
        if (action.href) return <Tip key={action.id} content={tip}><a className={className} aria-label={name} href={action.href} download={downloadName(item)}><ActionIcon action={action} size={15} /></a></Tip>;
        if (action.copy) return <Tip key={action.id} content={tip}><button className={className} aria-label={name} onClick={() => { void copy.copyWith(action.copy!); }}><CopyIcon copied={Boolean(copy.copied)} size={15} /></button></Tip>;
        return <Tip key={action.id} content={tip}><button className={className} aria-label={name} aria-pressed={action.pressed} onClick={action.run}><ActionIcon action={action} size={15} /></button></Tip>;
      })}
    </>
  );
}
