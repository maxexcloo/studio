import { useEffect, useRef, useState } from 'react';
import { AnimatedNumber } from './AnimatedNumber';
import { ARROW, heatColor } from './UpscaleHero';
import { cn } from './format';
import { formatBytes } from './useUpscale';
import type { UpscaleSetup } from './useUpscale';
import type { UpscaleInstall } from './types';
import { SafeImg } from './SafeImg';
import type { Activity } from './Activities';
import { toast } from './toast';
import { useCellGap } from './cells';

/**
 * While the SeedVR2 weights download with the setup dialog closed, an
 * activity floats at the top: the setup hero's arrow in miniature, filling
 * with heat, over the shared progress bar and the numbers. The arrow is shared by the other
 * download and update activities.
 */

export type Mode = 'downloading' | 'verifying' | 'ready' | 'error';

const READY_HOLD_MS = 4200;
const CELLS = ARROW.flatMap((row, y) => [...row].map((bit, x) => (bit === 'X' ? { x, y } : null)).filter(Boolean)) as Array<{ x: number; y: number }>;
const isEdge = (x: number, y: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => ARROW[y + dy]?.[x + dx] !== 'X');
const rows = ARROW.length;
// A fixed scatter so twinkles and sparks never line up.
const jitter = (x: number, y: number) => ((x * 73 + y * 151) % 97) / 97;

/** The setup hero's arrow, drawn as SVG cells: dim until the fill line reaches them, ember below it, white-hot at it. */
export function MiniArrow({ mode, progress }: { mode: Mode; progress: number }) {
  const gap = useCellGap(0.1);
  const filled = mode === 'downloading' ? Math.round(progress * rows) : rows;
  const front = rows - filled;
  const bottomRow = ARROW[rows - 1];
  const sparkXs = [...bottomRow].map((bit, x) => (bit === 'X' ? x : -1)).filter((x) => x >= 0);
  return (
    <svg className={cn('udw-arrow', `is-${mode}`)} viewBox="-1 -5 17 21" aria-hidden="true">
      {CELLS.map(({ x, y }) => {
        const hot = y >= front;
        let fill = `rgb(255 255 255 / ${isEdge(x, y) ? 0.32 : 0.1})`;
        if (mode === 'error') fill = isEdge(x, y) ? 'rgb(255 120 100 / .75)' : 'rgb(255 120 100 / .14)';
        else if (mode === 'ready' || mode === 'verifying') fill = '#f4f4f4';
        else if (hot) {
          const heat = y === front ? 1 : Math.max(0.2, 0.78 - ((y - front) / rows) * 0.9);
          const [r, g, b] = heatColor(heat);
          fill = `rgb(${r | 0} ${g | 0} ${b | 0})`;
        }
        const twinkle = mode === 'downloading' && hot && y !== front;
        return (
          <rect
            key={`${x}-${y}`}
            className={cn(twinkle && 'udw-twinkle', mode === 'verifying' && 'udw-scan')}
            x={x + gap}
            y={y + gap}
            width={1 - gap * 2}
            height={1 - gap * 2}
            fill={fill}
            style={{ animationDelay: mode === 'verifying' ? `${(rows - y) * 45}ms` : `${-jitter(x, y) * 2.4}s` }}
          />
        );
      })}
      {mode === 'downloading' && filled > 0
        ? sparkXs.filter((_, i) => i % 2 === 0).map((x, i) => (
          <rect
            key={`spark-${x}`}
            className="udw-spark"
            x={x + 0.25}
            y={Math.max(0, front) - 0.6}
            width={0.5}
            height={0.5}
            fill="#ffd9b0"
            style={{ animationDelay: `${-(i * 0.37 + jitter(x, i) * 0.9)}s` }}
          />
        ))
        : null}
    </svg>
  );
}

