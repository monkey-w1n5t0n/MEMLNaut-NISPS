// Enhanced Joy-Map Visualization
// Zoom minimap (7.1), vanishing trail (7.2), noise ring (7.3)
// Replaces/augments the basic drawJoyMap() in a-app.js

// ---- Catmull-Rom spline helper ----

function catmullRomPoint(p0, p1, p2, p3, t) {
  // Centripetal Catmull-Rom (alpha=0.5 simplified to uniform for speed)
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
    )
  };
}

// ---- Ring buffer ----

class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.head = 0;   // next write index
    this.count = 0;
  }

  push(item) {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  // Iterate oldest to newest
  forEach(fn) {
    if (this.count === 0) return;
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      fn(this.buffer[idx], i, this.count);
    }
  }

  // Get item by age-ordered index (0 = oldest)
  get(i) {
    if (i < 0 || i >= this.count) return null;
    const start = (this.head - this.count + this.capacity) % this.capacity;
    return this.buffer[(start + i) % this.capacity];
  }

  clear() {
    this.head = 0;
    this.count = 0;
  }
}

// ---- Constants ----

const TRAIL_COLORS = {
  visual: '#ff6432',
  synth: '#00d4aa'
};

const FROZEN_COLOR = 'rgba(100, 180, 255, 0.15)';
const ZOOM_WINDOW_FILL = 'rgba(255, 200, 100, 0.06)';
const ZOOM_WINDOW_BORDER = 'rgba(255, 200, 100, 0.6)';
const DIM_OVERLAY = 'rgba(0, 0, 0, 0.35)';
const GRID_MINOR = 'rgba(255, 255, 255, 0.08)';
const GRID_MAJOR = 'rgba(255, 255, 255, 0.15)';
const CURSOR_GLOW = 'rgba(255, 255, 255, 0.35)';

const DEFAULT_TRAIL_DURATION = 5000; // ms
const MAX_TRAIL_POINTS = 300;
const TRAIL_MIN_WIDTH = 1.5;
const TRAIL_MAX_WIDTH = 4;
const CURSOR_RADIUS = 6;
const TAP_HIT_RADIUS = 12;
const SPLINE_SEGMENTS = 4; // subdivisions per trail segment

// ---- Main class ----

export class JoyMapEnhanced {
  /**
   * @param {HTMLCanvasElement} canvas - The joy-map canvas element
   * @param {Object} options
   * @param {Function} options.onTrailTap - Callback({x, y}) when a trail point is tapped
   * @param {Function} options.getTrainingData - Returns {features, labels} for example dots
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onTrailTap = options.onTrailTap || null;
    this.getTrainingData = options.getTrainingData || null;

    this.trail = new RingBuffer(MAX_TRAIL_POINTS);
    this.trailDuration = DEFAULT_TRAIL_DURATION;
    this.trailColor = TRAIL_COLORS.visual;

    this.pinnedRegions = [];

    // Optional heatmap layer (InputHeatmap instance)
    this._heatmap = null;

    // Flash state for tapped trail point
    this._flashPoint = null;
    this._flashTime = 0;

    // Pulse phase for noise ring
    this._pulsePhase = 0;

    // HiDPI tracking
    this._dpr = 1;
    this._cssW = 0;
    this._cssH = 0;

    // Bind event handlers
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onTouchStart = this._handleTouchStart.bind(this);

    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
  }

  // ---- Public API ----

  /**
   * Main draw call. Invoke once per rAF frame.
   */
  draw(state) {
    const {
      joyX = 0.5,
      joyY = 0.5,
      effectiveX,
      effectiveY,
      zoomWindow = null,
      zoomLevel = 1.0,
      noiseLevel = 0,
      outputMode = 'visual',
      frozen = false
    } = state;

    this._ensureHiDPI();
    const ctx = this.ctx;
    const w = this._cssW;
    const h = this._cssH;
    const dpr = this._dpr;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Clip to circle
    const cx = w / 2;
    const cy = h / 2;
    const r = w / 2 - 1;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // Background
    ctx.fillStyle = 'rgba(13, 13, 13, 0.85)';
    ctx.fillRect(0, 0, w, h);

    // Layers (back to front):
    // 0. Input heatmap (background)
    // 1. Dim area outside zoom window
    // 2. Grid (adapts to zoom)
    // 3. Zoom window border
    // 4. Pinned regions
    // 5. Training examples
    // 6. Trail
    // 7. Noise ring (canvas-drawn)
    // 8. Zoom ring (canvas-drawn)
    // 9. Cursor
    // 10. Frozen overlay

    const zw = this._normalizeZoomWindow(zoomWindow, zoomLevel);

    // Heatmap background layer
    if (this._heatmap && this._heatmap.enabled) {
      this._heatmap.draw(ctx, w, h, zw);
    }

    this._drawDimOverlay(ctx, w, h, zw);
    this._drawGrid(ctx, w, h, zw, zoomLevel);
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

    // Advance pulse
    this._pulsePhase += 0.04;
  }

