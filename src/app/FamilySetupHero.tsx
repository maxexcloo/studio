import React, { useEffect, useRef } from 'react';
import { trackCanvasSize } from './canvasSize';
import { field, hash, heatColor } from './UpscaleHero';

/**
 * The guided model setup hero, in the same cell material as smart upscale's:
 * a layout drawn literally. Three bounding boxes sit on the flowing field the
 * way a layout prompt places things, and the widest holds the model's name in
 * pixel letters, since setting text is what MOSS-Image is known for.
 *
 * - version: the boxes breathe; a spark runs round the one being chosen.
 * - comfy (checking, offline, waiting on nodes or an update): a search beam
 *   sweeps the field and the boxes stand as ghosts.
 * - files: embers smoulder along the boxes' floors, waiting.
 * - downloading: the boxes fill with heat from the floor up, with the download.
 * - ready: a ripple of heat, then the boxes and the name cool to white.
 * - error: the heat dies back to a dull red.
 */

export type FamilySetupHeroStage = 'checking' | 'offline' | 'version' | 'comfy' | 'files' | 'downloading' | 'ready' | 'error';

// A 3×5 pixel font, only the letters a hero word needs.
const FONT: Record<string, string[]> = {
  M: ['X.X', 'XXX', 'XXX', 'X.X', 'X.X'],
  O: ['XXX', 'X.X', 'X.X', 'X.X', 'XXX'],
  S: ['XXX', 'X..', 'XXX', '..X', 'XXX'],
  I: ['XXX', '.X.', '.X.', '.X.', 'XXX'],
  A: ['.X.', 'X.X', 'XXX', 'X.X', 'X.X'],
  G: ['XXX', 'X..', 'X.X', 'X.X', 'XXX'],
  E: ['XXX', 'X..', 'XX.', 'X..', 'XXX'],
  '-': ['...', '...', 'XXX', '...', '...']
};

/** Boxes in cells, relative to the layout's centre: [x, y, w, h]; the first holds the word. */
const BOXES: Array<[number, number, number, number]> = [
  [-17, -9, 22, 9],
  [7, -9, 11, 16],
  [-17, 2, 22, 5]
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

type Cell = { x: number; y: number; box: number; edge: boolean; glyph: boolean };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; decay: number };

function layoutCells(word: string) {
  const cells: Cell[] = [];
  const outlines: Cell[][] = BOXES.map(() => []);
  BOXES.forEach(([bx, by, bw, bh], box) => {
    for (let y = by; y < by + bh; y++) {
      for (let x = bx; x < bx + bw; x++) {
        const edge = x === bx || y === by || x === bx + bw - 1 || y === by + bh - 1;
        const cell = { x, y, box, edge, glyph: false };
        cells.push(cell);
        if (edge) outlines[box].push(cell);
      }
    }
  });
  // The word, centred in the first box, letters one cell apart.
  const letters = word.toUpperCase().split('').filter((letter) => FONT[letter]).slice(0, 5);
  const [bx, by, bw, bh] = BOXES[0];
  const width = letters.length * 4 - 1;
  const left = bx + Math.floor((bw - width) / 2);
  const top = by + Math.floor((bh - 5) / 2);
  letters.forEach((letter, index) => {
    FONT[letter].forEach((row, ry) => row.split('').forEach((mark, rx) => {
      if (mark !== 'X') return;
      const cell = cells.find((item) => item.box === 0 && item.x === left + index * 4 + rx && item.y === top + ry);
      if (cell) cell.glyph = true;
    }));
  });
  // Each outline in walking order, for the spark that runs round it.
  for (const [box, list] of outlines.entries()) {
    const [x0, y0, w0, h0] = BOXES[box];
    const cx = x0 + w0 / 2, cy = y0 + h0 / 2;
    list.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  }
  return { cells, outlines };
}

