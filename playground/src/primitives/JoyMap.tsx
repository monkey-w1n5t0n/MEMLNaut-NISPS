import { Component, createEffect, onCleanup, onMount } from 'solid-js';
import styles from './JoyMap.module.css';

export interface TrailPoint {
  x: number;
  y: number;
  /** Time in ms since some epoch (e.g. performance.now()). */
  t: number;
}

export interface RegionPin {
  id: string;
  x: number;        // [0,1]
  y: number;        // [0,1]
  width: number;    // [0,1]
  height: number;   // [0,1]
  /** 0..4 mapping to --pin-1..--pin-5 tokens. */
  colorSlot: number;
}

export interface JoyMapProps {
  /** Current zoom level (0.01–1). 0.01 = frozen. */
  zoom: () => number;
  /** Anchor point for the zoom window (in [0,1]^2). */
  anchor: () => readonly [number, number];
  /** Live cursor position in [0,1]^2 (raw, not zoomed). */
  position: () => readonly [number, number];
  /** Recent trail points. */
  trail: () => ReadonlyArray<TrailPoint>;
  /** Active region pins. */
  regionPins?: () => ReadonlyArray<RegionPin>;
  /** Outer + inner ring radii [0..1] for noise visualization. */
  noiseRings?: () => readonly [number, number] | null;
  /** Called when user taps within the trail tap-hit radius of a trail point. */
  onTrailTap?: (p: { x: number; y: number; t: number }) => void;
  /** Called on long-press (for region pinning). */
  onLongPress?: () => void;
  /** Pixel size; canvas is square. */
  size?: number;
  /** Frozen overlay. */
  frozen?: () => boolean;
  ariaLabel?: string;
}

const TAP_HIT_RADIUS_PX = 12;
const TRAIL_DURATION_MS = 5000;
const TRAIL_MIN_WIDTH = 1.5;
const TRAIL_MAX_WIDTH = 4;
const LONG_PRESS_MS = 600;

const PIN_COLORS = [
  'rgba(255, 106, 0, 0.25)',
  'rgba(0, 204, 255, 0.25)',
  'rgba(180, 100, 255, 0.25)',
  'rgba(80, 200, 120, 0.25)',
  'rgba(255, 200, 80, 0.25)',
];
const PIN_BORDERS = [
  'rgba(255, 106, 0, 0.7)',
  'rgba(0, 204, 255, 0.7)',
  'rgba(180, 100, 255, 0.7)',
  'rgba(80, 200, 120, 0.7)',
  'rgba(255, 200, 80, 0.7)',
];