  /**
   * Record a trail point. Call when joystick moves.
   */
  addTrailPoint(x, y, zoomLevel = 1.0) {
    const now = performance.now();
    // Deduplicate: skip if very close to last point and recent
    if (this.trail.count > 0) {
      const last = this.trail.get(this.trail.count - 1);
      const dx = x - last.x;
      const dy = y - last.y;
      if (dx * dx + dy * dy < 0.0001 && now - last.t < 50) return;
    }
    this.trail.push({ x, y, z: zoomLevel, t: now });
  }

  /**
   * Handle tap events. Returns {x, y} if a trail point was tapped, null otherwise.
   */
  handleTap(canvasX, canvasY) {
    const now = performance.now();
    const w = this._cssW;
    const h = this._cssH;
    const hitR = TAP_HIT_RADIUS;
    let bestDist = hitR * hitR;
    let bestPoint = null;

    this.trail.forEach((pt, i, count) => {
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
      this._flashPoint = { x: bestPoint.x, y: bestPoint.y };
      this._flashTime = now;
      return { x: bestPoint.x, y: bestPoint.y };
    }
    return null;
  }

  /**
   * Set a heatmap instance to draw as the background layer.
   * @param {InputHeatmap|null} heatmap
   */
  setHeatmap(heatmap) {
    this._heatmap = heatmap || null;
  }

  setPinnedRegions(regions) {
    this.pinnedRegions = regions || [];
  }

  setTrailDuration(seconds) {
    this.trailDuration = seconds * 1000;
  }

  setTrailColor(color) {
    this.trailColor = color;
  }

  destroy() {
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('touchstart', this._onTouchStart);
    this.trail.clear();
    this.pinnedRegions = [];
  }

  // ---- HiDPI ----

  _ensureHiDPI() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.round(rect.width) || this.canvas.clientWidth || 160;
    const cssH = Math.round(rect.height) || this.canvas.clientHeight || 160;

    if (this._dpr !== dpr || this._cssW !== cssW || this._cssH !== cssH) {
      this._dpr = dpr;
      this._cssW = cssW;
      this._cssH = cssH;
      this.canvas.width = cssW * dpr;
      this.canvas.height = cssH * dpr;
    }
  }

  // ---- Zoom window ----

  _normalizeZoomWindow(zw, zoomLevel) {
    if (zw && typeof zw.x1 === 'number') return zw;
    // Synthesize from zoomLevel centered on 0.5
    const half = zoomLevel / 2;
    return {
      x1: 0.5 - half,
      y1: 0.5 - half,
      x2: 0.5 + half,
      y2: 0.5 + half
    };
  }

  // ---- Drawing layers ----

