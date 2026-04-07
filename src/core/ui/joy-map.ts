/**
 * JoyMap — Canvas rendering class for the joy-map minimap.
 *
 * Ported from playground/js/ui/joy-map-enhanced.js.
 *
 * Features:
 *   - Zoom minimap with adaptive multi-level grid (4x4 → 32x32, fades with zoom)
 *   - Vanishing trail with Catmull-Rom spline interpolation + per-segment width/alpha
 *   - Dual concentric noise rings: inner=zoom window, outer=RL noise magnitude
 *   - Tap-to-return: tapping a trail point fires onTrailTap({x, y})
 *   - Frozen state overlay (blue tint + snowflake icon)
 *   - HiDPI-aware (auto-resizes on devicePixelRatio / CSS size change)
 *
 * Usage:
 *   const joyMap = new JoyMap(canvas, { onTrailTap: ({ x, y }) => ... });
 *   // per-frame:
 *   joyMap.addTrailPoint(joyX, joyY, zoomLevel);
 *   joyMap.draw({ joyX, joyY, noiseLevel, outputMode, frozen });
 *   // cleanup:
 *   joyMap.destroy();
 */

// ─── Catmull-Rom spline ───────────────────────────────────────────────────────

interface Point2D { x: number; y: number }

function catmullRomPoint(
  p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D, t: number
): Point2D {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (
      (2 * p1.x) +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
    ),
    y: 0.5 * (
      (2 * p1.y) +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    ),
  };
}

// ─── Ring buffer ─────────────────────────────────────────────────────────────

