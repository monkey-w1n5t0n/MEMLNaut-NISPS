// NISPS Immersive — Design A
// Full-viewport flow field with floating overlays

import { IML } from './nisps/iml.js';
import { FlowFieldVisualizer } from './ui/visualizer.js';
import { C15Bridge } from './synth/c15-bridge.js';
import { Arpeggiator } from './synth/arpeggiator.js';
import { MIDIInput } from './synth/midi-input.js';
import { SYNTH_PARAM_MAP, SYNTH_PARAM_NAMES, SYNTH_PARAM_COLORS, applyTame, applyCurve, applyGroupOverride } from './synth/param-map.js';
import { GamepadInput } from './ui/gamepad.js';

// ---- Constants ----
const N_INPUTS = 2;
const N_VISUAL_OUTPUTS = 20;
const N_SYNTH_OUTPUTS = SYNTH_PARAM_MAP.length; // 126
const N_OUTPUTS = N_SYNTH_OUTPUTS; // MLP always produces full output; visual uses first 20
const STORAGE_KEY = 'nisps-a-immersive';

const VISUAL_PARAM_NAMES = [
  'Flow', 'Scale', 'Speed', 'Hue', 'Spread', 'Size', 'Trail', 'Turb',
  'Attract', 'Radius', 'DispRate', 'DispAmt', 'Lifetime', 'Respawn',
  'Advection', 'Inertia', 'Drag', 'Repulse', 'RepCnt', 'RepRate',
];
const VISUAL_PARAM_COLORS = [
  '#ff6a00', '#00ccff', '#ff6600', '#ff00cc', '#ffcc00', '#88ff00',
  '#0088ff', '#ff3366', '#9bff5f', '#59d3ff', '#ff8f3f', '#a0b7ff',
  '#f4ff7a', '#ffa8db', '#7dffc8', '#ffd166', '#8ad4ff', '#ff5f5f',
  '#ffc15f', '#ff8a3d',
];

// ---- Presets ----
const PRESETS = {
  'calm-to-chaotic': [
    { input: [0.1, 0.9], output: [0.25, 0.3, 0.1, 0.55, 0.2, 0.3, 0.02, 0.05, 0.9, 0.45, 0.25, 0.2, 0.9, 0.0, 0.0, 0.2, 0.05, 0.0, 0.0, 0.2] },
    { input: [0.9, 0.1], output: [0.75, 0.7, 0.9, 0.05, 0.8, 0.7, 0.9, 0.95, 0.3, 0.2, 0.85, 0.7, 0.25, 0.55, 1.0, 0.92, 0.02, 0.95, 0.8, 0.85] },
    { input: [0.5, 0.5], output: [0.5, 0.5, 0.5, 0.3, 0.5, 0.5, 0.4, 0.5, 0.7, 0.6, 0.5, 0.45, 0.55, 0.9, 0.5, 0.65, 0.08, 0.45, 0.4, 0.5] },
  ],
  'rainbow-sweep': [
    { input: [0.0, 0.5], output: [0.5, 0.5, 0.4, 0.0, 0.3, 0.4, 0.05, 0.3, 0.8, 0.55, 0.4, 0.3, 0.8, 0.0, 0.0, 0.45, 0.08, 0.2, 0.25, 0.45] },
    { input: [0.5, 0.5], output: [0.5, 0.5, 0.4, 0.5, 0.3, 0.4, 0.05, 0.3, 0.8, 0.55, 0.55, 0.35, 0.7, 0.0, 0.4, 0.45, 0.08, 0.45, 0.4, 0.6] },
    { input: [1.0, 0.5], output: [0.5, 0.5, 0.4, 1.0, 0.3, 0.4, 0.05, 0.3, 0.8, 0.55, 0.75, 0.45, 0.6, 0.0, 0.8, 0.45, 0.08, 0.7, 0.55, 0.75] },
  ],
  'vortex': [
    { input: [0.5, 0.5], output: [0.0, 0.8, 0.8, 0.6, 0.1, 0.15, 0.02, 1.0, 1.0, 0.3, 0.95, 0.85, 0.25, 1.0, 0.5, 0.95, 0.01, 1.0, 1.0, 1.0] },
    { input: [0.0, 0.0], output: [0.5, 0.2, 0.3, 0.8, 0.9, 0.6, 0.08, 0.1, 0.35, 0.8, 0.25, 0.15, 0.8, 0.5, 0.2, 0.35, 0.2, 0.15, 0.2, 0.25] },
    { input: [1.0, 1.0], output: [0.5, 0.2, 0.3, 0.2, 0.9, 0.6, 0.08, 0.1, 0.35, 0.8, 0.25, 0.15, 0.8, 0.5, 0.8, 0.35, 0.2, 0.15, 0.2, 0.25] },
    { input: [0.0, 1.0], output: [0.3, 0.4, 0.5, 0.4, 0.5, 0.4, 0.05, 0.5, 0.65, 0.5, 0.55, 0.45, 0.45, 0.2, 0.4, 0.7, 0.1, 0.5, 0.4, 0.55] },
    { input: [1.0, 0.0], output: [0.7, 0.4, 0.5, 0.0, 0.5, 0.4, 0.05, 0.5, 0.65, 0.5, 0.55, 0.45, 0.45, 0.2, 0.9, 0.7, 0.1, 0.5, 0.4, 0.55] },
  ],
  'spiral': [
    { input: [0.5, 0.5], output: [0.0, 0.6, 0.6, 0.3, 0.15, 0.2, 0.03, 0.7, 0.9, 0.25, 0.7, 0.6, 0.35, 0.8, 0.65, 0.9, 0.02, 0.3, 0.5, 0.7] },
    { input: [0.0, 0.0], output: [0.8, 0.3, 0.4, 0.7, 0.8, 0.5, 0.06, 0.2, 0.5, 0.7, 0.3, 0.2, 0.7, 0.3, 0.3, 0.4, 0.15, 0.1, 0.1, 0.3] },
    { input: [1.0, 1.0], output: [0.2, 0.3, 0.4, 0.1, 0.8, 0.5, 0.06, 0.2, 0.5, 0.7, 0.3, 0.2, 0.7, 0.3, 0.9, 0.4, 0.15, 0.1, 0.1, 0.3] },
  ],
  'embers': [
    { input: [0.5, 0.5], output: [0.1, 0.4, 0.2, 0.05, 0.05, 0.6, 0.02, 0.15, 0.6, 0.3, 0.15, 0.9, 0.5, 0.7, 0.1, 0.3, 0.2, 0.0, 0.0, 0.2] },
    { input: [0.2, 0.8], output: [0.5, 0.6, 0.15, 0.08, 0.08, 0.8, 0.015, 0.1, 0.8, 0.5, 0.1, 0.5, 0.8, 0.4, 0.05, 0.5, 0.1, 0.0, 0.0, 0.15] },
    { input: [0.8, 0.2], output: [0.9, 0.3, 0.35, 0.02, 0.12, 0.35, 0.04, 0.3, 0.4, 0.2, 0.3, 1.0, 0.3, 0.9, 0.2, 0.15, 0.3, 0.0, 0.0, 0.3] },
  ],
};

// ---- App state ----
let iml;
let visualizer;
let synthVisualizer;
let c15 = null;
let arpeggiator = null;
let midiInput = null;

let outputMode = 'visual';
let tameLevel = 0;
let spreadLevel = 0.6;
let noiseLevel = 0.05;
const rlExplorationDecay = 0.97;

// Joystick state
let joyX = 0.5;
let joyY = 0.5;
let joyDragging = false;
let joyFollowMode = false;
let joyTrail = [];

// Sheet state
let sheetExpanded = false;

// Gamepad
let gamepad;

// Raw param slider values (for examples mode advanced editing)
let rawParamValues = new Array(N_OUTPUTS).fill(0.5);

// ---- DOM refs ----
let $canvas, $heatmapCells, $heatmapTooltip;
let $joystickContainer, $joyMap, $joyMapCtx;
let $noiseRing, $followBadge;
let $rlButtons, $btnThumbsUp, $btnThumbsDown;
let $bottomSheet, $statusText;
let $sheetContent;
let $synthPanel, $lossCanvas, $lossCtx;
let $rawParams;
let $floatingBar, $chevronBtn, $followPill;
let $synthVisCanvas;