export function formatEta(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return 'under a minute left';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min left`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
}

/**
 * The download as an activity: shown while it runs with setup closed. Once it
 * lands it becomes the "ready" note (with the image it went on to upscale) and
 * leaves by itself. A failed download says why in the status pill with Set
 * Up (UI-PATTERNS › Messages), unless setup is open and says so itself.
 * Clicking it reopens setup, which takes over while open.
 */
export function useUpscaleDownloadActivity(setup: UpscaleSetup, install: UpscaleInstall): Activity | null {
  const { stage, open } = setup;
  // The image it went on to upscale once ready: its thumbnail, 'pending' without one, '' when none waited.
  const [finished, setFinished] = useState<string | null>(null);
  const toldError = useRef('');
  // setup clears the waiting image the moment it starts the upscale, so keep a copy for the ready note.
  const lastPending = useRef<string>('');
  if (setup.pending) lastPending.current = setup.pending.thumbnailUrl || setup.pending.url || 'pending';
  const previous = useRef(stage);
  useEffect(() => {
    const was = previous.current;
    previous.current = stage;
    if ((was === 'downloading' || was === 'verifying') && stage === 'ready' && !open) {
      setFinished(lastPending.current || '');
      lastPending.current = '';
    }
  }, [stage, open]);
  useEffect(() => { if (open) setFinished(null); }, [open]);

  const errorKey = install?.status === 'error' ? `${install.error || 'The download stopped'}` : '';
  const openSetup = useRef(setup.openSetup);
  openSetup.current = setup.openSetup;
  useEffect(() => {
    if (!errorKey) { toldError.current = ''; return; }
    if (open || stage !== 'error' || toldError.current === errorKey) return;
    toldError.current = errorKey;
    toast.error(`Couldn’t download SeedVR2. ${errorKey.replace(/\.$/, '')}`, { group: 'upscale-download-failed', action: { label: 'Set Up', onClick: () => openSetup.current() } });
  }, [errorKey, open, stage]);
  const mode: Mode | null = open ? null
    : stage === 'downloading' ? 'downloading'
    : stage === 'verifying' ? 'verifying'
    : finished !== null ? 'ready'
    : null;
  if (!mode) return null;

  const received = install?.receivedBytes || 0;
  const total = install?.totalBytes || 0;
  const progress = total ? Math.min(1, received / total) : 0;
  const speed = install?.bytesPerSecond || 0;
  const eta = speed > 0 ? (total - received) / speed : 0;
  const readyThumb = finished && finished !== 'pending' ? finished : '';
  const waitingThumb = mode !== 'ready' ? setup.pending?.thumbnailUrl : '';
  const dismiss = () => setFinished(null);

  const title = mode === 'downloading' ? 'Downloading SeedVR2'
    : mode === 'verifying' ? 'Checking the download'
    : 'Upscale is ready';
  return {
    id: 'upscale-download',
    phase: mode,
    state: mode === 'ready' ? 'done' : 'live',
    glyph: <MiniArrow mode={mode} progress={progress} />,
    title,
    figure: mode === 'downloading' ? <><AnimatedNumber value={Math.floor(progress * 100)} />%</> : undefined,
    progress: mode === 'downloading' ? progress : undefined,
    meta: mode === 'downloading'
      ? [received ? `${formatBytes(received)} of ${formatBytes(total)}` : total ? formatBytes(total) : '', speed > 0 ? `${formatBytes(speed)}/s` : 'connecting', formatEta(eta)].filter(Boolean).join(' · ')
      : mode === 'verifying' ? 'Almost ready'
      : finished ? 'Upscaling the image' : 'Use the upscale arrow on any image',
    aside: waitingThumb ? <SafeImg className="activity-thumb is-waiting" src={waitingThumb} draggable={false} title="Upscales When the Download Is Done" />
      : readyThumb ? <SafeImg className="activity-thumb" src={readyThumb} draggable={false} />
      : null,
    open: { label: `${title}. Open upscale setup`, run: () => setup.openSetup() },
    dismiss: mode === 'ready' ? { label: 'Dismiss', run: dismiss } : undefined,
    expire: mode === 'ready' ? { after: READY_HOLD_MS, run: () => setFinished(null) } : undefined
  };
}
