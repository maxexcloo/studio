import React, { useEffect, useState } from 'react';
import { AnimatedNumber } from './AnimatedNumber';
import { formatLeft, progressLine, progressReading, useRunClock } from './GenerationProgress';
import { cn, titleFromPrompt } from './format';
import { SafeImg } from './SafeImg';
import type { Activity } from './Activities';
import type { GalleryItem } from './types';
import { useCellGap } from './cells';

/**
 * A generation you can't see, as an activity. While the viewer is on another
 * image or the gallery is scrolled away from the rendering tiles, it floats at the top: the live preview, how far it is and
 * how long is left. Clicking it brings the work into view; the × puts it away
 * until the next run.
 *
 * Finished runs say nothing: the tile lands in the gallery. Failures keep their
 * own toast, which offers See why.
 */


export function useGenerationActivity({ items, enabled, watching, reveal, onJump }: {
  /** The gallery as shown: its pending items are the work, its finished ones the results. */
  items: GalleryItem[];
  /** Off on the phone (it has its own activity chip). */
  enabled: boolean;
  /** The rendering work is on screen already, so there is nothing to stand in for. */
  watching: boolean;
  /** Whether this item's pictures and prompt may show here. */
  reveal: (item: GalleryItem) => boolean;
  onJump: (item: GalleryItem) => void;
}): Activity | null {
  const pending = items.filter((item) => item.status === 'pending');
  // The one ComfyUI is working on; the rest wait behind it.
  const current = pending.find((item) => item.progress?.runStartedAt || (item.progress?.max || 0) > 0) || pending[pending.length - 1] || null;
  const reading = progressReading(current?.progress);
  const clock = useRunClock(current?.progress);
  const [putAway, setPutAway] = useState<Set<string>>(() => new Set());

  const jobsOf = (list: GalleryItem[]) => [...new Set(list.map((item) => item.jobId || item.id))];
  const pendingJobs = jobsOf(pending);
  const standingIn = enabled && !watching && pendingJobs.some((job) => !putAway.has(job));
  const pendingKey = pendingJobs.join('|');

  // A new run starts clean: nothing put away.
  useEffect(() => {
    if (!pendingJobs.length) return;
    setPutAway((current) => {
      const kept = new Set([...current].filter((job) => pendingJobs.includes(job)));
      return kept.size === current.size ? current : kept;
    });
  }, [pendingKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (standingIn && current) {
    const ratio = clock.ratio ?? (reading.kind === 'steps' ? reading.ratio : null);
    const kind = current.type === 'video' ? 'video' : 'image';
    const waiting = reading.kind === 'queued';
    const step = progressLine(current.progress);
    const left = clock.leftMs !== null ? formatLeft(clock.leftMs) : '';
    const prompt = reveal(current) && !current.promptProtected ? titleFromPrompt(current.prompt || '') : '';
    return {
      id: 'generation',
      phase: waiting ? 'queued' : 'running',
      state: 'live',
      glyph: <WorkFrame src={reveal(current) ? current.preview : ''} working={!waiting} />,
      title: waiting ? 'Waiting for ComfyUI' : pending.length > 1 ? <>Generating <AnimatedNumber value={pending.length} /> {kind}s</> : `Generating ${kind === 'video' ? 'a video' : 'an image'}`,
      figure: ratio !== null ? <><AnimatedNumber value={Math.floor(ratio * 100)} />%</> : undefined,
      progress: waiting ? undefined : ratio ?? 0,
      meta: [step, left].filter(Boolean).join(' · ') || prompt || 'Starting',
      metaTitle: prompt || undefined,
      open: { label: 'Show the Generation', run: () => onJump(current) },
      dismiss: {
        label: 'Hide Until the Next Run',
        title: 'Hide Until the Next Run',
        run: () => setPutAway((current) => new Set([...current, ...pendingJobs]))
      }
    };
  }

  return null;
}

/** The live preview in a small frame, with heat passing over it while ComfyUI works. */
function WorkFrame({ src, working }: { src?: string; working: boolean }) {
  return (
    <span className={cn('activity-frame', working && 'is-working')} aria-hidden="true">
      <SafeImg src={src} draggable={false} fallback={<HeatCells />} />
    </span>
  );
}

/** Before the first preview: a few cells warming up, the same cells as the download arrows. */
function HeatCells() {
  const gap = useCellGap(0.1);
  const cells = Array.from({ length: 16 }, (_, index) => ({ x: index % 4, y: Math.floor(index / 4) }));
  return (
    <svg className="activity-heat" viewBox="-0.5 -0.5 5 5">
      {cells.map(({ x, y }) => (
        <rect key={`${x}-${y}`} x={x + gap} y={y + gap} width={1 - gap * 2} height={1 - gap * 2} rx={gap * 1.4} style={{ animationDelay: `${-(((x * 7 + y * 13) % 11) / 11) * 1.8}s` }} />
      ))}
    </svg>
  );
}

/**
 * Whether any of these gallery tiles is on screen in `root`, the gallery's
 * scroller. The gallery is virtual, so a tile scrolled far away is simply not
 * in the page. Checked on scroll, resize and whenever tiles come and go.
 */
export function useTilesOnScreen(rootRef: React.RefObject<HTMLElement | null>, ids: string[]) {
  const [onScreen, setOnScreen] = useState(true);
  const key = ids.join('|');
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !ids.length) { setOnScreen(true); return; }
    let frame = 0;
    const check = () => {
      frame = 0;
      const view = root.getBoundingClientRect();
      setOnScreen(ids.some((id) => {
        const tile = root.querySelector(`[data-tile-id="${CSS.escape(id)}"]`);
        if (!tile) return false;
        const box = tile.getBoundingClientRect();
        return box.width > 0 && box.bottom > view.top + 24 && box.top < view.bottom - 24;
      }));
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(check); };
    check();
    root.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const mutations = new MutationObserver(schedule);
    mutations.observe(root, { childList: true, subtree: true });
    return () => {
      window.cancelAnimationFrame(frame);
      root.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      mutations.disconnect();
    };
  }, [rootRef, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return onScreen;
}