// ---- Synth Sections (for SynthVisualizer) ----
const SYNTH_SECTIONS = [
  { name: 'Env A', count: 7, color: '#4488ff' },
  { name: 'Env B', count: 7, color: '#4488ff' },
  { name: 'Env C', count: 6, color: '#6688dd' },
  { name: 'Osc A', count: 5, color: '#ff8844' },
  { name: 'Osc B', count: 5, color: '#ff8844' },
  { name: 'Shp A', count: 6, color: '#ff4466' },
  { name: 'Shp B', count: 6, color: '#ff4466' },
  { name: 'Comb', count: 8, color: '#44ddaa' },
  { name: 'SVF', count: 7, color: '#44ddaa' },
  { name: 'FB Mix', count: 10, color: '#ddaa44' },
  { name: 'Out Mix', count: 14, color: '#ddaa44' },
  { name: 'Cabinet', count: 8, color: '#aa88dd' },
  { name: 'Flanger', count: 13, color: '#dd88aa' },
  { name: 'Echo', count: 7, color: '#88aadd' },
  { name: 'Reverb', count: 6, color: '#88ddaa' },
  { name: 'Unison', count: 3, color: '#cccccc' },
  { name: 'Mono', count: 1, color: '#999999' },
];

// ---- Group Overrides: per-group curve + per-param min/max/curve/mute ----
// groupOverrides[sectionIndex] = { curve: 0.5, params: [{ min, max, curve, muted, fixedValue }, ...] }
const groupOverrides = SYNTH_SECTIONS.map(sec => ({
  curve: 0.5,
  params: new Array(sec.count).fill(null).map(() => ({
    min: 0, max: 1, curve: 0.5, muted: false, fixedValue: 0.5,
  })),
}));

// Build a flat lookup: paramIndex -> { sectionIndex, localIndex }
const paramToSection = [];
{
  let idx = 0;
  for (let si = 0; si < SYNTH_SECTIONS.length; si++) {
    for (let li = 0; li < SYNTH_SECTIONS[si].count; li++) {
      paramToSection.push({ si, li });
      idx++;
    }
  }
  // Pad for any params beyond sections
  while (paramToSection.length < N_SYNTH_OUTPUTS) {
    paramToSection.push(null);
  }
}

/**
 * Apply group overrides (per-param curve + min/max) to a single ML output value.
 * Returns the remapped value, or fixedValue if the param is muted.
 */
function applyGroupOverrides(rawValue, paramIndex) {
  const mapping = paramToSection[paramIndex];
  if (!mapping) return rawValue;
  const ov = groupOverrides[mapping.si];
  const p = ov.params[mapping.li];
  if (p.muted) return p.fixedValue;
  // Per-param curve overrides group curve (if param curve != 0.5, use it; else use group curve)
  const curve = p.curve !== 0.5 ? p.curve : ov.curve;
  return applyGroupOverride(rawValue, curve, p.min, p.max);
}

/** Check if param at given index is muted */
function isParamMuted(paramIndex) {
  const mapping = paramToSection[paramIndex];
  if (!mapping) return false;
  return groupOverrides[mapping.si].params[mapping.li].muted;
}

