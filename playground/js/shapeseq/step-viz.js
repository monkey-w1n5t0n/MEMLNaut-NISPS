/**
 * ShapeSeq Circular Step Visualizer
 *
 * Renders steps arranged in a circle (heptagon, tridecagon, etc.)
 * with pitch mapped to radial distance, velocity to node size,
 * and accent to color brightness.
 *
 * Designed for 60fps rendering — no allocations in the render loop.
 * Port-ready: explicit state, no closures in hot paths.
 *
 * @module shapeseq/step-viz
 */

import { SEQ } from './event-bus.js';

// ── Constants (pre-allocated, shared across instances) ──────────────

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI * 0.5;

// Color constants
const COLOR_INACTIVE = 'rgba(255, 255, 255, 0.15)';
const COLOR_ACTIVE = '#00ccff';
const COLOR_CURRENT = '#ff6a00';
const COLOR_ACCENT = '#ffcc00';
const COLOR_BG = '#0d0d0d';

// Glow colors (pre-computed rgba strings)
const GLOW_ACTIVE = 'rgba(0, 204, 255, 0.3)';
const GLOW_CURRENT = 'rgba(255, 106, 0, 0.4)';
const GLOW_ACCENT = 'rgba(255, 204, 0, 0.35)';

// Layout
const PADDING_RATIO = 0.08;       // canvas padding as fraction of min dimension
const OUTER_RADIUS_RATIO = 0.90;  // outer ring at 90% of available radius
const INNER_RADIUS_RATIO = 0.30;  // inner ring at 30% of available radius

// Node sizing
const NODE_MIN_RADIUS = 4;
const NODE_MAX_RADIUS = 18;
const NODE_OUTLINE_WIDTH = 1.5;

// Current-step indicator
const INDICATOR_EXTRA_RADIUS = 8;
const INDICATOR_LINE_WIDTH = 2;

// Center dot
const CENTER_DOT_RADIUS = 3;

// ── StepVisualizer ──────────────────────────────────────────────────

export class StepVisualizer {
  /**
   * @param {{ canvas: HTMLCanvasElement, eventBus: import('./event-bus.js').EventBus }} opts
   */
  constructor({ canvas, eventBus }) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._bus = eventBus;

    // State
    this._pattern = null;       // current pattern description
    this._currentStep = -1;     // playback position (-1 = none)
    this._width = 0;
    this._height = 0;
    this._cx = 0;              // center x
    this._cy = 0;              // center y
    this._maxRadius = 0;       // max ring radius in pixels

    // Pre-allocated arrays to avoid per-frame allocation.
    // Sized lazily when pattern is set.
    this._nodeX = null;        // Float64Array — screen x per step
    this._nodeY = null;        // Float64Array — screen y per step
    this._nodeR = null;        // Float64Array — rendered radius per step

    // Interaction
    this._tapCallback = null;
    this._onPointerDown = this._handlePointerDown.bind(this);

    // Event bus subscription
    this._onStep = this._handleStep.bind(this);
    this._bus.on(SEQ.STEP, this._onStep);

    // Canvas interaction
    this._canvas.addEventListener('pointerdown', this._onPointerDown);

    // Initial sizing
    this.resize(canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height);
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Update the displayed pattern.
   * @param {{ steps: Array, stepCount: number, metadata: Object }} patternDesc
   */
  setPattern(patternDesc) {
    this._pattern = patternDesc;
    const count = patternDesc ? patternDesc.stepCount : 0;

    // (Re)allocate coordinate buffers only when step count changes
    if (!this._nodeX || this._nodeX.length !== count) {
      this._nodeX = new Float64Array(count);
      this._nodeY = new Float64Array(count);
      this._nodeR = new Float64Array(count);
    }

    this._computeLayout();
  }

  /**
   * Update the playback position.
   * @param {number} index — step index (0-based), or -1 for none
   */
  setCurrentStep(index) {
    this._currentStep = index;
  }

  /**
   * Draw one frame. Call from requestAnimationFrame.
   */
  render() {
    const ctx = this._ctx;
    const w = this._width;
    const h = this._height;

    // Clear
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, w, h);

    if (!this._pattern || this._pattern.stepCount === 0) return;

    const steps = this._pattern.steps;
    const count = this._pattern.stepCount;
    const cx = this._cx;
    const cy = this._cy;

