// NISPS Immersive — Design A
// Full-viewport flow field with floating overlays

import { IML } from './nisps/iml.js';
import { FlowFieldVisualizer } from './ui/visualizer.js';
import { C15Bridge } from './synth/c15-bridge.js';
import { Arpeggiator } from './synth/arpeggiator.js';
import { SYNTH_PARAM_MAP, SYNTH_PARAM_NAMES, SYNTH_PARAM_COLORS, applyTame } from './synth/param-map.js';

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

let learningMode = 'rl';
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
let gamepadIndex = -1;
let gamepadButtonsPrev = [];
let gamepadConnected = false;
let gamepadLastAxes = [0.5, 0.5];

// Raw param slider values (for examples mode advanced editing)
let rawParamValues = new Array(N_OUTPUTS).fill(0.5);

// ---- DOM refs ----
let $canvas, $heatmapCells, $heatmapTooltip;
let $joystickContainer, $joyMap, $joyMapCtx;
let $noiseRing, $followBadge;
let $rlButtons, $btnThumbsUp, $btnThumbsDown;
let $bottomSheet, $statusText;
let $sheetContent;
let $examplesActions, $presetRow;
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

    // Calculate section gap positions
    const sectionGaps = new Set();
    let ci = 0;
    for (const sec of SYNTH_SECTIONS) {
      ci += sec.count;
      if (ci < n) sectionGaps.add(ci);
    }

    const topPad = this.topPadding * dpr;
    const bottomPad = this.bottomPadding * dpr;
    const totalGapPx = sectionGaps.size * 2 * dpr;
    const barAreaWidth = W - totalGapPx;
    const barWidth = barAreaWidth / n;
    const usableHeight = H - topPad - bottomPad;
    const maxBarHeight = usableHeight;

    // Store layout for interaction hit-testing
    this._layout = { W, H, n, barWidth, totalGapPx, sectionGaps, topPad, bottomPad, usableHeight, dpr };

    // Draw bars
    let x = 0;
    let prevSection = this.sectionMap[0];
    let sectionStartX = 0;
    // Store bar x positions for hit testing
    this._barXPositions = [];

    for (let i = 0; i < n; i++) {
      const sec = this.sectionMap[i];

      // Section divider gap
      if (sectionGaps.has(i)) {
        // Draw section label for the previous section at top
        this._drawSectionLabel(ctx, prevSection.name, sectionStartX, x, topPad, prevSection.color);
        x += 2 * dpr;
        sectionStartX = x;
        prevSection = sec;
      }

      if (i === 0) {
        sectionStartX = x;
        prevSection = sec;
      }

      this._barXPositions[i] = x;

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
    }
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

  // Returns bar index at canvas-relative pixel x, or -1
  hitTest(clientX, clientY) {
    if (!this._barXPositions || !this._layout) return -1;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this._layout.dpr;
    const px = (clientX - rect.left) * dpr;
    const n = this._layout.n;
    const barWidth = this._layout.barWidth;

    for (let i = 0; i < n; i++) {
      const bx = this._barXPositions[i];
      if (px >= bx && px < bx + barWidth) return i;
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
        if (learningMode !== 'examples') return;
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
      if (this._onPointerDown) {
        this.canvas.removeEventListener('pointerdown', this._onPointerDown);
        this.canvas.removeEventListener('pointermove', this._onPointerMove);
        this.canvas.removeEventListener('pointerup', this._onPointerUp);
        this.canvas.removeEventListener('pointercancel', this._onPointerUp);
      }
    }
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
  tameLevel = parseFloat(urlParams.get('tame') ?? '0');
  spreadLevel = parseFloat(urlParams.get('spread') ?? '0');
  if (isNaN(spreadLevel)) spreadLevel = 0;
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
  $examplesActions = document.getElementById('examples-actions');
  $presetRow = document.getElementById('preset-row');
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

  // Update raw param sliders if not manually editing
  if (learningMode !== 'examples') {
    syncRawParamsFromOutputs(outputs);
  }

  // Trail
  joyTrail.push({ x: joyX, y: joyY, t: Date.now() });
  if (joyTrail.length > 30) joyTrail.shift();
}

// ---- Output routing ----
function routeOutputs(outputs) {
  if (outputMode === 'synth') {
    // Synth mode: synth visualizer + C15
    synthVisualizer.setParams(outputs);
    if (c15 && c15.running) {
      for (let i = 0; i < outputs.length && i < SYNTH_PARAM_MAP.length; i++) {
        const tamed = applyTame(outputs[i], SYNTH_PARAM_MAP[i], tameLevel);
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
  // Learning mode toggle
  document.querySelectorAll('#learning-toggle .pill-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#learning-toggle .pill-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      learningMode = btn.dataset.mode;
      updateModeUI();
    });
  });

  // Output mode toggle
  document.querySelectorAll('#output-toggle .pill-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#output-toggle .pill-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setOutputMode(btn.dataset.mode);
    });
  });

  // Action buttons
  document.getElementById('btn-add-example').addEventListener('click', onAddExample);
  document.getElementById('btn-train').addEventListener('click', onTrain);
  document.getElementById('btn-clear').addEventListener('click', onClear);
  document.getElementById('btn-randomize').addEventListener('click', onRandomize);
  document.getElementById('btn-randomize-bar').addEventListener('click', onRandomize);

  // RL buttons
  $btnThumbsUp.addEventListener('click', onThumbsUp);
  $btnThumbsDown.addEventListener('click', onThumbsDown);

  // Presets
  document.querySelectorAll('.preset-chip').forEach(chip => {
    chip.addEventListener('click', () => loadPreset(chip.dataset.preset));
  });

  updateModeUI();
}