// ---- SynthVisualizer class ----
class SynthVisualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.params = new Array(N_OUTPUTS).fill(0.5);
    this.displayParams = new Array(N_OUTPUTS).fill(0.5);
    this.lerpSpeed = 0.12;
    this.topPadding = 40;
    this.bottomPadding = 100;

    // Interaction state
    this._dragging = false;
    this._dragBarIndex = -1;
    this._interactionEnabled = false;

    // Hover tooltip state
    this._hoveredBar = -1;
    this._tooltipEl = null;

    // Build section map
    this.sectionMap = [];
    let idx = 0;
    for (const sec of SYNTH_SECTIONS) {
      for (let i = 0; i < sec.count && idx < N_OUTPUTS; i++, idx++) {
        this.sectionMap.push(sec);
      }
    }
    // Fill remainder with generic
    while (this.sectionMap.length < N_OUTPUTS) {
      this.sectionMap.push({ name: 'Other', count: 1, color: '#666666' });
    }

    // Always-on hover tracking for tooltip (independent of enableInteraction)
    this.canvas.addEventListener('pointermove', (e) => {
      if (this._dragging) return; // interaction handler takes over
      const idx = this.hitTest(e.clientX, e.clientY);
      this._hoveredBar = idx;
      // Store mouse position in canvas pixels for tooltip
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this._mouseCanvasX = (e.clientX - rect.left) * dpr;
      this._mouseCanvasY = (e.clientY - rect.top) * dpr;
    });
    this.canvas.addEventListener('pointerleave', () => {
      this._hoveredBar = -1;
    });

    this.resize();
  }

  resize() {
    this.canvas.width = window.innerWidth * (window.devicePixelRatio || 1);
    this.canvas.height = window.innerHeight * (window.devicePixelRatio || 1);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
  }

  setParams(outputs) {
    for (let i = 0; i < N_OUTPUTS && i < outputs.length; i++) {
      this.params[i] = outputs[i];
    }
  }

  draw() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = window.devicePixelRatio || 1;
    const n = N_OUTPUTS;

    // Lerp display values toward target
    for (let i = 0; i < n; i++) {
      this.displayParams[i] += (this.params[i] - this.displayParams[i]) * this.lerpSpeed;
    }

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, H);

    // Build list of visible (non-muted) param indices
    const visibleIndices = [];
    for (let i = 0; i < n; i++) {
      if (!isParamMuted(i)) visibleIndices.push(i);
    }
    const nVisible = visibleIndices.length || 1;

    // Calculate section gap positions (among visible params only)
    const sectionGaps = new Set();
    let prevSi = -1;
    for (const vi of visibleIndices) {
      const mapping = paramToSection[vi];
      const curSi = mapping ? mapping.si : -1;
      if (prevSi >= 0 && curSi !== prevSi) {
        sectionGaps.add(vi);
      }
      prevSi = curSi;
    }

    const topPad = this.topPadding * dpr;
    const bottomPad = this.bottomPadding * dpr;
    const totalGapPx = sectionGaps.size * 2 * dpr;
    const barAreaWidth = W - totalGapPx;
    const barWidth = barAreaWidth / nVisible;
    const usableHeight = H - topPad - bottomPad;
    const maxBarHeight = usableHeight;

    // Store layout for interaction hit-testing
    this._layout = { W, H, n, barWidth, totalGapPx, sectionGaps, topPad, bottomPad, usableHeight, dpr, visibleIndices };

    // Draw bars
    let x = 0;
    let prevSection = null;
    let sectionStartX = 0;
    let sectionIndex = -1;
    // Store bar x positions for hit testing (indexed by original param index)
    this._barXPositions = new Array(n).fill(-1);
    this._barWidths = new Array(n).fill(0);
    // Store section label regions (in CSS pixels) for drawer hit testing
    this._sectionLabelRegions = [];

    for (let vi = 0; vi < visibleIndices.length; vi++) {
      const i = visibleIndices[vi];
      const sec = this.sectionMap[i];
      const mapping = paramToSection[i];
      const curSi = mapping ? mapping.si : -1;

      // Section divider gap
      if (sectionGaps.has(i)) {
        // Draw section label for the previous section at top
        if (prevSection) {
          this._drawSectionLabel(ctx, prevSection.name, sectionStartX, x, topPad, prevSection.color);
          this._sectionLabelRegions.push({
            index: sectionIndex,
            left: sectionStartX / dpr,
            right: x / dpr,
            top: 0,
            bottom: topPad / dpr,
            name: prevSection.name,
          });
        }
        sectionIndex = curSi;
        x += 2 * dpr;
        sectionStartX = x;
        prevSection = sec;
      }

      if (vi === 0) {
        sectionStartX = x;
        prevSection = sec;
        sectionIndex = curSi;
      }

      this._barXPositions[i] = x;
      this._barWidths[i] = barWidth;

      const val = this.displayParams[i];
      const barH = val * maxBarHeight;
      const barY = topPad + usableHeight - barH;

      // Bar with slight transparency
      ctx.fillStyle = sec.color + 'cc';
      ctx.fillRect(x, barY, Math.max(barWidth - 0.5, 1), barH);

      // Bright top edge
      ctx.fillStyle = sec.color;
      ctx.fillRect(x, barY, Math.max(barWidth - 0.5, 1), Math.min(2 * dpr, barH));

      x += barWidth;
    }

    // Draw final section label at top
    if (prevSection) {
      this._drawSectionLabel(ctx, prevSection.name, sectionStartX, x, topPad, prevSection.color);
      this._sectionLabelRegions.push({
        index: sectionIndex,
        left: sectionStartX / dpr,
        right: x / dpr,
        top: 0,
        bottom: topPad / dpr,
        name: prevSection.name,
      });
    }

    // Draw tooltip for hovered bar
    this._drawTooltip(ctx, dpr);
  }

  _drawSectionLabel(ctx, name, startX, endX, topPad, color) {
    const dpr = window.devicePixelRatio || 1;
    const fontSize = 9 * dpr;
    ctx.save();
    ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = color + '88';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const cx = (startX + endX) / 2;
    ctx.fillText(name, cx, topPad - 4 * dpr);
    ctx.restore();
  }

  // Returns section region at client coordinates, or null
  hitTestSection(clientX, clientY) {
    if (!this._sectionLabelRegions) return null;
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    for (const region of this._sectionLabelRegions) {
      if (px >= region.left && px <= region.right && py >= region.top && py <= region.bottom) {
        return region;
      }
    }
    return null;
  }

  // Returns bar index at canvas-relative pixel x, or -1
  hitTest(clientX, clientY) {
    if (!this._barXPositions || !this._layout) return -1;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this._layout.dpr;
    const px = (clientX - rect.left) * dpr;
    const n = this._layout.n;

    for (let i = 0; i < n; i++) {
      const bx = this._barXPositions[i];
      if (bx < 0) continue; // muted
      const bw = this._barWidths[i] || this._layout.barWidth;
      if (px >= bx && px < bx + bw) return i;
    }
    return -1;
  }

  // Returns 0-1 value from clientY (top of bar area = 1, bottom = 0)
  yToValue(clientY) {
    if (!this._layout) return 0.5;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this._layout.dpr;
    const py = (clientY - rect.top) * dpr;
    const { topPad, usableHeight } = this._layout;
    const val = 1 - (py - topPad) / usableHeight;
    return Math.max(0, Math.min(1, val));
  }

  enableInteraction(enabled) {
    if (enabled && !this._interactionEnabled) {
      this._interactionEnabled = true;
      this.canvas.style.cursor = 'crosshair';

      this._onPointerDown = (e) => {
        const idx = this.hitTest(e.clientX, e.clientY);
        if (idx < 0) return;
        e.preventDefault();
        this._dragging = true;
        this._dragBarIndex = idx;
        this.canvas.setPointerCapture(e.pointerId);
        const val = this.yToValue(e.clientY);
        rawParamValues[idx] = val;
        this.params[idx] = val;
        routeOutputs(rawParamValues);
        updateHeatmap(rawParamValues);
      };

      this._onPointerMove = (e) => {
        if (!this._dragging) return;
        e.preventDefault();
        // Allow sliding to adjacent bars
        let idx = this.hitTest(e.clientX, e.clientY);
        if (idx < 0) idx = this._dragBarIndex;
        this._dragBarIndex = idx;
        const val = this.yToValue(e.clientY);
        rawParamValues[idx] = val;
        this.params[idx] = val;
        routeOutputs(rawParamValues);
        updateHeatmap(rawParamValues);
      };

      this._onPointerUp = (e) => {
        this._dragging = false;
        this._dragBarIndex = -1;
      };

      this.canvas.addEventListener('pointerdown', this._onPointerDown);
      this.canvas.addEventListener('pointermove', this._onPointerMove);
      this.canvas.addEventListener('pointerup', this._onPointerUp);
      this.canvas.addEventListener('pointercancel', this._onPointerUp);
    } else if (!enabled && this._interactionEnabled) {
      this._interactionEnabled = false;
      this.canvas.style.cursor = '';
      this._dragging = false;
      this._dragBarIndex = -1;
      this._hoveredBar = -1;
      if (this._onPointerDown) {
        this.canvas.removeEventListener('pointerdown', this._onPointerDown);
        this.canvas.removeEventListener('pointermove', this._onPointerMove);
        this.canvas.removeEventListener('pointerup', this._onPointerUp);
        this.canvas.removeEventListener('pointercancel', this._onPointerUp);
      }
    }
  }

  _drawTooltip(ctx, dpr) {
    const i = this._hoveredBar;
    if (i < 0 || !this._layout) return;
    if (this._barXPositions[i] < 0) return; // muted

    const name = SYNTH_PARAM_NAMES[i] || `p${i}`;
    const val = this.displayParams[i];
    const mapping = paramToSection[i];
    let rangeStr = '0.00 – 1.00';
    let curveStr = '0.50';
    if (mapping) {
      const ov = groupOverrides[mapping.si];
      const p = ov.params[mapping.li];
      rangeStr = `${p.min.toFixed(2)} – ${p.max.toFixed(2)}`;
      const curve = p.curve !== 0.5 ? p.curve : ov.curve;
      curveStr = curve.toFixed(2);
    }

    const lines = [name, `Val: ${val.toFixed(2)}`, `Range: ${rangeStr}`, `Curve: ${curveStr}`];
    const fontSize = 10 * dpr;
    const lineHeight = fontSize * 1.4;
    const padX = 8 * dpr;
    const padY = 6 * dpr;

    ctx.save();
    ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;

    // Measure text
    let maxW = 0;
    for (const line of lines) {
      const m = ctx.measureText(line);
      if (m.width > maxW) maxW = m.width;
    }
    const boxW = maxW + padX * 2;
    const boxH = lines.length * lineHeight + padY * 2;

    // Position near the mouse cursor
    const mx = this._mouseCanvasX || 0;
    const my = this._mouseCanvasY || 0;
    const offset = 12 * dpr;
    let tx = mx + offset;
    let ty = my - boxH - offset;
    // Clamp to canvas
    if (tx + boxW > this._layout.W - 2 * dpr) tx = mx - boxW - offset;
    if (ty < 2 * dpr) ty = my + offset;
    if (tx < 2 * dpr) tx = 2 * dpr;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    const r = 4 * dpr;
    ctx.beginPath();
    ctx.roundRect(tx, ty, boxW, boxH, r);
    ctx.fill();
    ctx.stroke();

    // Text
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let li = 0; li < lines.length; li++) {
      ctx.fillStyle = li === 0 ? '#ffffff' : 'rgba(255,255,255,0.6)';
      if (li === 0) ctx.font = `bold ${fontSize}px 'JetBrains Mono', monospace`;
      else ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;
      ctx.fillText(lines[li], tx + padX, ty + padY + li * lineHeight);
    }
    ctx.restore();
  }
}

// ---- Preset padding ----
function padPresetOutputs(outputs) {
  const padded = new Array(N_OUTPUTS).fill(0.5);
  for (let i = 0; i < outputs.length && i < padded.length; i++) padded[i] = outputs[i];
  return padded;
}