    // Draw connecting ring (subtle guide circle at midpoint radius)
    const midRadius = this._maxRadius * ((OUTER_RADIUS_RATIO + INNER_RADIUS_RATIO) * 0.5);
    ctx.beginPath();
    ctx.arc(cx, cy, midRadius, 0, TWO_PI);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, CENTER_DOT_RADIUS, 0, TWO_PI);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fill();

    // Draw connector line from center to current step
    if (this._currentStep >= 0 && this._currentStep < count) {
      const si = this._currentStep;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(this._nodeX[si], this._nodeY[si]);
      ctx.strokeStyle = 'rgba(255, 106, 0, 0.2)';
      ctx.lineWidth = INDICATOR_LINE_WIDTH;
      ctx.stroke();
    }

    // Draw step nodes
    for (let i = 0; i < count; i++) {
      const step = steps[i];
      const nx = this._nodeX[i];
      const ny = this._nodeY[i];
      const nr = this._nodeR[i];
      const isCurrent = i === this._currentStep;

      if (isCurrent) {
        // Outer glow for current step
        ctx.beginPath();
        ctx.arc(nx, ny, nr + INDICATOR_EXTRA_RADIUS, 0, TWO_PI);
        ctx.fillStyle = GLOW_CURRENT;
        ctx.fill();
      }

      if (step.trigger) {
        // Glow behind active nodes
        if (!isCurrent) {
          const glowColor = step.accent ? GLOW_ACCENT : GLOW_ACTIVE;
          ctx.beginPath();
          ctx.arc(nx, ny, nr + 4, 0, TWO_PI);
          ctx.fillStyle = glowColor;
          ctx.fill();
        }

        // Filled node
        ctx.beginPath();
        ctx.arc(nx, ny, nr, 0, TWO_PI);
        if (isCurrent) {
          ctx.fillStyle = COLOR_CURRENT;
        } else if (step.accent) {
          ctx.fillStyle = COLOR_ACCENT;
        } else {
          ctx.fillStyle = COLOR_ACTIVE;
        }
        ctx.fill();
      } else {
        // Dim outline only for untriggered steps
        ctx.beginPath();
        ctx.arc(nx, ny, nr, 0, TWO_PI);
        ctx.strokeStyle = isCurrent ? COLOR_CURRENT : COLOR_INACTIVE;
        ctx.lineWidth = NODE_OUTLINE_WIDTH;
        ctx.stroke();
      }
    }
  }

  /**
   * Handle canvas resize.
   * @param {number} width — CSS pixels
   * @param {number} height — CSS pixels
   */
  resize(width, height) {
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width = width * dpr;
    this._canvas.height = height * dpr;
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this._width = width;
    this._height = height;
    this._cx = width * 0.5;
    this._cy = height * 0.5;

    const minDim = Math.min(width, height);
    this._maxRadius = (minDim * 0.5) * (1 - PADDING_RATIO * 2);

    this._computeLayout();
  }

  /**
   * Register a tap callback.
   * @param {function(number): void} callback — receives step index
   */
  onStepTap(callback) {
    this._tapCallback = callback;
  }

  /**
   * Unsubscribe from event bus and remove DOM listeners.
   */
  destroy() {
    this._bus.off(SEQ.STEP, this._onStep);
    this._canvas.removeEventListener('pointerdown', this._onPointerDown);
    this._tapCallback = null;
    this._pattern = null;
  }

  // ── Private ─────────────────────────────────────────────────────

  /**
   * Re-compute node positions from current pattern + canvas size.
   * Called when pattern or size changes — NOT per frame.
   */
  _computeLayout() {
    if (!this._pattern || !this._nodeX) return;

    const steps = this._pattern.steps;
    const count = this._pattern.stepCount;
    const cx = this._cx;
    const cy = this._cy;
    const maxR = this._maxRadius;
    const outerR = maxR * OUTER_RADIUS_RATIO;
    const innerR = maxR * INNER_RADIUS_RATIO;
    const radiusRange = outerR - innerR;

    // Angular step: start at top (-PI/2), go clockwise
    const angleStep = TWO_PI / count;

    for (let i = 0; i < count; i++) {
      const step = steps[i];
      const angle = -HALF_PI + angleStep * i;

      // Pitch -> radial distance: low pitch = outer, high pitch = inner
      const pitchNorm = step.pitch; // 0 = low (outer), 1 = high (inner)
      const r = outerR - pitchNorm * radiusRange;

      this._nodeX[i] = cx + Math.cos(angle) * r;
      this._nodeY[i] = cy + Math.sin(angle) * r;

      // Velocity -> node size
      this._nodeR[i] = NODE_MIN_RADIUS + step.velocity * (NODE_MAX_RADIUS - NODE_MIN_RADIUS);
    }
  }

  /**
   * Handle seq.step events from the event bus.
   */
  _handleStep(data) {
    if (typeof data.stepIndex === 'number') {
      this._currentStep = data.stepIndex;
    }
  }

  /**
   * Handle pointer down on the canvas for tap interaction.
   */
  _handlePointerDown(e) {
    if (!this._tapCallback || !this._pattern) return;

    const rect = this._canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const count = this._pattern.stepCount;

    // Find closest step within hit radius
    let bestIdx = -1;
    let bestDistSq = Infinity;

    for (let i = 0; i < count; i++) {
      const dx = px - this._nodeX[i];
      const dy = py - this._nodeY[i];
      const distSq = dx * dx + dy * dy;
      // Hit area is the node radius + some tolerance
      const hitR = this._nodeR[i] + 12;
      if (distSq < hitR * hitR && distSq < bestDistSq) {
        bestDistSq = distSq;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      this._tapCallback(bestIdx);
    }
  }
}