  _drawDimOverlay(ctx, w, h, zw) {
    if (zw.x1 <= 0 && zw.y1 <= 0 && zw.x2 >= 1 && zw.y2 >= 1) return; // no zoom

    // Draw dim overlay over the entire area, then clear the zoom window
    ctx.save();
    ctx.fillStyle = DIM_OVERLAY;

    // Use even-odd rule: outer rect minus zoom rect
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    // Zoom window rect (Y inverted)
    const zx1 = zw.x1 * w;
    const zy1 = (1 - zw.y2) * h;
    const zx2 = zw.x2 * w;
    const zy2 = (1 - zw.y1) * h;
    const zw_ = zx2 - zx1;
    const zh_ = zy2 - zy1;
    // Draw inner rect counter-clockwise for even-odd
    ctx.moveTo(zx1, zy1);
    ctx.lineTo(zx1, zy1 + zh_);
    ctx.lineTo(zx1 + zw_, zy1 + zh_);
    ctx.lineTo(zx1 + zw_, zy1);
    ctx.closePath();
    ctx.fill('evenodd');
    ctx.restore();
  }

  _drawGrid(ctx, w, h, zw, zoomLevel) {
    // Determine grid density based on zoom
    // zoom 1.0 -> 4x4, 0.5 -> 8x8, 0.25 -> 16x16, etc.
    // Base divisions = 4, multiply by 1/zoomLevel
    const baseDivisions = 4;
    const zoomScale = Math.max(zw.x2 - zw.x1, zw.y2 - zw.y1);

    // We draw multiple grid levels with fading
    // Level 0: 4x4 (always)
    // Level 1: 8x8 (fades in as zoom < 0.75)
    // Level 2: 16x16 (fades in as zoom < 0.375)
    // Level 3: 32x32 (fades in as zoom < 0.1875)
    const levels = [
      { divs: 4, fadeStart: 2.0, fadeFull: 1.0 },
      { divs: 8, fadeStart: 0.75, fadeFull: 0.5 },
      { divs: 16, fadeStart: 0.375, fadeFull: 0.25 },
      { divs: 32, fadeStart: 0.1875, fadeFull: 0.1 }
    ];

    for (const level of levels) {
      let alpha;
      if (zoomScale >= level.fadeStart) {
        alpha = 0;
      } else if (zoomScale <= level.fadeFull) {
        alpha = 1;
      } else {
        alpha = 1 - (zoomScale - level.fadeFull) / (level.fadeStart - level.fadeFull);
      }
      if (alpha < 0.01) continue;

      // Is this a "major" grid (4x4)?
      const isMajor = level.divs === 4;
      const baseAlpha = isMajor ? 0.15 : 0.08;
      const finalAlpha = baseAlpha * alpha;

      ctx.strokeStyle = `rgba(255, 255, 255, ${finalAlpha})`;
      ctx.lineWidth = isMajor ? 0.8 : 0.5;

      // Draw grid lines within the zoom window region
      // Lines at intervals of 1/divs in input space
      const step = 1 / level.divs;

      ctx.beginPath();

      // Vertical lines
      for (let i = 0; i <= level.divs; i++) {
        const inputX = i * step;
        // Only draw if visible in the full map
        const canvasX = inputX * w;
        ctx.moveTo(canvasX, 0);
        ctx.lineTo(canvasX, h);
      }

      // Horizontal lines
      for (let i = 0; i <= level.divs; i++) {
        const inputY = i * step;
        const canvasY = (1 - inputY) * h;
        ctx.moveTo(0, canvasY);
        ctx.lineTo(w, canvasY);
      }

      ctx.stroke();
    }
  }