// ---- Init ----
function init() {
  // Parse ?tame URL param
  const urlParams = new URLSearchParams(window.location.search);
  tameLevel = parseFloat(urlParams.get('tame') ?? '1');
  spreadLevel = parseFloat(urlParams.get('spread') ?? '0.6');
  if (isNaN(spreadLevel)) spreadLevel = 0.6;
  spreadLevel = Math.max(0, Math.min(1, spreadLevel));

  // IML — fresh random weights each boot, no state restoration
  iml = new IML(N_INPUTS, N_OUTPUTS, [32, 48, 64], 1000, 1.0, 0.00001);
  iml.setLogger(msg => console.log('[NISPS]', msg));

  // Canvas + Visualizer
  $canvas = document.getElementById('vis-canvas');
  visualizer = new FlowFieldVisualizer($canvas);

  // Synth visualizer
  $synthVisCanvas = document.getElementById('synth-vis-canvas');
  synthVisualizer = new SynthVisualizer($synthVisCanvas);

  // Synth
  c15 = new C15Bridge();
  c15.onStatusChange = msg => {
    const el = document.getElementById('synth-status');
    if (el) el.textContent = msg;
  };
  c15.loadParams();
  arpeggiator = new Arpeggiator(c15);
  midiInput = new MIDIInput(c15);
  initMIDIControls();

  // DOM refs
  $heatmapCells = document.getElementById('heatmap-cells');
  $heatmapTooltip = document.getElementById('heatmap-tooltip');

  $joystickContainer = document.getElementById('joystick-container');
  $joyMap = document.getElementById('joy-map');
  $joyMapCtx = $joyMap.getContext('2d');
  $noiseRing = document.getElementById('noise-ring');
  $followBadge = document.getElementById('follow-badge');

  $rlButtons = document.getElementById('rl-buttons');
  $btnThumbsUp = document.getElementById('btn-thumbsup');
  $btnThumbsDown = document.getElementById('btn-thumbsdown');

  $bottomSheet = document.getElementById('bottom-sheet');
  $statusText = document.getElementById('status-text');

  $sheetContent = document.getElementById('sheet-content');
  $synthPanel = document.getElementById('synth-panel');
  $lossCanvas = document.getElementById('loss-canvas');
  $lossCtx = $lossCanvas.getContext('2d');
  $rawParams = document.getElementById('raw-params');

  $floatingBar = document.getElementById('floating-bar');
  $chevronBtn = document.getElementById('chevron-btn');
  $followPill = document.getElementById('follow-pill');

  // Build heatmap cells
  buildHeatmap();

  // Build raw param sliders
  buildRawParams();

  // Wire events
  wireJoystick();
  wireBottomSheet();
  wireControls();
  wireSynthControls();
  wireGamepad();
  wireKeyboard();
  wireQuickPlayControls();
  wireGroupDrawer();

  // Resize
  window.addEventListener('resize', onResize);
  onResize();

  // Restore saved state (if any)
  loadState();

  // Initial inference
  iml.setInput(0, joyX);
  iml.setInput(1, joyY);
  iml.process();
  routeOutputs(iml.getOutputs());
  updateHeatmap(iml.getOutputs());
  updateStatus();
  drawJoyMap();
  drawLossPlot();

  // Auto-save every 10 seconds
  setInterval(saveState, 10000);

  // Start animation
  requestAnimationFrame(animate);
}

// ---- Heatmap (bar chart style) ----
function buildHeatmap() {
  $heatmapCells.innerHTML = '';
  const isSynth = outputMode === 'synth';
  const count = isSynth ? N_SYNTH_OUTPUTS : N_VISUAL_OUTPUTS;
  const names = isSynth ? SYNTH_PARAM_NAMES : VISUAL_PARAM_NAMES;
  const colors = isSynth ? SYNTH_PARAM_COLORS : VISUAL_PARAM_COLORS;

  for (let i = 0; i < count; i++) {
    const cell = document.createElement('div');
    cell.className = 'heatmap-cell';
    cell.dataset.index = i;

    const bar = document.createElement('div');
    bar.className = 'heatmap-cell-bar';
    bar.style.background = colors[i];
    bar.style.width = '30%'; // default
    bar.style.height = '100%';
    cell.appendChild(bar);

    cell.addEventListener('pointerenter', (e) => {
      const outputs = iml.getOutputs();
      $heatmapTooltip.textContent = `${names[i]}: ${outputs[i].toFixed(3)}`;
      $heatmapTooltip.classList.add('visible');
      const rect = cell.getBoundingClientRect();
      $heatmapTooltip.style.left = `${rect.left}px`;
    });
    cell.addEventListener('pointerleave', () => {
      $heatmapTooltip.classList.remove('visible');
    });

    $heatmapCells.appendChild(cell);
  }
}

function updateHeatmap(outputs) {
  const cells = $heatmapCells.children;
  for (let i = 0; i < cells.length && i < outputs.length; i++) {
    const bar = cells[i].querySelector('.heatmap-cell-bar');
    if (bar) {
      const pct = Math.max(2, Math.round(outputs[i] * 100));
      bar.style.width = pct + '%';
    }
  }
}

// ---- Joy Map (merged joystick + minimap) ----
function drawJoyMap() {
  const canvas = $joyMap;
  const ctx = $joyMapCtx;
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const r = w / 2 - 2;

  // Clear with circle clip
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  // Background
  ctx.fillStyle = 'rgba(13, 13, 13, 0.7)';
  ctx.fillRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 0.5;
  for (let frac = 0.25; frac < 1; frac += 0.25) {
    ctx.beginPath();
    ctx.moveTo(frac * w, 0); ctx.lineTo(frac * w, h);
    ctx.moveTo(0, frac * h); ctx.lineTo(w, frac * h);
    ctx.stroke();
  }

  // Ring border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Training example dots
  const features = iml.dataset.features;
  const labels = iml.dataset.labels;

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

  // Current position knob (accent dot with glow)
  const px = joyX * w;
  const py = (1 - joyY) * h;

  // Glow
  ctx.shadowColor = 'rgba(255, 106, 0, 0.6)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgba(255, 106, 0, 0.9)';
  ctx.beginPath();
  ctx.arc(px, py, 8, 0, Math.PI * 2);
  ctx.fill();

  // Inner bright dot
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.beginPath();
  ctx.arc(px, py, 3, 0, Math.PI * 2);
  ctx.fill();

  // Crosshair
  ctx.strokeStyle = 'rgba(255, 106, 0, 0.2)';
  ctx.lineWidth = 0.5;
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.moveTo(px, 0); ctx.lineTo(px, h);
  ctx.moveTo(0, py); ctx.lineTo(w, py);
  ctx.stroke();

  ctx.restore();
}

// ---- Joystick ----
function wireJoystick() {
  const canvas = $joyMap;
  let startX, startY, startJX, startJY;
  let lastDoubleTap = 0;

  function onStart(e) {
    e.preventDefault();
    const touch = e.touches ? e.touches[0] : e;

    // Double-tap detection for follow mode
    const now = Date.now();
    if (now - lastDoubleTap < 350) {
      toggleFollowMode();
      lastDoubleTap = 0;
      return;
    }
    lastDoubleTap = now;

    // Snap to tap position within the circle
    const rect = canvas.getBoundingClientRect();
    const size = rect.width;
    const dx = touch.clientX - rect.left - size / 2;
    const dy = touch.clientY - rect.top - size / 2;
    const maxR = size / 2 - 8;

    joyX = Math.max(0, Math.min(1, 0.5 + (dx / maxR) * 0.5));
    joyY = Math.max(0, Math.min(1, 0.5 - (dy / maxR) * 0.5));

    drawJoyMap();
    onJoystickMove();

    joyDragging = true;
    startX = touch.clientX;
    startY = touch.clientY;
    startJX = joyX;
    startJY = joyY;
  }

  function onMove(e) {
    if (!joyDragging && !joyFollowMode) return;
    e.preventDefault();
    const touch = e.touches ? e.touches[0] : e;

    if (joyFollowMode) {
      joyX = Math.max(0, Math.min(1, touch.clientX / window.innerWidth));
      joyY = Math.max(0, Math.min(1, 1 - touch.clientY / window.innerHeight));
    } else if (joyDragging) {
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const size = canvas.getBoundingClientRect().width;
      const maxR = size / 2 - 8;
      const scale = 1 / maxR;

      joyX = Math.max(0, Math.min(1, startJX + dx * scale * 0.5));
      joyY = Math.max(0, Math.min(1, startJY - dy * scale * 0.5));
    }

    drawJoyMap();
    onJoystickMove();
  }

  function onEnd() {
    joyDragging = false;
  }

  canvas.addEventListener('pointerdown', onStart);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onEnd);
  window.addEventListener('pointercancel', onEnd);

  // Follow mode: track pointer on main canvas when active
  $canvas.addEventListener('pointermove', (e) => {
    if (!joyFollowMode) return;
    joyX = Math.max(0, Math.min(1, e.clientX / window.innerWidth));
    joyY = Math.max(0, Math.min(1, 1 - e.clientY / window.innerHeight));
    drawJoyMap();
    onJoystickMove();
  });
}