function updateModeUI() {
  if (learningMode === 'rl') {
    $rlButtons.classList.remove('hidden');
    $examplesActions.style.display = 'none';
    $presetRow.style.display = 'none';
    updateNoiseRing();
  } else {
    $rlButtons.classList.add('hidden');
    $examplesActions.style.display = '';
    $presetRow.style.display = '';
    $noiseRing.className = 'noise-ring';
  }
  // Enable/disable synth bar interaction based on mode
  if (outputMode === 'synth') {
    synthVisualizer.enableInteraction(learningMode === 'examples');
  }
}

function setOutputMode(mode) {
  outputMode = mode;
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
    synthVisualizer.enableInteraction(learningMode === 'examples');
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
  if (learningMode !== 'rl') {
    $noiseRing.className = 'noise-ring';
    return;
  }
  if (noiseLevel > 0.15) {
    $noiseRing.className = 'noise-ring active high';
  } else if (noiseLevel > 0.03) {
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
  const outputs = iml.getOutputs();
  routeOutputs(outputs);
  updateHeatmap(outputs);
  syncRawParamsFromOutputs(outputs);
  noiseLevel = 0.05;
  updateStatus();
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

  noiseLevel *= rlExplorationDecay;
  noiseLevel = Math.max(noiseLevel, 0.005);

  updateStatus();
  drawLossPlot();
  drawJoyMap();
  updateNoiseRing();
  flash('btn-thumbsup');
}

function onThumbsDown() {
  noiseLevel = Math.min(noiseLevel * 1.5, 0.3);

  iml.moveWeights(noiseLevel);

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

  if (learningMode === 'rl') {
    text += ` \u00b7 noise ${noiseLevel.toFixed(3)}`;
  }

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
  const sliders = $rawParams.querySelectorAll('input[type="range"]');
  sliders.forEach((s, i) => {
    if (i < outputs.length) {
      s.value = outputs[i];
      s.nextElementSibling.textContent = outputs[i].toFixed(2);
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
    if (c15.running) {
      arpeggiator.stop();
      arpToggle.textContent = 'Play';
      await c15.stop();
      startBtn.textContent = 'Start Audio';
    } else {
      await c15.start();
      startBtn.textContent = 'Stop Audio';
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

// ---- Gamepad ----
function wireGamepad() {
  window.addEventListener('gamepadconnected', () => { gamepadConnected = true; });
  window.addEventListener('gamepaddisconnected', () => { gamepadConnected = false; gamepadIndex = -1; });
}

function pollGamepad() {
  if (!navigator.getGamepads) return;
  const gamepads = navigator.getGamepads();
  let gp = null;

  if (gamepadIndex >= 0 && gamepads[gamepadIndex]?.connected) {
    gp = gamepads[gamepadIndex];
  } else {
    gamepadIndex = -1;
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i]?.connected) {
        gp = gamepads[i];
        gamepadIndex = i;
        break;
      }
    }
  }

  if (!gp) { gamepadButtonsPrev = []; return; }

  const deadzone = 0.08;
  const rawX = gp.axes[0] || 0;
  const rawY = gp.axes[1] || 0;
  const axisX = Math.abs(rawX) < deadzone ? 0 : rawX;
  const axisY = Math.abs(rawY) < deadzone ? 0 : rawY;
  const mappedX = (axisX + 1) * 0.5;
  const mappedY = 1 - (axisY + 1) * 0.5;

  const moved = Math.abs(mappedX - gamepadLastAxes[0]) > 0.002 ||
                Math.abs(mappedY - gamepadLastAxes[1]) > 0.002;

  if (moved) {
    gamepadLastAxes = [mappedX, mappedY];
    joyX = mappedX;
    joyY = mappedY;
    drawJoyMap();
    onJoystickMove();
  }

  // LB=4, RB=5
  const lbPressed = !!gp.buttons[4]?.pressed;
  const rbPressed = !!gp.buttons[5]?.pressed;
  const lbPrev = !!gamepadButtonsPrev[4];
  const rbPrev = !!gamepadButtonsPrev[5];

  if (learningMode === 'rl') {
    if (rbPressed && !rbPrev) onThumbsUp();
    if (lbPressed && !lbPrev) onThumbsDown();
  }

  gamepadButtonsPrev[4] = lbPressed;
  gamepadButtonsPrev[5] = rbPressed;
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

    if (learningMode === 'rl') {
      if (e.key === '1' || e.code === 'Numpad1') {
        e.preventDefault();
        onThumbsDown();
      } else if (e.key === '2' || e.code === 'Numpad2') {
        e.preventDefault();
        onThumbsUp();
      }
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

// ---- Resize ----
function onResize() {
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
  pollGamepad();
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
      learningMode,
      outputMode,
      joyX,
      joyY,
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
    }

    if (typeof state.noiseLevel === 'number') noiseLevel = state.noiseLevel;
    if (typeof state.joyX === 'number') joyX = state.joyX;
    if (typeof state.joyY === 'number') joyY = state.joyY;

    // Restore learning mode
    if (state.learningMode && state.learningMode !== learningMode) {
      learningMode = state.learningMode;
      document.querySelectorAll('#learning-toggle .pill-opt').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === learningMode);
      });
      updateModeUI();
    }

    // Restore output mode
    if (state.outputMode && state.outputMode !== outputMode) {
      setOutputMode(state.outputMode);
      document.querySelectorAll('#output-toggle .pill-opt').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === outputMode);
      });
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
