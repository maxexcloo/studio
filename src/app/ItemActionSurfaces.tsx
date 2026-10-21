import React from 'react';
import { Info, RefreshCw, Square, Star } from 'lucide-react';
import { cn } from './format';
import { Tip } from './components';
import { CopyIcon, useCopyFeedback } from './CopyFeedback';
import { downloadName, prefetchShare } from './share';
import { UpscaleArrow } from './UpscaleArrow';
import { shortLeft, upscaleLeftLine, upscaleTooltip, useUpscaleClock } from './useUpscale';
import { useItemActionHandlers, useItemActions, type ItemAction, type ItemActionExtras } from './itemActions';
import { canStar } from './favorites';
import type { GalleryItem } from './types';

/* Every surface that renders the shared item actions (itemActions.ts). */

export function ActionIcon({ action, size }: { action: ItemAction; size: number }) {
  const { Icon } = action;
  return action.id === 'star' ? <Icon size={size} fill={action.pressed ? 'currentColor' : 'none'} /> : <Icon size={size} />;
}

/** Where the intent changes along a bar: a divider goes before these. */
export function startsGroup(actions: ItemAction[], index: number) {
  return index > 0 && actions[index].group !== actions[index - 1].group;
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

/**
 * The phone viewer: Copy · Share | Animate · Recreate · Reference · Upscale |
 * Delete along the bottom (stepping aside while Details is open), Star in the top left and Info (Details) in the top
 * right beside Close. The bar is a trigger surface, so a tap on Info while
 * Details is open closes it rather than closing and reopening it.
 */
export function PhoneViewerBar({ item, showDetails, onToggleDetails, compare }: { item: GalleryItem; showDetails: boolean; onToggleDetails: () => void; compare: NonNullable<ItemActionExtras['compare']> }) {
  React.useEffect(() => { prefetchShare(item); }, [item]);
  const handlers = useItemActionHandlers();
  const all = useItemActions(item, 'bar', { compare });
  // With Details open its footer holds Copy and Recreate: the bar steps aside rather than repeat them.
  const actions = showDetails ? [] : all.filter((action) => action.id !== 'star');
  const star = handlers && canStar(item) ? { pressed: Boolean(item.favorite), run: () => handlers.star(item) } : null;
  const copy = useCopyFeedback();
  return (
    <nav className={cn('viewer-phone-bar', showDetails && 'is-details')} aria-label="Image Actions" data-open-trigger>
      {actions.map((action, index) => {
        const divider = startsGroup(actions, index) ? <i key={`${action.id}-divider`} className="viewer-phone-divider" aria-hidden="true" /> : null;
        if (action.id === 'upscale') return <React.Fragment key={action.id}>{divider}<UpscaleBarButton item={item} action={action} /></React.Fragment>;
        if (action.copy) return <React.Fragment key={action.id}>{divider}<button type="button" aria-label={action.label} onClick={() => { void copy.copyWith(action.copy!); }}><CopyIcon copied={Boolean(copy.copied)} size={19} /><span>{copy.copied ? 'Copied' : action.label}</span></button></React.Fragment>;
        const className = cn(action.danger && 'is-danger', action.id === 'compare' && action.pressed && 'is-on');
        return <React.Fragment key={action.id}>{divider}<button type="button" className={className} aria-pressed={action.id === 'compare' ? action.pressed : undefined} onClick={action.run}><ActionIcon action={action} size={19} /><span>{action.label}</span></button></React.Fragment>;
      })}
      {star ? (
        <button type="button" className={cn('viewer-phone-star', star.pressed && 'is-starred')} aria-label={star.pressed ? 'Unstar' : 'Star'} aria-pressed={star.pressed} onClick={star.run}>
          <Star size={20} fill={star.pressed ? 'currentColor' : 'none'} />
        </button>
      ) : null}
      <button type="button" className={cn('viewer-phone-info', showDetails && 'is-on')} aria-pressed={showDetails} aria-label="Info" onClick={onToggleDetails}><Info size={20} /></button>
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
    <Tip content={tip} side="top">
      <button
        className={cn('icon-button', item.upscaleActive && item.upscale?.url && 'active', running && clock.leftMs !== null && 'has-count')}
        aria-label={running ? tip : action.label}
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


export function ViewerDockActions({ item, compare, details = false }: { item: GalleryItem; compare: NonNullable<ItemActionExtras['compare']>; /** Details is open: its footer has Recreate, so the dock leaves it out. */ details?: boolean }) {
  React.useEffect(() => { prefetchShare(item); }, [item]);
  // By intent: Copy · Download | Animate · Recreate · Reference · Upscale | Star · Delete.
  const actions = useItemActions(item, 'dock', { compare }).filter((action) => !(details && action.id === 'reuse'));
  const copy = useCopyFeedback();
  return (
    <>
      {actions.map((action, index) => <React.Fragment key={action.id}>{startsGroup(actions, index) ? <span className="viewer-divider" /> : null}{(() => {
        if (action.id === 'upscale') return (
          <ViewerUpscaleButton key={action.id} item={item} action={action} />
        );
        const name = action.tip || action.label;
        const tip = dockKeys[action.id] ? `${name} (${dockKeys[action.id]})` : name;
        const className = cn('icon-button', action.id === 'star' && 'viewer-star', action.id === 'star' && action.pressed && 'is-on', action.id === 'compare' && action.pressed && 'active', action.danger && 'danger-tone');
        if (action.href) return <Tip key={action.id} content={tip} side="top"><a className={className} aria-label={action.label} href={action.href} download={downloadName(item)}><ActionIcon action={action} size={16} /></a></Tip>;
        if (action.copy) return <Tip key={action.id} content={tip} side="top"><button className={className} aria-label={action.label} onClick={() => { void copy.copyWith(action.copy!); }}><CopyIcon copied={Boolean(copy.copied)} size={16} /></button></Tip>;
        return <Tip key={action.id} content={tip} side="top"><button className={className} aria-label={action.label} aria-pressed={action.pressed} onClick={action.run}><ActionIcon action={action} size={16} /></button></Tip>;
      })()}</React.Fragment>)}
    </>
  );
}