function toggleFollowMode() {
  joyFollowMode = !joyFollowMode;
  console.log('[Joystick] Follow mode:', joyFollowMode);
  updateFollowUI();
}

function updateFollowUI() {
  if (joyFollowMode) {
    $followBadge.classList.remove('hidden');
    $joystickContainer.classList.add('follow-active');
    $followPill.classList.add('active');
  } else {
    $followBadge.classList.add('hidden');
    $joystickContainer.classList.remove('follow-active');
    $followPill.classList.remove('active');
  }
}

function onJoystickMove() {
  iml.setInput(0, joyX);
  iml.setInput(1, joyY);
  iml.process();

  const outputs = iml.getOutputs();
  routeOutputs(outputs);
  updateHeatmap(outputs);

  syncRawParamsFromOutputs(outputs);

  // Trail
  joyTrail.push({ x: joyX, y: joyY, t: Date.now() });
  if (joyTrail.length > 30) joyTrail.shift();
}

// ---- Output routing ----
function routeOutputs(outputs) {
  if (outputMode === 'synth') {
    // Synth mode: synth visualizer + C15
    // Apply group overrides before visualization and C15
    const overridden = new Array(outputs.length);
    for (let i = 0; i < outputs.length; i++) {
      overridden[i] = applyGroupOverrides(outputs[i], i);
    }
    synthVisualizer.setParams(overridden);
    if (c15 && c15.running) {
      for (let i = 0; i < overridden.length && i < SYNTH_PARAM_MAP.length; i++) {
        const tamed = applyTame(overridden[i], SYNTH_PARAM_MAP[i], tameLevel);
        c15.setParameter(SYNTH_PARAM_MAP[i].id, tamed);
      }
    }
  } else {
    // Visual mode: flow field uses first 20
    visualizer.setParams(outputs.slice(0, N_VISUAL_OUTPUTS));
  }
}

// ---- Bottom sheet ----
function wireBottomSheet() {
  // Chevron toggle
  $chevronBtn.addEventListener('click', () => {
    sheetExpanded = !sheetExpanded;
    if (sheetExpanded) {
      $bottomSheet.classList.add('expanded');
      $chevronBtn.classList.add('open');
    } else {
      $bottomSheet.classList.remove('expanded');
      $chevronBtn.classList.remove('open');
    }
  });

  // Follow pill toggle
  $followPill.addEventListener('click', () => {
    toggleFollowMode();
  });
}

// ---- Controls wiring ----
function wireControls() {
  // Output mode toggle (floating bar)
  document.querySelectorAll('#output-toggle-float .pill-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      syncOutputToggles(btn.dataset.mode);
      setOutputMode(btn.dataset.mode);
    });
  });

  // Action buttons
  document.getElementById('btn-add-example').addEventListener('click', onAddExample);
  document.getElementById('btn-train').addEventListener('click', onTrain);
  document.getElementById('btn-train-bar').addEventListener('click', onTrain);
  document.getElementById('btn-clear').addEventListener('click', onClear);
  document.getElementById('btn-clear-examples').addEventListener('click', onClearExamples);
  document.getElementById('btn-clear-examples-bar').addEventListener('click', onClearExamples);
  document.getElementById('btn-randomize').addEventListener('click', onRandomize);
  document.getElementById('btn-randomize-bar').addEventListener('click', onRandomize);

  // RL buttons
  $btnThumbsUp.addEventListener('click', onThumbsUp);
  $btnThumbsDown.addEventListener('click', onThumbsDown);

  // Presets
  document.querySelectorAll('.preset-chip').forEach(chip => {
    chip.addEventListener('click', () => loadPreset(chip.dataset.preset));
  });

  // Initial noise ring update
  updateNoiseRing();
}

function syncOutputToggles(mode) {
  document.querySelectorAll('#output-toggle-float .pill-opt').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}

function setOutputMode(mode) {
  outputMode = mode;
  hideGroupDrawer();
  buildHeatmap();
  updateHeatmap(iml.getOutputs());

  const heatmapStrip = document.getElementById('heatmap-strip');
  const synthQuickControls = document.getElementById('synth-quick-controls');

  if (mode === 'synth') {
    $synthPanel.classList.remove('hidden');
    $canvas.classList.add('hidden-canvas');
    $synthVisCanvas.classList.add('active');
    heatmapStrip.classList.add('hidden');
    synthQuickControls.classList.remove('hidden');
    synthVisualizer.enableInteraction(true);
    // Pulse play button if audio not yet started
    const qp = document.getElementById('quick-play');
    if (qp) qp.classList.toggle('audio-needs-init', !(c15 && c15.running));
  } else {
    $synthPanel.classList.add('hidden');
    $canvas.classList.remove('hidden-canvas');
    $synthVisCanvas.classList.remove('active');
    heatmapStrip.classList.remove('hidden');
    synthQuickControls.classList.add('hidden');
    synthVisualizer.enableInteraction(false);
  }

  routeOutputs(iml.getOutputs());
  buildRawParams();
  syncRawParamsFromOutputs(iml.getOutputs());
}

function updateNoiseRing() {
  if (noiseLevel > 0.15) {
    $noiseRing.className = 'noise-ring active high';
  } else if (noiseLevel > 0.01) {
    $noiseRing.className = 'noise-ring active';
  } else {
    $noiseRing.className = 'noise-ring';
  }
}

// ---- Examples mode ----
function onAddExample() {
  const inputs = [joyX, joyY];
  const outputs = [...rawParamValues];
  iml.addExample(inputs, outputs);
  updateStatus();
  drawJoyMap();
  flash('btn-add-example');
}

function onTrain() {
  const loss = trainModel();
  if (loss !== null) {
    const outputs = iml.getOutputs();
    routeOutputs(outputs);
    updateHeatmap(outputs);
    syncRawParamsFromOutputs(outputs);
    updateStatus();
    drawLossPlot();
    drawJoyMap();
    flash('btn-train');
  }
}

function onRandomize() {
  iml.randomiseWeights(spreadLevel);
  iml.setInput(0, joyX);
  iml.setInput(1, joyY);
  iml.process();
  const outputs = iml.getOutputs();
  routeOutputs(outputs);
  updateHeatmap(outputs);
  syncRawParamsFromOutputs(outputs);
  noiseLevel = 0.05;
  updateStatus();
}

function onClearExamples() {
  iml.clearDataset();
  updateStatus();
  drawJoyMap();
}

function onClear() {
  iml.clearDataset();
  iml.lossHistory = [];
  iml.bestLoss = null;
  iml.totalTrainingIterations = 0;
  noiseLevel = 0.05;
  clearState();
  updateStatus();
  drawLossPlot();
  drawJoyMap();
}

// ---- RL mode ----
function onThumbsUp() {
  const inputs = [joyX, joyY];
  const outputs = [...iml.getOutputs()];
  iml.addExample(inputs, outputs);

  trainModel();
  const trainedOutputs = iml.getOutputs();
  routeOutputs(trainedOutputs);
  updateHeatmap(trainedOutputs);
  syncRawParamsFromOutputs(trainedOutputs);

  noiseLevel *= rlExplorationDecay;
  noiseLevel = Math.max(noiseLevel, 0.005);

  updateStatus();
  drawLossPlot();
  drawJoyMap();
  updateNoiseRing();
  flash('btn-thumbsup');
}

function onThumbsDown() {
  const noiseCap = 0.3 * (1 - spreadLevel) + 0.05 * spreadLevel;
  noiseLevel = Math.min(noiseLevel * 1.5, noiseCap);

  iml.moveWeights(noiseLevel, spreadLevel);

  const outputs = iml.getOutputs();
  routeOutputs(outputs);
  updateHeatmap(outputs);
  syncRawParamsFromOutputs(outputs);
  updateStatus();
  updateNoiseRing();
  flash('btn-thumbsdown');
}