/** Centripetal Catmull-Rom spline segment. */
function drawCatmullRom(
  ctx: CanvasRenderingContext2D,
  pts: ReadonlyArray<{ x: number; y: number }>,
): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    // 8-step segment subdivision
    for (let s = 1; s <= 8; s++) {
      const t = s / 8;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

export const JoyMap: Component<JoyMapProps> = (props) => {
  let canvasEl: HTMLCanvasElement | undefined;
  let frame = 0;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;

  const size = () => props.size ?? 200;

  const drawAdaptiveGrid = (ctx: CanvasRenderingContext2D, dim: number, zoom: number, anchor: readonly [number, number]) => {
    // Adaptive subdivision: more lines as zoom decreases
    const subdivisions = zoom <= 0.1 ? 16 : zoom <= 0.3 ? 8 : zoom <= 0.6 ? 4 : 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let i = 1; i < subdivisions; i++) {
      const p = (i / subdivisions) * dim;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, dim);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(dim, p);
      ctx.stroke();
    }
    // Center crosshair
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(0, dim / 2);
    ctx.lineTo(dim, dim / 2);
    ctx.moveTo(dim / 2, 0);
    ctx.lineTo(dim / 2, dim);
    ctx.stroke();

    // Zoom window
    const wx = anchor[0] - zoom * 0.5;
    const wy = anchor[1] - zoom * 0.5;
    ctx.strokeStyle = 'rgba(255, 106, 0, 0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(wx * dim, (1 - wy - zoom) * dim, zoom * dim, zoom * dim);
  };

  const draw = () => {
    if (!canvasEl) return;
    const dpr = window.devicePixelRatio || 1;
    const dim = size() * dpr;
    if (canvasEl.width !== dim || canvasEl.height !== dim) {
      canvasEl.width = dim;
      canvasEl.height = dim;
    }
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, dim, dim);

    const zoom = Math.max(0.01, Math.min(1, props.zoom()));
    const anchor = props.anchor();
    const pos = props.position();
    const trail = props.trail();
    const pins = props.regionPins?.() ?? [];

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, dim, dim);

    // Adaptive grid + zoom window
    drawAdaptiveGrid(ctx, dim, zoom, anchor);

    // Region pins
    for (const pin of pins) {
      const px = pin.x * dim;
      const py = (1 - pin.y - pin.height) * dim;
      const pw = pin.width * dim;
      const ph = pin.height * dim;
      const color = PIN_COLORS[pin.colorSlot % PIN_COLORS.length]!;
      const border = PIN_BORDERS[pin.colorSlot % PIN_BORDERS.length]!;
      ctx.fillStyle = color;
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = border;
      ctx.lineWidth = 2 * dpr;
      ctx.strokeRect(px, py, pw, ph);
    }

    // Trail (vanishing, Catmull-Rom)
    if (trail.length >= 2) {
      const now = performance.now();
      const trailWidth = TRAIL_MIN_WIDTH + (TRAIL_MAX_WIDTH - TRAIL_MIN_WIDTH) * (1 - zoom);
      const points = trail
        .filter((p) => now - p.t <= TRAIL_DURATION_MS)
        .map((p) => ({ x: p.x * dim, y: (1 - p.y) * dim }));
      if (points.length >= 2) {
        ctx.lineWidth = trailWidth * dpr;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(255, 106, 0, 0.55)';
        drawCatmullRom(ctx, points);
      }
      // Trail point dots (tap targets)
      for (const p of trail) {
        const age = now - p.t;
        if (age > TRAIL_DURATION_MS) continue;
        const fade = 1 - age / TRAIL_DURATION_MS;
        ctx.fillStyle = `rgba(255, 106, 0, ${fade * 0.6})`;
        const x = p.x * dim;
        const y = (1 - p.y) * dim;
        ctx.beginPath();
        ctx.arc(x, y, 2 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Cursor
    const cx = pos[0] * dim;
    const cy = (1 - pos[1]) * dim;
    ctx.fillStyle = '#00ccff';
    ctx.beginPath();
    ctx.arc(cx, cy, 4 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 204, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 9 * dpr, 0, Math.PI * 2);
    ctx.stroke();

    // Noise rings
    const rings = props.noiseRings?.();
    if (rings) {
      const [outer, inner] = rings;
      ctx.strokeStyle = 'rgba(255, 200, 80, 0.4)';
      ctx.beginPath();
      ctx.arc(cx, cy, outer * dim, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 200, 80, 0.6)';
      ctx.beginPath();
      ctx.arc(cx, cy, inner * dim, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Frozen overlay
    if (props.frozen?.()) {
      ctx.fillStyle = 'rgba(100, 180, 255, 0.15)';
      ctx.fillRect(0, 0, dim, dim);
      ctx.fillStyle = 'rgba(100, 180, 255, 0.85)';
      ctx.font = `${12 * dpr}px var(--font-mono)`;
      ctx.textAlign = 'center';
      ctx.fillText('FROZEN', dim / 2, dim - 12 * dpr);
    }
  };

  const animate = () => {
    draw();
    frame = requestAnimationFrame(animate);
  };

  onMount(() => {
    frame = requestAnimationFrame(animate);
  });
  onCleanup(() => {
    if (frame) cancelAnimationFrame(frame);
    if (pressTimer) clearTimeout(pressTimer);
  });

  // Re-draw whenever props change (covers cases where rAF is throttled)
  createEffect(() => {
    props.zoom();
    props.position();
    props.trail();
    draw();
  });

  const onPointerDown = (e: PointerEvent) => {
    if (props.onLongPress) {
      pressTimer = setTimeout(() => {
        props.onLongPress?.();
        pressTimer = null;
      }, LONG_PRESS_MS);
    }
    // Tap-to-return: check trail
    if (canvasEl && props.onTrailTap) {
      const rect = canvasEl.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const trail = props.trail();
      for (const p of trail) {
        const tx = p.x * rect.width;
        const ty = (1 - p.y) * rect.height;
        const dx = tx - px;
        const dy = ty - py;
        if (dx * dx + dy * dy <= TAP_HIT_RADIUS_PX * TAP_HIT_RADIUS_PX) {
          props.onTrailTap({ x: p.x, y: p.y, t: p.t });
          if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
          }
          return;
        }
      }
    }
  };

  const onPointerUp = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  return (
    <canvas
      ref={canvasEl}
      class={styles.canvas}
      style={{ width: `${size()}px`, height: `${size()}px` }}
      role="img"
      aria-label={props.ariaLabel ?? 'Joy map'}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
};