class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  count = 0;

  constructor(readonly capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  forEach(fn: (item: T, index: number, count: number) => void): void {
    if (this.count === 0) return;
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      fn(this.buffer[idx]!, i, this.count);
    }
  }

  get(i: number): T | null {
    if (i < 0 || i >= this.count) return null;
    const start = (this.head - this.count + this.capacity) % this.capacity;
    return this.buffer[(start + i) % this.capacity] ?? null;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrailPoint {
  x: number;
  y: number;
  z: number;   // zoomLevel at capture time
  t: number;   // performance.now() timestamp
}

export interface ZoomWindow {
  cx: number;
  cy: number;
  r: number;
}

export interface PinnedRegion {
  x1: number; y1: number;
  x2: number; y2: number;
  color?: string;
}

export interface TrainingData {
  features: number[][];
  labels: (number[] | null)[];
}

export interface JoyMapDrawState {
  joyX?: number;
  joyY?: number;
  /** Pipeline-processed effective position (optional) */
  effectiveX?: number;
  effectiveY?: number;
  /** Zoom window to highlight. If omitted, synthesized from zoomLevel. */
  zoomWindow?: ZoomWindow | null;
  /** Zoom level [0,1]. Default 1.0 (no zoom). */
  zoomLevel?: number;
  /** RL noise level [0,1] for outer ring. Default 0. */
  noiseLevel?: number;
  /** Output mode — controls trail colour. Default 'visual'. */
  outputMode?: string;
  /** Whether the output pipeline freeze gate is active. */
  frozen?: boolean;
}

export interface JoyMapOptions {
  /** Called when the user taps a trail point — receives {x,y} in [0,1] space. */
  onTrailTap?: (pt: { x: number; y: number }) => void;
  /** Returns training examples to plot as dots. */
  getTrainingData?: () => TrainingData | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TRAIL_COLORS: Record<string, string> = {
  visual: '#ff6432',
  synth: '#00d4aa',
  'midi-cc': '#c06aff',
  'audio-canvas': '#32c8ff',
};
const DEFAULT_TRAIL_COLOR = '#ff6432';

const FROZEN_COLOR       = 'rgba(100, 180, 255, 0.15)';
const ZOOM_WINDOW_FILL   = 'rgba(255, 200, 100, 0.06)';
const ZOOM_WINDOW_BORDER = 'rgba(255, 200, 100, 0.6)';
const DIM_OVERLAY        = 'rgba(0, 0, 0, 0.35)';
const CURSOR_GLOW        = 'rgba(255, 255, 255, 0.35)';

const DEFAULT_TRAIL_DURATION_MS = 5000;
const MAX_TRAIL_POINTS  = 300;
const TRAIL_MIN_WIDTH   = 1.5;
const TRAIL_MAX_WIDTH   = 4;
const CURSOR_RADIUS     = 6;
const TAP_HIT_RADIUS    = 12;
const SPLINE_SEGMENTS   = 4;

// ─── Main class ───────────────────────────────────────────────────────────────

export class JoyMap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private trail: RingBuffer<TrailPoint>;
  trailDuration = DEFAULT_TRAIL_DURATION_MS;
  trailColor    = DEFAULT_TRAIL_COLOR;

  private pinnedRegions: PinnedRegion[] = [];
  private _heatmap: { enabled: boolean; draw: (ctx: CanvasRenderingContext2D, w: number, h: number, zw: ZoomWindow) => void } | null = null;
  private getTrainingData: (() => TrainingData | null) | null;

  private _flashPoint: { x: number; y: number } | null = null;
  private _flashTime = 0;
  private _pulsePhase = 0;

  // HiDPI cache
  private _dpr = 1;
  private _cssW = 0;
  private _cssH = 0;

  private _onPointerDown: (e: PointerEvent) => void;
  private _onTouchStart: (e: TouchEvent) => void;
  private onTrailTap: ((pt: { x: number; y: number }) => void) | null;

  constructor(canvas: HTMLCanvasElement, options: JoyMapOptions = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.onTrailTap = options.onTrailTap ?? null;
    this.getTrainingData = options.getTrainingData ?? null;

    this.trail = new RingBuffer<TrailPoint>(MAX_TRAIL_POINTS);

    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onTouchStart  = this._handleTouchStart.bind(this);

    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /** Main draw call. Invoke once per rAF frame. */
  draw(state: JoyMapDrawState): void {
    const {
      joyX = 0.5,
      joyY = 0.5,
      effectiveX,
      effectiveY,
      zoomWindow = null,
      zoomLevel  = 1.0,
      noiseLevel = 0,
      outputMode = 'visual',
      frozen = false,
    } = state;

    this._ensureHiDPI();

    const ctx = this.ctx;
    const w   = this._cssW;
    const h   = this._cssH;
    const dpr = this._dpr;

    ctx.save();
    ctx.scale(dpr, dpr);

    const cx = w / 2;
    const cy = h / 2;
    const r  = w / 2 - 1;

    // Clip to circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // Background
    ctx.fillStyle = 'rgba(13, 13, 13, 0.85)';
    ctx.fillRect(0, 0, w, h);

    const zw = this._normalizeZoomWindow(zoomWindow, zoomLevel);

    // Heatmap background layer
    if (this._heatmap?.enabled) {
      this._heatmap.draw(ctx, w, h, zw);
    }

    this._drawDimOverlay(ctx, w, h, zw);
    this._drawGrid(ctx, w, h, zw);
    this._drawZoomWindowBorder(ctx, w, h, zw);
    this._drawPinnedRegions(ctx, w, h);
    this._drawTrainingExamples(ctx, w, h);
    this._drawTrail(ctx, w, h, outputMode);
    this._drawNoiseRings(ctx, cx, cy, r, zoomLevel, noiseLevel);
    this._drawCursor(ctx, w, h, joyX, joyY, effectiveX, effectiveY, frozen);
    this._drawFlash(ctx, w, h);

    if (frozen) {
      this._drawFrozenOverlay(ctx, w, h, cx, cy, r);
    }

    // Circle border (outermost)
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();

    this._pulsePhase += 0.04;
  }

  /**
   * Record a trail point. Call each frame when joystick moves (or at some
   * minimum interval). Deduplication is handled internally.
   */
  addTrailPoint(x: number, y: number, zoomLevel = 1.0): void {
    const now = performance.now();
    if (this.trail.count > 0) {
      const last = this.trail.get(this.trail.count - 1)!;
      const dx = x - last.x;
      const dy = y - last.y;
      if (dx * dx + dy * dy < 0.0001 && now - last.t < 50) return;
    }
    this.trail.push({ x, y, z: zoomLevel, t: now });
  }

  /**
   * Hit-test a tap against the trail. Returns {x,y} if hit, null otherwise.
   * Fires onTrailTap callback automatically.
   */
  handleTap(canvasX: number, canvasY: number): { x: number; y: number } | null {
    const now = performance.now();
    const w = this._cssW;
    const h = this._cssH;
    const hitR2 = TAP_HIT_RADIUS * TAP_HIT_RADIUS;
    let bestDist = hitR2;
    let bestPoint: TrailPoint | null = null;

    this.trail.forEach((pt) => {
      const age = now - pt.t;
      if (age > this.trailDuration) return;
      const px = pt.x * w;
      const py = (1 - pt.y) * h;
      const dx = canvasX - px;
      const dy = canvasY - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        bestPoint = pt;
      }
    });

    if (bestPoint) {
      this._flashPoint = { x: (bestPoint as TrailPoint).x, y: (bestPoint as TrailPoint).y };
      this._flashTime = now;
      return { x: (bestPoint as TrailPoint).x, y: (bestPoint as TrailPoint).y };
    }
    return null;
  }

  setHeatmap(heatmap: typeof this._heatmap): void {
    this._heatmap = heatmap;
  }

  setPinnedRegions(regions: PinnedRegion[]): void {
    this.pinnedRegions = regions;
  }

  setTrailDuration(seconds: number): void {
    this.trailDuration = seconds * 1000;
  }

  setTrailColor(color: string): void {
    this.trailColor = color;
  }

  clearTrail(): void {
    this.trail.clear();
  }

  destroy(): void {
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('touchstart', this._onTouchStart);
    this.trail.clear();
    this.pinnedRegions = [];
  }

  // ─── HiDPI ───────────────────────────────────────────────────────────────────

  private _ensureHiDPI(): void {
    const dpr  = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.round(rect.width)  || this.canvas.clientWidth  || 160;
    const cssH = Math.round(rect.height) || this.canvas.clientHeight || 160;

    if (this._dpr !== dpr || this._cssW !== cssW || this._cssH !== cssH) {
      this._dpr = dpr;
      this._cssW = cssW;
      this._cssH = cssH;
      this.canvas.width  = cssW * dpr;
      this.canvas.height = cssH * dpr;
    }
  }

  // ─── Zoom window ─────────────────────────────────────────────────────────────

  private _normalizeZoomWindow(zw: ZoomWindow | null | undefined, zoomLevel: number): ZoomWindow {
    if (zw && typeof zw.cx === 'number') return zw;
    return { cx: 0.5, cy: 0.5, r: zoomLevel / 2 };
  }

  // ─── Drawing layers ──────────────────────────────────────────────────────────

  private _drawDimOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, zw: ZoomWindow): void {
    if (zw.r >= 0.5) return; // full space visible — no zoom

    ctx.save();
    ctx.fillStyle = DIM_OVERLAY;

    const zcx = zw.cx * w;
    const zcy = (1 - zw.cy) * h;
    const zr  = zw.r * Math.min(w, h);

    // Even-odd rule: full rect minus zoom-circle cutout
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.arc(zcx, zcy, zr, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.restore();
  }

  private _drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, zw: ZoomWindow): void {
    const zoomScale = zw.r * 2;

    // Each level fades in as zoom narrows
    const levels = [
      { divs: 4,  fadeStart: 2.0,    fadeFull: 1.0   },
      { divs: 8,  fadeStart: 0.75,   fadeFull: 0.5   },
      { divs: 16, fadeStart: 0.375,  fadeFull: 0.25  },
      { divs: 32, fadeStart: 0.1875, fadeFull: 0.1   },
    ] as const;

    for (const level of levels) {
      let alpha: number;
      if (zoomScale >= level.fadeStart) {
        alpha = 0;
      } else if (zoomScale <= level.fadeFull) {
        alpha = 1;
      } else {
        alpha = 1 - (zoomScale - level.fadeFull) / (level.fadeStart - level.fadeFull);
      }
      if (alpha < 0.01) continue;

      const isMajor = level.divs === 4;
      const finalAlpha = (isMajor ? 0.15 : 0.08) * alpha;
      ctx.strokeStyle = `rgba(255, 255, 255, ${finalAlpha})`;
      ctx.lineWidth   = isMajor ? 0.8 : 0.5;

      const step = 1 / level.divs;
      ctx.beginPath();

      for (let i = 0; i <= level.divs; i++) {
        const canvasX = i * step * w;
        ctx.moveTo(canvasX, 0);
        ctx.lineTo(canvasX, h);
      }
      for (let i = 0; i <= level.divs; i++) {
        const canvasY = (1 - i * step) * h;
        ctx.moveTo(0, canvasY);
        ctx.lineTo(w, canvasY);
      }
      ctx.stroke();
    }
  }

  private _drawZoomWindowBorder(ctx: CanvasRenderingContext2D, w: number, h: number, zw: ZoomWindow): void {
    if (zw.r >= 0.5) return;

    const zcx = zw.cx * w;
    const zcy = (1 - zw.cy) * h;
    const zr  = zw.r * Math.min(w, h);

    ctx.beginPath();
    ctx.arc(zcx, zcy, zr, 0, Math.PI * 2);
    ctx.fillStyle = ZOOM_WINDOW_FILL;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(zcx, zcy, zr, 0, Math.PI * 2);
    ctx.strokeStyle = ZOOM_WINDOW_BORDER;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private _drawPinnedRegions(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    for (const region of this.pinnedRegions) {
      const x1 = region.x1 * w;
      const y1 = (1 - region.y2) * h;
      const rw = (region.x2 - region.x1) * w;
      const rh = (region.y2 - region.y1) * h;
      const color = region.color ?? 'rgba(100, 200, 255, 0.15)';

      ctx.fillStyle = color;
      ctx.fillRect(x1, y1, rw, rh);

      // Bump alpha for border
      ctx.strokeStyle = color.replace(/[\d.]+\)$/, '0.5)');
      ctx.lineWidth = 1;
      ctx.strokeRect(x1, y1, rw, rh);
    }
  }

  private _drawTrainingExamples(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.getTrainingData) return;
    const data = this.getTrainingData();
    if (!data) return;

    const { features, labels } = data;
    for (let i = 0; i < features.length; i++) {
      const fx = features[i][0] * w;
      const fy = (1 - features[i][1]) * h;
      const hue = labels[i] ? (labels[i]![3] ?? 0) * 360 : 0;
      ctx.fillStyle = `hsla(${hue}, 80%, 60%, 0.85)`;
      ctx.beginPath();
      ctx.arc(fx, fy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private _drawTrail(ctx: CanvasRenderingContext2D, w: number, h: number, outputMode: string): void {
    const now = performance.now();
    const duration = this.trailDuration;
    const baseColor = TRAIL_COLORS[outputMode] ?? this.trailColor;

    // Collect alive points
    const alive: TrailPoint[] = [];
    this.trail.forEach((pt) => {
      if (now - pt.t <= duration) alive.push(pt);
    });
    if (alive.length < 2) return;

    const rgb = this._parseColor(baseColor);

    // Canvas-space control points
    const canvasPts = alive.map(pt => ({
      x: pt.x * w,
      y: (1 - pt.y) * h,
      z: pt.z,
      t: pt.t,
    }));

    // Draw Catmull-Rom spline segments
    for (let i = 0; i < canvasPts.length - 1; i++) {
      const cp0 = canvasPts[Math.max(0, i - 1)];
      const cp1 = canvasPts[i];
      const cp2 = canvasPts[i + 1];
      const cp3 = canvasPts[Math.min(canvasPts.length - 1, i + 2)];

      let prev = catmullRomPoint(cp0, cp1, cp2, cp3, 0);

      for (let s = 1; s <= SPLINE_SEGMENTS; s++) {
        const t    = s / SPLINE_SEGMENTS;
        const curr = catmullRomPoint(cp0, cp1, cp2, cp3, t);

        const segAge  = now - (cp1.t + (cp2.t - cp1.t) * (t - 0.5 / SPLINE_SEGMENTS));
        const segZoom = cp1.z + (cp2.z - cp1.z) * t;

        const alpha = Math.max(0, 1 - segAge / duration);
        const lineW = TRAIL_MIN_WIDTH + (TRAIL_MAX_WIDTH - TRAIL_MIN_WIDTH) * segZoom;

        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(curr.x, curr.y);
        ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha * 0.8})`;
        ctx.lineWidth = lineW;
        ctx.lineCap = 'round';
        ctx.stroke();

        prev = curr;
      }
    }

    // Trail-point dots (tap targets)
    for (const pt of alive) {
      const alpha = Math.max(0, 1 - (now - pt.t) / duration);
      if (alpha < 0.1) continue;

      const px   = pt.x * w;
      const py   = (1 - pt.y) * h;
      const dotR = 2 + alpha * 2;

      ctx.beginPath();
      ctx.arc(px, py, dotR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha * 0.5})`;
      ctx.fill();
    }
  }

  private _drawFlash(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this._flashPoint) return;
    const elapsed = performance.now() - this._flashTime;
    if (elapsed > 300) { this._flashPoint = null; return; }

    const alpha  = 1 - elapsed / 300;
    const radius = 6 + (elapsed / 300) * 14;
    const px = this._flashPoint.x * w;
    const py = (1 - this._flashPoint.y) * h;

    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.6})`;
    ctx.fill();
  }

  private _drawNoiseRings(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number, maxR: number,
    zoomLevel: number, noiseLevel: number
  ): void {
    // Inner ring — zoom level indicator
    const zoomR = maxR * Math.max(0.1, zoomLevel);
    ctx.beginPath();
    ctx.arc(cx, cy, zoomR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 200, 100, ${0.15 + 0.15 * (1 - zoomLevel)})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Outer ring — RL noise magnitude
    if (noiseLevel > 0.001) {
      const noiseR    = zoomR + 4 + noiseLevel * (maxR - zoomR - 4) * 3;
      const clampedR  = Math.min(noiseR, maxR - 1);
      const isHigh    = noiseLevel > 0.1;
      const pulse     = isHigh ? Math.sin(this._pulsePhase) * 0.15 : 0;
      const noiseAlpha = 0.2 + noiseLevel * 2 + pulse;

      ctx.beginPath();
      ctx.arc(cx, cy, clampedR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 80, 80, ${Math.min(0.8, noiseAlpha)})`;
      ctx.lineWidth   = 2 + noiseLevel * 4;
      ctx.stroke();

      if (isHigh) {
        ctx.beginPath();
        ctx.arc(cx, cy, clampedR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 80, 80, ${Math.min(0.3, noiseAlpha * 0.3)})`;
        ctx.lineWidth   = 6 + noiseLevel * 8;
        ctx.stroke();
      }
    }
  }

  private _drawCursor(
    ctx: CanvasRenderingContext2D,
    w: number, h: number,
    joyX: number, joyY: number,
    effectiveX: number | undefined,
    effectiveY: number | undefined,
    frozen: boolean
  ): void {
    const px = joyX * w;
    const py = (1 - joyY) * h;

    // Ghost line from physical to effective position (if pipeline applies offset)
    if (effectiveX !== undefined && effectiveY !== undefined) {
      const ex = effectiveX * w;
      const ey = (1 - effectiveY) * h;
      const dx = ex - px;
      const dy = ey - py;
      if (dx * dx + dy * dy > 4) {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(ex, ey, 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Crosshair
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(px, 0); ctx.lineTo(px, h);
    ctx.moveTo(0, py); ctx.lineTo(w, py);
    ctx.stroke();

    // Cursor glow + dot
    ctx.save();
    ctx.shadowColor = frozen ? 'rgba(100, 180, 255, 0.7)' : CURSOR_GLOW;
    ctx.shadowBlur  = 12;

    ctx.beginPath();
    ctx.arc(px, py, CURSOR_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = frozen ? 'rgba(100, 180, 255, 0.7)' : 'rgba(255, 255, 255, 0.6)';
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fill();

    ctx.restore();
  }

  private _drawFrozenOverlay(
    ctx: CanvasRenderingContext2D,
    w: number, h: number,
    cx: number, cy: number, r: number
  ): void {
    ctx.fillStyle = FROZEN_COLOR;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Snowflake asterisk
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(150, 210, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';

    const armLen  = 12;
    const tickLen = 4;
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.rotate((Math.PI / 3) * i);

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -armLen);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-tickLen * 0.5, -armLen * 0.55);
      ctx.lineTo(0,              -armLen * 0.7);
      ctx.lineTo( tickLen * 0.5, -armLen * 0.55);
      ctx.stroke();

      ctx.restore();
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(150, 210, 255, 0.35)';
    ctx.font = `bold ${Math.round(w * 0.065)}px system-ui, sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FROZEN', cx, cy + armLen + 14);
  }

  // ─── Event handling ───────────────────────────────────────────────────────────

  private _handlePointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this._tryTap(e.offsetX, e.offsetY);
  }

  private _handleTouchStart(e: TouchEvent): void {
    if (e.touches.length !== 1) return;
    const rect  = this.canvas.getBoundingClientRect();
    const touch = e.touches[0];
    this._tryTap(touch.clientX - rect.left, touch.clientY - rect.top);
  }

  private _tryTap(cssX: number, cssY: number): void {
    const result = this.handleTap(cssX, cssY);
    if (result && this.onTrailTap) {
      this.onTrailTap(result);
    }
  }

  // ─── Utilities ───────────────────────────────────────────────────────────────

  private _parseColor(hex: string): { r: number; g: number; b: number } {
    if (hex.startsWith('#') && hex.length === 7) {
      const bigint = parseInt(hex.slice(1), 16);
      return {
        r: (bigint >> 16) & 255,
        g: (bigint >> 8)  & 255,
        b:  bigint        & 255,
      };
    }
    return { r: 255, g: 100, b: 50 };
  }
}