// ---- Training ----
function trainModel() {
  const loss = iml.train({
    onIteration: (iter, iterLoss) => {
      if (iter % 8 !== 0) return;
      drawLossPlot();
    },
  });
  return loss;
}

// ---- Presets ----
function loadPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;

  iml.clearDataset();
  for (const ex of preset) {
    iml.addExample(ex.input, padPresetOutputs(ex.output));
  }

  const loss = trainModel();
  const outputs = iml.getOutputs();
  routeOutputs(outputs);
  updateHeatmap(outputs);
  syncRawParamsFromOutputs(outputs);
  updateStatus();
  drawLossPlot();
  drawJoyMap();
}

// ---- Status ----
function updateStatus() {
  const count = iml.exampleCount;
  const loss = iml.lastLoss;
  let text = `${count} example${count !== 1 ? 's' : ''}`;

  if (loss !== null) {
    text += ` \u00b7 loss ${loss.toFixed(5)}`;
  } else {
    text += ' \u00b7 untrained';
  }

  text += ` \u00b7 noise ${noiseLevel.toFixed(3)}`;

  $statusText.textContent = text;
}

// ---- Loss plot ----
function drawLossPlot() {
  const ctx = $lossCtx;
  const w = $lossCanvas.width;
  const h = $lossCanvas.height;
  const history = iml.lossHistory;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fillRect(0, 0, w, h);

  if (history.length < 2) return;

  const maxLoss = Math.max(...history.slice(-200)) || 1;
  const points = history.slice(-200);

  ctx.strokeStyle = 'rgba(255, 106, 0, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  for (let i = 0; i < points.length; i++) {
    const x = (i / (points.length - 1)) * w;
    const y = h - (points[i] / maxLoss) * h * 0.9;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ---- Raw param sliders ----
function buildRawParams() {
  $rawParams.innerHTML = '';
  const isSynth = outputMode === 'synth';
  const count = isSynth ? N_SYNTH_OUTPUTS : N_VISUAL_OUTPUTS;
  const names = isSynth ? SYNTH_PARAM_NAMES : VISUAL_PARAM_NAMES;

  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'raw-param';
    row.dataset.tooltip = `${names[i]}: ${rawParamValues[i].toFixed(2)}`;

    const label = document.createElement('span');
    label.className = 'raw-param-label';
    label.textContent = names[i];

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.01';
    slider.value = rawParamValues[i];
    slider.dataset.index = i;

    const val = document.createElement('span');
    val.className = 'raw-param-val';
    val.textContent = rawParamValues[i].toFixed(2);

    slider.addEventListener('input', () => {
      const idx = parseInt(slider.dataset.index);
      rawParamValues[idx] = parseFloat(slider.value);
      val.textContent = rawParamValues[idx].toFixed(2);
      row.dataset.tooltip = `${names[idx]}: ${rawParamValues[idx].toFixed(2)}`;
      routeOutputs(rawParamValues);
      updateHeatmap(rawParamValues);
    });

    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(val);
    $rawParams.appendChild(row);
  }
}

function syncRawParamsFromOutputs(outputs) {
  rawParamValues = [...outputs];
  const rows = $rawParams.querySelectorAll('.raw-param');
  rows.forEach((row, i) => {
    if (i < outputs.length) {
      const s = row.querySelector('input[type="range"]');
      if (s) {
        s.value = outputs[i];
        s.nextElementSibling.textContent = outputs[i].toFixed(2);
      }
      const name = row.querySelector('.raw-param-label')?.textContent || `p${i}`;
      row.dataset.tooltip = `${name}: ${outputs[i].toFixed(2)}`;
    }
  });
}

// ---- Synth controls ----
function wireSynthControls() {
  const startBtn = document.getElementById('synth-start');
  const volumeSlider = document.getElementById('synth-volume');
  const arpToggle = document.getElementById('arp-toggle');
  const arpProgression = document.getElementById('arp-progression');
  const arpTempo = document.getElementById('arp-tempo');
  const arpOctaves = document.getElementById('arp-octaves');
  const arpOffset = document.getElementById('arp-offset');

  startBtn.addEventListener('click', async () => {
    const quickPlay = document.getElementById('quick-play');
    if (c15.running) {
      arpeggiator.stop();
      arpToggle.textContent = 'Play';
      await c15.stop();
      startBtn.textContent = 'Start Audio';
      if (quickPlay) quickPlay.classList.add('audio-needs-init');
    } else {
      await c15.start();
      startBtn.textContent = 'Stop Audio';
      if (quickPlay) quickPlay.classList.remove('audio-needs-init');
      routeOutputs(iml.getOutputs());
    }
  });

  volumeSlider.addEventListener('input', (e) => {
    c15.setMasterVolume(parseFloat(e.target.value));
  });

  arpToggle.addEventListener('click', () => {
    if (!c15.running) return;
    if (arpeggiator.playing) {
      arpeggiator.stop();
      arpToggle.textContent = 'Play';
    } else {
      arpeggiator.start();
      arpToggle.textContent = 'Stop';
    }
  });

  arpProgression.addEventListener('change', (e) => {
    arpeggiator.progression = e.target.value;
  });

  arpTempo.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    arpeggiator.bpm = val;
    document.getElementById('tempo-val').textContent = val;
  });

  arpOctaves.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    arpeggiator.octaves = val;
    document.getElementById('octaves-val').textContent = val;
  });

  arpOffset.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    arpeggiator.octaveOffset = val;
    document.getElementById('offset-val').textContent = val;
  });
}

// ---- MIDI Input ----
async function initMIDIControls() {
  const row = document.getElementById('midi-row');
  const statusRow = document.getElementById('midi-status-row');
  const toggle = document.getElementById('midi-toggle');
  const select = document.getElementById('midi-select');
  const statusEl = document.getElementById('midi-status');
  if (!row || !toggle || !select) return;

  const available = await midiInput.init();
  if (!available) return;

  row.style.display = '';

  function populateInputs() {
    const inputs = midiInput.getInputs();
    select.innerHTML = '<option value="">All Inputs</option>' +
      inputs.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
  }

  populateInputs();
  midiInput.onInputsChange = () => populateInputs();

  midiInput.onStatusChange = (msg) => {
    if (statusEl) {
      statusEl.textContent = msg;
      statusRow.style.display = '';
    }
  };

  midiInput.onCC = (cc, value) => {
    if (cc === 1) { joyX = value; onJoystickMove(); drawJoyMap(); }
    if (cc === 2) { joyY = value; onJoystickMove(); drawJoyMap(); }
  };

  toggle.addEventListener('click', () => {
    if (!c15.running) return;
    midiInput.toggle();
    toggle.textContent = midiInput.enabled ? 'Disable' : 'Enable';
    toggle.classList.toggle('playing', midiInput.enabled);
  });

  select.addEventListener('change', (e) => {
    midiInput.selectInput(e.target.value || null);
  });
}

// ---- Gamepad ----
function wireGamepad() {
  gamepad = new GamepadInput({
    invertY: true,
    onMove: (x, y) => {
      joyX = x;
      joyY = y;
      drawJoyMap();
      onJoystickMove();
    },
    onButton: (btn) => {
      if (btn === 'rb') onThumbsUp();
      if (btn === 'lb') onThumbsDown();
    },
    onConnectionChange: (connected) => {
      const el = document.getElementById('gamepad-status');
      if (el) el.textContent = connected ? 'Gamepad connected' : '';
    },
  });
}

// ---- Keyboard ----
function wireKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;

    if (e.key === 'Escape') {
      if (sheetExpanded) {
        sheetExpanded = false;
        $bottomSheet.classList.remove('expanded');
        $chevronBtn.classList.remove('open');
        return;
      }
    }

    // Don't intercept keys when an input/select has focus
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (e.key === '1' || e.code === 'Numpad1') {
      e.preventDefault();
      onThumbsDown();
    } else if (e.key === '2' || e.code === 'Numpad2') {
      e.preventDefault();
      onThumbsUp();
    }
  });
}