  _drawZoomWindowBorder(ctx, w, h, zw) {
    if (zw.x1 <= 0 && zw.y1 <= 0 && zw.x2 >= 1 && zw.y2 >= 1) return;

    const x1 = zw.x1 * w;
    const y1 = (1 - zw.y2) * h;
    const rw = (zw.x2 - zw.x1) * w;
    const rh = (zw.y2 - zw.y1) * h;

    // Fill
    ctx.fillStyle = ZOOM_WINDOW_FILL;
    ctx.fillRect(x1, y1, rw, rh);

    // Border
    ctx.strokeStyle = ZOOM_WINDOW_BORDER;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x1, y1, rw, rh);
    ctx.setLineDash([]);
  }

  _drawPinnedRegions(ctx, w, h) {
    for (const region of this.pinnedRegions) {
      const x1 = region.x1 * w;
      const y1 = (1 - region.y2) * h;
      const rw = (region.x2 - region.x1) * w;
      const rh = (region.y2 - region.y1) * h;
      const color = region.color || 'rgba(100, 200, 255, 0.15)';

      ctx.fillStyle = color;
      ctx.fillRect(x1, y1, rw, rh);

      ctx.strokeStyle = color.replace(/[\d.]+\)$/, '0.5)');
      ctx.lineWidth = 1;
      ctx.strokeRect(x1, y1, rw, rh);
    }
  }

  _drawTrainingExamples(ctx, w, h) {
    if (!this.getTrainingData) return;
    const data = this.getTrainingData();
    if (!data) return;

    const { features, labels } = data;
    for (let i = 0; i < features.length; i++) {
      const fx = features[i][0] * w;
      const fy = (1 - features[i][1]) * h;
      let hue = 0;
      if (labels[i]) {
        hue = (labels[i][3] || 0) * 360;
      }
      ctx.fillStyle = `hsla(${hue}, 80%, 60%, 0.85)`;
      ctx.beginPath();
      ctx.arc(fx, fy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawTrail(ctx, w, h, outputMode) {
    const now = performance.now();
    const duration = this.trailDuration;
    const baseColor = TRAIL_COLORS[outputMode] || this.trailColor;

    // Collect alive points
    const alive = [];
    this.trail.forEach((pt) => {
      const age = now - pt.t;
      if (age <= duration) {
        alive.push(pt);
      }
    });

    if (alive.length < 2) return;

    // Parse base color to RGB
    const rgb = this._parseColor(baseColor);

    // Draw spline segments using Catmull-Rom interpolation
    // Pre-convert control points to canvas space
    const canvasPts = alive.map(pt => ({
      x: pt.x * w,
      y: (1 - pt.y) * h,
      z: pt.z,
      t: pt.t
    }));

    for (let i = 0; i < canvasPts.length - 1; i++) {
      const cp0 = canvasPts[Math.max(0, i - 1)];
      const cp1 = canvasPts[i];
      const cp2 = canvasPts[i + 1];
      const cp3 = canvasPts[Math.min(canvasPts.length - 1, i + 2)];

      let prev = catmullRomPoint(cp0, cp1, cp2, cp3, 0);

      for (let s = 1; s <= SPLINE_SEGMENTS; s++) {
        const t = s / SPLINE_SEGMENTS;
        const curr = catmullRomPoint(cp0, cp1, cp2, cp3, t);

        // Interpolate age and zoom along the segment
        const segAge = now - (cp1.t + (cp2.t - cp1.t) * (t - 0.5 / SPLINE_SEGMENTS));
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

    // Draw trail point dots (for tap targets) — only recent, visible ones
    for (const pt of alive) {
      const age = now - pt.t;
      const alpha = Math.max(0, 1 - age / duration);
      if (alpha < 0.1) continue;

      const px = pt.x * w;
      const py = (1 - pt.y) * h;
      const dotR = 2 + alpha * 2;

      ctx.beginPath();
      ctx.arc(px, py, dotR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha * 0.5})`;
      ctx.fill();
    }
  }

  _drawFlash(ctx, w, h) {
    if (!this._flashPoint) return;
    const now = performance.now();
    const elapsed = now - this._flashTime;
    const flashDuration = 300;
    if (elapsed > flashDuration) {
      this._flashPoint = null;
      return;
    }

    const alpha = 1 - elapsed / flashDuration;
    const radius = 6 + (elapsed / flashDuration) * 14;
    const px = this._flashPoint.x * w;
    const py = (1 - this._flashPoint.y) * h;

    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.6})`;
    ctx.fill();
  }

  _drawNoiseRings(ctx, cx, cy, maxR, zoomLevel, noiseLevel) {
    // Inner ring: zoom level (shrinks as zoom decreases)
    const zoomR = maxR * Math.max(0.1, zoomLevel);
    ctx.beginPath();
    ctx.arc(cx, cy, zoomR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 200, 100, ${0.15 + 0.15 * (1 - zoomLevel)})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Outer ring: noise magnitude
    if (noiseLevel > 0.001) {
      const noiseR = zoomR + 4 + noiseLevel * (maxR - zoomR - 4) * 3;
      const clampedR = Math.min(noiseR, maxR - 1);

      // Pulse when noise is high
      const isHigh = noiseLevel > 0.1;
      const pulse = isHigh ? Math.sin(this._pulsePhase) * 0.15 : 0;
      const noiseAlpha = 0.2 + noiseLevel * 2 + pulse;

      ctx.beginPath();
      ctx.arc(cx, cy, clampedR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 80, 80, ${Math.min(0.8, noiseAlpha)})`;
      ctx.lineWidth = 2 + noiseLevel * 4;
      ctx.stroke();

      // Glow on high noise
      if (isHigh) {
        ctx.beginPath();
        ctx.arc(cx, cy, clampedR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 80, 80, ${Math.min(0.3, noiseAlpha * 0.3)})`;
        ctx.lineWidth = 6 + noiseLevel * 8;
        ctx.stroke();
      }
    }
  }

  _drawCursor(ctx, w, h, joyX, joyY, effectiveX, effectiveY, frozen) {
    const px = joyX * w;
    const py = (1 - joyY) * h;

    // If we have effective coords, draw a ghost line from physical to effective
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

        // Effective position indicator (small ring)
        ctx.beginPath();
        ctx.arc(ex, ey, 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Crosshair (subtle)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.moveTo(0, py);
    ctx.lineTo(w, py);
    ctx.stroke();

    // Glow
    ctx.save();
    ctx.shadowColor = frozen ? 'rgba(100, 180, 255, 0.7)' : CURSOR_GLOW;
    ctx.shadowBlur = 12;

    // Outer dot
    ctx.beginPath();
    ctx.arc(px, py, CURSOR_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = frozen ? 'rgba(100, 180, 255, 0.7)' : 'rgba(255, 255, 255, 0.6)';
    ctx.fill();

    // Inner bright dot
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fill();

    ctx.restore();
  }

  _drawFrozenOverlay(ctx, w, h, cx, cy, r) {
    // Subtle blue tint
    ctx.fillStyle = FROZEN_COLOR;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Snowflake icon (simple asterisk-like)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(150, 210, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';

    const armLen = 12;
    const tickLen = 4;
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      ctx.save();
      ctx.rotate(angle);

      // Main arm
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -armLen);
      ctx.stroke();

      // Ticks
      ctx.beginPath();
      ctx.moveTo(-tickLen * 0.5, -armLen * 0.55);
      ctx.lineTo(0, -armLen * 0.7);
      ctx.lineTo(tickLen * 0.5, -armLen * 0.55);
      ctx.stroke();

      ctx.restore();
    }

    ctx.restore();

    // "FROZEN" text
    ctx.fillStyle = 'rgba(150, 210, 255, 0.35)';
    ctx.font = `bold ${Math.round(w * 0.065)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FROZEN', cx, cy + armLen + 14);
  }

  // ---- Event handling ----

  _handlePointerDown(e) {
    // Only respond to primary button (not right-click) and not if dragging
    if (e.button !== 0) return;
    this._tryTap(e.offsetX, e.offsetY);
  }

  _handleTouchStart(e) {
    if (e.touches.length !== 1) return;
    const rect = this.canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    this._tryTap(x, y);
  }

  _tryTap(cssX, cssY) {
    const result = this.handleTap(cssX, cssY);
    if (result && this.onTrailTap) {
      this.onTrailTap(result);
    }
  }

  // ---- Utilities ----

  _parseColor(hex) {
    // Parse #rrggbb or rgb(r,g,b)
    if (hex.startsWith('#')) {
      const bigint = parseInt(hex.slice(1), 16);
      return {
        r: (bigint >> 16) & 255,
        g: (bigint >> 8) & 255,
        b: bigint & 255
      };
    }
    // Fallback
    return { r: 255, g: 100, b: 50 };
  }
}