export function FamilySetupHero({ stage, progress = 0, focus = 0, word = 'MOSS', className }: {
  stage: FamilySetupHeroStage;
  /** 0-1 while downloading. */
  progress?: number;
  /** Which box the spark runs round while a version is being picked. */
  focus?: number;
  word?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef(stage);
  const progressRef = useRef(progress);
  const focusRef = useRef(focus);
  const wakeRef = useRef<() => void>(() => {});
  stageRef.current = stage;
  progressRef.current = progress;
  focusRef.current = focus;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tracked = trackCanvasSize(canvas, 2, () => wakeRef.current());
    const { dpr } = tracked;
    const { cells, outlines } = layoutCells(word);
    const inLayout = new Map(cells.map((cell) => [`${cell.x},${cell.y}`, cell]));

    let w = 0, h = 0, pitch = 1, gap = 1, cols = 0, rows = 0, ox = 0, oy = 0, cx0 = 0, cy0 = 0;
    const resize = () => {
      const { width: nw, height: nh } = tracked.size;
      if (!nw || !nh) return false;
      if (nw === w && nh === h) return true;
      w = canvas.width = nw;
      h = canvas.height = nh;
      const cw = nw / dpr;
      pitch = Math.max(4, Math.round(Math.max(5, Math.min(8, cw / 70)) * dpr));
      gap = Math.max(1, Math.round(pitch * 0.2));
      cols = Math.ceil(w / pitch) + 1;
      rows = Math.ceil(h / pitch) + 1;
      ox = Math.floor((w - Math.floor(w / pitch) * pitch) / 2);
      oy = Math.floor((h - Math.floor(h / pitch) * pitch) / 2);
      cx0 = Math.floor(w / pitch / 2);
      // A little above the middle: the stepper sits over the hero's bottom.
      cy0 = Math.floor(h / pitch * 0.42);
      return true;
    };

    const sparks: Spark[] = [];
    let lastStage = stageRef.current;
    let changedAt = 0;
    let fill = 0;
    let raf = 0;
    let last = performance.now();
    const t0 = last;
    let visible = true;
    const top = Math.min(...BOXES.map(([, y]) => y));
    const bottom = Math.max(...BOXES.map(([, y, , bh]) => y + bh));

    const square = (x: number, y: number, r: number, g: number, b: number, a: number) => {
      if (a <= 0.01) return;
      ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${Math.min(1, a).toFixed(3)})`;
      ctx.fillRect(ox + x * pitch, oy + y * pitch, pitch - gap, pitch - gap);
    };

    const draw = (now: number) => {
      raf = 0;
      if (!resize()) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = reduce ? 6 : (now - t0) / 1000;
      const st = stageRef.current;
      if (st !== lastStage) { lastStage = st; changedAt = t; }
      const since = t - changedAt;
      const searching = st === 'checking' || st === 'offline' || st === 'comfy';
      const target = st === 'downloading' ? clamp01(progressRef.current) : st === 'ready' ? 1 : st === 'error' ? fill : 0;
      fill += reduce ? target - fill : (target - fill) * Math.min(1, dt * 4);
      // The fill line, in layout rows: it rises through every box at once.
      const fillRow = bottom - fill * (bottom - top);
      const cool = st === 'ready' ? clamp01((since - 0.35) / 0.9) : 0;

      ctx.clearRect(0, 0, w, h);
      const beamX = searching ? ((t * (st === 'offline' ? 0.22 : 0.34)) % 1.3 - 0.15) * cols : -99;
      const rippleR = since * (st === 'ready' ? 30 : 24);
      const rippleA = st === 'ready' ? Math.max(0, 1 - since / 1.6) : Math.max(0, 0.5 - since / 1.2);

      // The field, hushed around the layout so the boxes carry the scene.
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const lx = x - cx0, ly = y - cy0;
          if (inLayout.has(`${lx},${ly}`)) continue;
          const v = field(x, y, t);
          const near = Math.min(...BOXES.map(([bx, by, bw, bh]) => Math.hypot(Math.max(bx - lx, 0, lx - (bx + bw)), Math.max(by - ly, 0, ly - (by + bh)))));
          const hush = 0.3 + 0.7 * clamp01((near - 1) / 10);
          let a = (0.025 + 0.16 * v) * hush * (st === 'offline' ? 0.6 : 1);
          let r = 255, g = 255, b = 255;
          if (beamX > -50) a += Math.exp(-Math.pow((x - beamX) / 3.2, 2)) * 0.15;
          let heat = 0;
          if (rippleA > 0) {
            const dist = Math.hypot(lx * 0.8, ly);
            heat = Math.exp(-Math.pow((dist - rippleR) / 2.4, 2)) * rippleA * (0.6 + 0.4 * hash(x + 3, y));
          }
          if (st === 'error') { g = 200; b = 190; a *= 0.7; }
          if (heat > 0.02) {
            const [hr, hg, hb] = heatColor(heat);
            const k = Math.min(1, heat * 1.4);
            r += (hr - r) * k; g += (hg - g) * k; b += (hb - b) * k;
            a = Math.max(a, heat * 0.8);
          }
          square(x, y, r, g, b, a);
        }
      }

      // The layout: outlines, a quiet inside, the word, and the heat filling them.
      const focused = Math.max(0, Math.min(BOXES.length - 1, focusRef.current));
      const outline = outlines[focused];
      const runner = st === 'version' || searching ? (t * (searching ? 11 : 8)) % outline.length : -99;
      for (const cell of cells) {
        const x = cell.x + cx0, y = cell.y + cy0;
        const s = hash(x * 3, y * 5);
        let r = 255, g = 255, b = 255, a: number;
        const filled = (st === 'downloading' || st === 'ready' || st === 'error') && cell.y + 0.5 >= fillRow;
        if (filled) {
          const edge = Math.max(0, 1 - (cell.y - fillRow) / 1.6);
          const twinkle = reduce ? 0.8 : 0.7 + 0.3 * Math.sin(t * (2.5 + s * 3) + s * 40);
          const base = cell.glyph ? 0.85 : cell.edge ? 0.55 : 0.28;
          const heat = Math.min(1, base * twinkle + edge * 0.5);
          [r, g, b] = heatColor(st === 'error' ? heat * 0.35 : heat);
          a = st === 'error' ? 0.5 : cell.glyph ? 0.95 : cell.edge ? 0.8 : 0.32 + 0.2 * twinkle;
          if (cool > 0) {
            const white = cell.glyph || cell.edge ? 1 : 0.22;
            r += (244 - r) * cool; g += (244 - g) * cool; b += (244 - b) * cool;
            a += (white - a) * cool;
          }
        } else if (searching) {
          a = cell.glyph ? 0.16 : cell.edge ? 0.16 : 0.03;
          a *= st === 'offline' ? 0.7 : 1;
        } else if (st === 'error') {
          [r, g, b] = [255, 120, 100];
          a = cell.edge || cell.glyph ? 0.4 : 0.05;
        } else {
          const pulse = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(t * 2.1 - (cell.y + cell.box * 3) * 0.35);
          const chosen = st === 'version' && cell.box === focused;
          a = cell.glyph ? 0.5 + 0.25 * pulse : cell.edge ? (chosen ? 0.5 : 0.3) + 0.2 * pulse : 0.05 + 0.03 * pulse;
          if (st === 'files' && cell.edge && cell.y === BOXES[cell.box][1] + BOXES[cell.box][3] - 1 && s > 0.3) {
            [r, g, b] = heatColor(0.3 + 0.35 * pulse);
            a = 0.35 + 0.4 * pulse * s;
          }
        }
        if (runner > -50 && cell.box === focused && cell.edge) {
          const i = outline.indexOf(cell);
          const behind = (runner - i + outline.length) % outline.length;
          const trail = behind < 8 ? 1 - behind / 8 : 0;
          if (trail > 0.02) {
            [r, g, b] = heatColor(0.55 + trail * 0.45);
            a = Math.max(a, trail * 0.9);
          }
        }
        if (rippleA > 0 && !filled) a = Math.max(a, rippleA * 0.45);
        square(x, y, r, g, b, a);
      }

      // Sparks lift off the fill line and go out.
      if (!reduce) {
        const spawn = st === 'downloading' ? 14 : st === 'files' ? 2.5 : st === 'ready' && since < 0.8 ? 50 : 0;
        let count = Math.floor(spawn * dt) + (Math.random() < (spawn * dt) % 1 ? 1 : 0);
        while (count-- > 0) {
          const rowY = st === 'ready' ? top : st === 'files' ? bottom - 1 : Math.max(top, Math.min(bottom - 1, Math.floor(fillRow)));
          const span = cells.filter((cell) => cell.y === rowY);
          const from = span[Math.floor(Math.random() * span.length)] || { x: 0, y: 0 };
          sparks.push({
            x: cx0 + from.x + 0.5, y: cy0 + from.y,
            vx: (Math.random() - 0.5) * (st === 'ready' ? 10 : 3),
            vy: -(st === 'ready' ? 10 + Math.random() * 12 : 4 + Math.random() * 6),
            life: 1, decay: 0.6 + Math.random() * 0.9
          });
        }
        for (let i = sparks.length - 1; i >= 0; i--) {
          const p = sparks[i];
          p.x += p.vx * dt + Math.sin(t * 6 + i) * dt * 1.2;
          p.y += p.vy * dt;
          p.vy *= 0.985;
          p.life -= p.decay * dt;
          if (p.life <= 0 || p.y < -2) { sparks.splice(i, 1); continue; }
          const [r, g, b] = heatColor(0.25 + p.life * 0.75);
          square(Math.floor(p.x), Math.floor(p.y), r, g, b, p.life);
        }
      }

      if (!reduce && visible) raf = requestAnimationFrame(draw);
    };

    const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(draw); } };
    wakeRef.current = wake;
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && document.visibilityState !== 'hidden';
      if (visible) wake();
    });
    io.observe(canvas);
    wake();
    return () => { cancelAnimationFrame(raf); io.disconnect(); tracked.disconnect(); };
  }, [word]);

  useEffect(() => { wakeRef.current(); }, [stage, progress, focus]);

  return (
    <div className={className} data-stage={stage} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