// ---- Quick play controls ----
function wireQuickPlayControls() {
  const quickPlay = document.getElementById('quick-play');
  const quickPlayIcon = document.getElementById('quick-play-icon');
  const quickVol = document.getElementById('quick-vol');
  const quickBpm = document.getElementById('quick-bpm');
  const quickBpmVal = document.getElementById('quick-bpm-val');

  const playIconSVG = '<path d="M4 2l10 6-10 6z"/>';
  const pauseIconSVG = '<rect x="3" y="2" width="4" height="12"/><rect x="9" y="2" width="4" height="12"/>';

  function updatePlayIcon() {
    const isPlaying = c15 && c15.running;
    quickPlayIcon.innerHTML = isPlaying ? pauseIconSVG : playIconSVG;
    quickPlay.classList.toggle('playing', isPlaying);
    quickPlay.classList.toggle('audio-needs-init', !isPlaying);
  }

  quickPlay.addEventListener('click', async () => {
    if (c15.running) {
      arpeggiator.stop();
      await c15.stop();
      // Also update the bottom sheet controls
      const startBtn = document.getElementById('synth-start');
      const arpToggle = document.getElementById('arp-toggle');
      if (startBtn) startBtn.textContent = 'Start Audio';
      if (arpToggle) arpToggle.textContent = 'Play';
    } else {
      await c15.start();
      arpeggiator.start();
      routeOutputs(iml.getOutputs());
      // Also update the bottom sheet controls
      const startBtn = document.getElementById('synth-start');
      const arpToggle = document.getElementById('arp-toggle');
      if (startBtn) startBtn.textContent = 'Stop Audio';
      if (arpToggle) arpToggle.textContent = 'Stop';
    }
    updatePlayIcon();
  });

  quickVol.addEventListener('input', (e) => {
    c15.setMasterVolume(parseFloat(e.target.value));
    // Sync with bottom sheet volume slider
    const sheetVol = document.getElementById('synth-volume');
    if (sheetVol) sheetVol.value = e.target.value;
  });

  quickBpm.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    arpeggiator.bpm = val;
    quickBpmVal.textContent = val;
    // Sync with bottom sheet tempo slider
    const sheetTempo = document.getElementById('arp-tempo');
    const sheetTempoVal = document.getElementById('tempo-val');
    if (sheetTempo) sheetTempo.value = val;
    if (sheetTempoVal) sheetTempoVal.textContent = val;
  });
}

// ---- Group Override Drawer ----
let $groupDrawer = null;
let activeDrawerSection = -1;
let drawerHideTimer = null;

function wireGroupDrawer() {
  // Create the drawer DOM element once
  $groupDrawer = document.createElement('div');
  $groupDrawer.className = 'group-drawer';
  $groupDrawer.innerHTML = '<div class="group-drawer-header"></div><div class="group-drawer-body"></div>';
  document.body.appendChild($groupDrawer);

  // Keep drawer open while hovering over it
  $groupDrawer.addEventListener('pointerenter', () => {
    clearTimeout(drawerHideTimer);
  });
  $groupDrawer.addEventListener('pointerleave', () => {
    drawerHideTimer = setTimeout(() => hideGroupDrawer(), 300);
  });

  // Detect hover over section labels on the synth vis canvas
  $synthVisCanvas.addEventListener('pointermove', (e) => {
    if (outputMode !== 'synth') return;
    const region = synthVisualizer.hitTestSection(e.clientX, e.clientY);
    if (region) {
      clearTimeout(drawerHideTimer);
      if (activeDrawerSection !== region.index) {
        showGroupDrawer(region);
      }
    } else {
      // Leaving section label area, delay hide
      if (activeDrawerSection >= 0) {
        drawerHideTimer = setTimeout(() => hideGroupDrawer(), 300);
      }
    }
  });

  // Also handle click for mobile
  $synthVisCanvas.addEventListener('pointerdown', (e) => {
    if (outputMode !== 'synth') return;
    const region = synthVisualizer.hitTestSection(e.clientX, e.clientY);
    if (region) {
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(drawerHideTimer);
      if (activeDrawerSection === region.index) {
        hideGroupDrawer();
      } else {
        showGroupDrawer(region);
      }
    }
  }, true); // capture phase so it fires before bar interaction
}

function showGroupDrawer(region) {
  activeDrawerSection = region.index;
  const sec = SYNTH_SECTIONS[region.index];
  const ov = groupOverrides[region.index];

  // Find global param start index for this section
  let paramStart = 0;
  for (let i = 0; i < region.index; i++) paramStart += SYNTH_SECTIONS[i].count;

  // Header with section name
  const header = $groupDrawer.querySelector('.group-drawer-header');
  header.textContent = sec.name;
  header.style.color = sec.color;

  // Body: group curve + per-param rows
  const body = $groupDrawer.querySelector('.group-drawer-body');
  body.innerHTML = '';

  // -- Group master curve (draggable canvas) --
  const curveRow = document.createElement('div');
  curveRow.className = 'gd-curve-row';

  const curveLabel = document.createElement('span');
  curveLabel.className = 'gd-label';
  curveLabel.textContent = 'Group';

  const curveCanvas = document.createElement('canvas');
  curveCanvas.className = 'gd-curve-canvas';
  curveCanvas.width = 48;
  curveCanvas.height = 48;

  const curveVal = document.createElement('span');
  curveVal.className = 'gd-val';
  curveVal.textContent = ov.curve.toFixed(2);

  function drawGroupCurvePreview() {
    _drawCurveOnCanvas(curveCanvas, ov.curve, sec.color);
  }

  // Vertical drag on group curve — applies relative delta to all param curves
  {
    let dragging = false, startY = 0, startGroupCurve = 0, startParamCurves = [];
    curveCanvas.style.cursor = 'ns-resize';
    curveCanvas.style.touchAction = 'none';
    curveCanvas.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      dragging = true;
      startY = e.clientY;
      startGroupCurve = ov.curve;
      startParamCurves = ov.params.map(p => p.curve);
      curveCanvas.setPointerCapture(e.pointerId);
    });
    curveCanvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      e.preventDefault();
      const dy = e.clientY - startY;
      const delta = dy / 80;
      const newGroup = Math.max(0, Math.min(1, startGroupCurve + delta));
      ov.curve = newGroup;
      curveVal.textContent = newGroup.toFixed(2);
      // Apply same delta to each param, preserving relative offsets
      for (let i = 0; i < ov.params.length; i++) {
        ov.params[i].curve = Math.max(0, Math.min(1, startParamCurves[i] + delta));
      }
      drawGroupCurvePreview();
      body.querySelectorAll('.gd-param-curve-canvas').forEach(c => {
        if (c._redraw) c._redraw();
      });
      routeOutputs(iml.getOutputs());
    });
    curveCanvas.addEventListener('pointerup', () => { dragging = false; });
    curveCanvas.addEventListener('pointercancel', () => { dragging = false; });
  }

  curveRow.appendChild(curveLabel);
  curveRow.appendChild(curveCanvas);
  curveRow.appendChild(curveVal);
  body.appendChild(curveRow);
  drawGroupCurvePreview();

  // -- Per-param rows --
  for (let li = 0; li < sec.count; li++) {
    const pi = paramStart + li;
    if (pi >= SYNTH_PARAM_MAP.length) break;
    const param = SYNTH_PARAM_MAP[pi];
    const pov = ov.params[li];

    const row = document.createElement('div');
    row.className = 'gd-param-row';
    if (pov.muted) row.classList.add('gd-muted');

    // Name
    const nameSpan = document.createElement('span');
    nameSpan.className = 'gd-param-name';
    nameSpan.textContent = param.label;

    // Per-param curve canvas (vertically draggable, no slider)
    const pCurveCanvas = document.createElement('canvas');
    pCurveCanvas.className = 'gd-param-curve-canvas';
    pCurveCanvas.width = 28;
    pCurveCanvas.height = 28;
    pCurveCanvas._redraw = () => _drawCurveOnCanvas(pCurveCanvas, pov.curve, sec.color);

    _wireCurveDrag(pCurveCanvas, () => pov.curve, (v) => {
      pov.curve = v;
      pCurveCanvas._redraw();
      routeOutputs(iml.getOutputs());
    });
    pCurveCanvas._redraw();

    // Dual-range slider (min/max as two overlapping range inputs)
    const rangeWrap = document.createElement('div');
    rangeWrap.className = 'gd-range-wrap';

    const rangeFill = document.createElement('div');
    rangeFill.className = 'gd-range-fill';

    const minSlider = document.createElement('input');
    minSlider.type = 'range'; minSlider.min = '0'; minSlider.max = '1'; minSlider.step = '0.01';
    minSlider.value = pov.min;
    minSlider.className = 'gd-range-input gd-range-min';

    const maxSlider = document.createElement('input');
    maxSlider.type = 'range'; maxSlider.min = '0'; maxSlider.max = '1'; maxSlider.step = '0.01';
    maxSlider.value = pov.max;
    maxSlider.className = 'gd-range-input gd-range-max';

    // Value slider (shown when muted)
    const valSlider = document.createElement('input');
    valSlider.type = 'range'; valSlider.min = '0'; valSlider.max = '1'; valSlider.step = '0.01';
    valSlider.value = pov.fixedValue;
    valSlider.className = 'gd-val-slider';

    function updateRangeFill() {
      rangeFill.style.left = `${pov.min * 100}%`;
      rangeFill.style.width = `${(pov.max - pov.min) * 100}%`;
    }
    updateRangeFill();

    minSlider.addEventListener('input', () => {
      pov.min = parseFloat(minSlider.value);
      if (pov.min > pov.max) { pov.max = pov.min; maxSlider.value = pov.max; }
      updateRangeFill();
      routeOutputs(iml.getOutputs());
    });
    maxSlider.addEventListener('input', () => {
      pov.max = parseFloat(maxSlider.value);
      if (pov.max < pov.min) { pov.min = pov.max; minSlider.value = pov.min; }
      updateRangeFill();
      routeOutputs(iml.getOutputs());
    });
    valSlider.addEventListener('input', () => {
      pov.fixedValue = parseFloat(valSlider.value);
      routeOutputs(iml.getOutputs());
    });

    rangeWrap.appendChild(rangeFill);
    rangeWrap.appendChild(minSlider);
    rangeWrap.appendChild(maxSlider);

    // Mute toggle
    const muteBtn = document.createElement('button');
    muteBtn.className = 'gd-mute-btn' + (pov.muted ? ' muted' : '');
    muteBtn.textContent = pov.muted ? 'M' : 'M';
    muteBtn.title = pov.muted ? 'Unmute (re-enable NISPS control)' : 'Mute (remove from NISPS)';

    muteBtn.addEventListener('click', () => {
      pov.muted = !pov.muted;
      muteBtn.classList.toggle('muted', pov.muted);
      muteBtn.title = pov.muted ? 'Unmute (re-enable NISPS control)' : 'Mute (remove from NISPS)';
      row.classList.toggle('gd-muted', pov.muted);
      routeOutputs(iml.getOutputs());
    });

    row.appendChild(nameSpan);
    row.appendChild(pCurveCanvas);
    row.appendChild(rangeWrap);
    row.appendChild(valSlider);
    row.appendChild(muteBtn);
    body.appendChild(row);
  }

  // Position the drawer below the section label
  const canvasRect = $synthVisCanvas.getBoundingClientRect();
  const centerX = (region.left + region.right) / 2 + canvasRect.left;
  const topY = region.bottom + canvasRect.top + 4;

  const drawerWidth = 320;
  let left = centerX - drawerWidth / 2;
  left = Math.max(4, Math.min(left, window.innerWidth - drawerWidth - 4));

  $groupDrawer.style.left = `${left}px`;
  $groupDrawer.style.top = `${topY}px`;
  $groupDrawer.classList.add('visible');
}

/** Draw a curve preview on a canvas element */
function _drawCurveOnCanvas(canvas, curveFactor, color) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(0, 0, w, h);

  // Linear reference
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(w, 0);
  ctx.stroke();

  // Curve
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.min(2, w / 16);
  ctx.beginPath();
  const steps = 30;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const v = applyCurve(t, curveFactor);
    const px = t * w;
    const py = (1 - v) * h;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

/** Wire vertical drag on a canvas to control a curve factor */
function _wireCurveDrag(canvas, getter, setter) {
  let dragging = false;
  let startY = 0;
  let startVal = 0;

  canvas.style.cursor = 'ns-resize';
  canvas.style.touchAction = 'none';

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    startY = e.clientY;
    startVal = getter();
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    e.preventDefault();
    // Drag down = more exponential (higher curve), drag up = more logarithmic (lower curve)
    const dy = e.clientY - startY;
    const newVal = Math.max(0, Math.min(1, startVal + dy / 80));
    setter(newVal);
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', () => { dragging = false; });
}

function hideGroupDrawer() {
  activeDrawerSection = -1;
  if ($groupDrawer) $groupDrawer.classList.remove('visible');
}

// ---- Resize ----
function onResize() {
  hideGroupDrawer();
  visualizer.resize();
  visualizer.initParticles();
  synthVisualizer.resize();

  // Resize joy-map canvas to match container
  const size = $joystickContainer.offsetWidth;
  if (size > 0) {
    $joyMap.width = size;
    $joyMap.height = size;
    drawJoyMap();
  }
}

// ---- Animation ----
function animate() {
  if (gamepad) gamepad.poll();
  if (outputMode === 'synth') {
    synthVisualizer.draw();
  } else {
    visualizer.draw();
  }
  requestAnimationFrame(animate);
}

// ---- Utility ----
function flash(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 250);
}

// ---- Persistence ----
function saveState() {
  try {
    const state = {
      features: iml.dataset.features,
      labels: iml.dataset.labels,
      noiseLevel,
      outputMode,
      joyX,
      joyY,
      groupOverrides,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[NISPS] Failed to save state:', e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);

    // Restore training data (pad old 20-element labels to N_OUTPUTS)
    if (state.features && state.labels && state.features.length > 0) {
      for (let i = 0; i < state.features.length; i++) {
        iml.addExample(state.features[i], padPresetOutputs(state.labels[i]));
      }
      // Retrain with restored data
      trainModel();
      routeOutputs(iml.getOutputs());
    }

    if (typeof state.noiseLevel === 'number') noiseLevel = state.noiseLevel;
    if (typeof state.joyX === 'number') joyX = state.joyX;
    if (typeof state.joyY === 'number') joyY = state.joyY;

    // Restore group overrides
    if (state.groupOverrides && Array.isArray(state.groupOverrides)) {
      for (let si = 0; si < state.groupOverrides.length && si < groupOverrides.length; si++) {
        const saved = state.groupOverrides[si];
        if (typeof saved.curve === 'number') groupOverrides[si].curve = saved.curve;
        if (Array.isArray(saved.params)) {
          for (let li = 0; li < saved.params.length && li < groupOverrides[si].params.length; li++) {
            const sp = saved.params[li], gp = groupOverrides[si].params[li];
            if (typeof sp.min === 'number') gp.min = sp.min;
            if (typeof sp.max === 'number') gp.max = sp.max;
            if (typeof sp.curve === 'number') gp.curve = sp.curve;
            if (typeof sp.muted === 'boolean') gp.muted = sp.muted;
            if (typeof sp.fixedValue === 'number') gp.fixedValue = sp.fixedValue;
          }
        }
      }
    }

    // Restore output mode
    if (state.outputMode && state.outputMode !== outputMode) {
      setOutputMode(state.outputMode);
      syncOutputToggles(outputMode);
    }

    console.log(`[NISPS] Restored ${state.features?.length || 0} examples from storage`);
  } catch (e) {
    console.warn('[NISPS] Failed to load state:', e);
  }
}

function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('[NISPS] Failed to clear state:', e);
  }
}

// ---- Start ----
document.addEventListener('DOMContentLoaded', init);
