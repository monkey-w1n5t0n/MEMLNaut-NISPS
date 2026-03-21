// NISPS Workbench (Design B) — Main application
// Dashboard layout with mapping visualization, merged input space

import { IML } from './nisps/iml.js';
import { FlowFieldVisualizer } from './ui/visualizer.js';
import { C15Bridge } from './synth/c15-bridge.js';
import { Arpeggiator } from './synth/arpeggiator.js';
import { SYNTH_PARAM_MAP, SYNTH_PARAM_NAMES, SYNTH_PARAM_COLORS, applyTame } from './synth/param-map.js';

// --- Constants ---
const N_INPUTS = 2;
const N_VISUAL_OUTPUTS = 20;
const N_SYNTH_OUTPUTS = SYNTH_PARAM_MAP.length; // 126
const N_OUTPUTS = N_SYNTH_OUTPUTS; // MLP always produces full output; visual uses first 20
const STORAGE_KEY = 'nisps-b-workbench';

const VISUAL_PARAM_NAMES = [
  'Flow', 'Scale', 'Speed', 'Hue', 'Spread', 'Size', 'Trail', 'Turb',
  'Attract', 'Radius', 'DispRate', 'DispAmt', 'Lifetime', 'Respawn',
  'Advection', 'Inertia', 'Drag', 'Repulse', 'RepCnt', 'RepRate'
];
const VISUAL_PARAM_COLORS = [
  '#ff6a00', '#00ccff', '#ff6600', '#ff00cc', '#ffcc00', '#88ff00',
  '#0088ff', '#ff3366', '#9bff5f', '#59d3ff', '#ff8f3f', '#a0b7ff',
  '#f4ff7a', '#ffa8db', '#7dffc8', '#ffd166', '#8ad4ff', '#ff5f5f',
  '#ffc15f', '#ff8a3d'
];

// Visual param groups: [groupName, accentColor, [indices]]
const VISUAL_GROUPS = [
  ['Motion',    '--group-motion',    [0, 2, 14, 15, 16]],
  ['Color',     '--group-color',     [3, 4, 6]],
  ['Particles', '--group-particles', [1, 5, 12, 13]],
  ['Forces',    '--group-forces',    [8, 9, 7, 17, 18]],
  ['Effects',   '--group-effects',   [10, 11, 19]],
];

const SYNTH_GROUPS = [
  ['Envelope A',  '--group-osc',     Array.from({length: 7}, (_, i) => i)],
  ['Envelope B',  '--group-osc',     Array.from({length: 7}, (_, i) => i + 7)],
  ['Envelope C',  '--group-osc',     Array.from({length: 6}, (_, i) => i + 14)],
  ['Oscillator A','--group-osc',     Array.from({length: 5}, (_, i) => i + 20)],
  ['Oscillator B','--group-osc',     Array.from({length: 5}, (_, i) => i + 25)],
  ['Shaper A',    '--group-shapers', Array.from({length: 6}, (_, i) => i + 30)],
  ['Shaper B',    '--group-shapers', Array.from({length: 6}, (_, i) => i + 36)],
  ['Comb Filter', '--group-filters', Array.from({length: 8}, (_, i) => i + 42)],
  ['SVF Filter',  '--group-filters', Array.from({length: 7}, (_, i) => i + 50)],
  ['FB Mixer',    '--group-effects', Array.from({length: 10}, (_, i) => i + 57)],
  ['Out Mixer',   '--group-output',  Array.from({length: 14}, (_, i) => i + 67)],
  ['Cabinet',     '--group-effects', Array.from({length: 8}, (_, i) => i + 81)],
  ['Flanger',     '--group-fx',      Array.from({length: 13}, (_, i) => i + 89)],
  ['Echo',        '--group-fx',      Array.from({length: 7}, (_, i) => i + 102)],
  ['Reverb',      '--group-fx',      Array.from({length: 6}, (_, i) => i + 109)],
  ['Unison',      '--group-output',  Array.from({length: 3}, (_, i) => i + 115)],
  // Remaining params (118..125) if any
  ...(N_SYNTH_OUTPUTS > 118 ? [['Mono/Extra', '--group-output', Array.from({length: N_SYNTH_OUTPUTS - 118}, (_, i) => i + 118)]] : []),
];

// Heatmap colormap: dark navy -> muted teal -> muted yellow -> muted orange
function heatmapColor(t) {
  t = Math.max(0, Math.min(1, t));
  let r, g, b;
  if (t < 0.25) {
    // Dark navy -> muted teal
    const s = t / 0.25;
    r = Math.floor(8 + s * 20);
    g = Math.floor(12 + s * 60);
    b = Math.floor(30 + s * 55);
  } else if (t < 0.5) {
    // Muted teal -> muted teal-green
    const s = (t - 0.25) / 0.25;
    r = Math.floor(28 + s * 30);
    g = Math.floor(72 + s * 50);
    b = Math.floor(85 - s * 40);
  } else if (t < 0.75) {
    // Muted teal-green -> muted yellow
    const s = (t - 0.5) / 0.25;
    r = Math.floor(58 + s * 90);
    g = Math.floor(122 + s * 30);
    b = Math.floor(45 - s * 20);
  } else {
    // Muted yellow -> muted orange
    const s = (t - 0.75) / 0.25;
    r = Math.floor(148 + s * 30);
    g = Math.floor(152 - s * 60);
    b = Math.floor(25 - s * 10);
  }
  return `rgb(${r},${g},${b})`;
}

// --- Tame URL param ---
const _urlParams = new URLSearchParams(window.location.search);
const tameLevel = parseFloat(_urlParams.get('tame') ?? '0');
const spreadLevel = Math.max(0, Math.min(1, parseFloat(_urlParams.get('spread') ?? '0') || 0));

// --- State ---
let iml;
let visualizer;
let learningMode = 'rl';
let outputMode = 'visual';
let noiseLevel = 0.05;
const rlExplorationDecay = 0.97;
let animating = true;

// Joystick state
let joyX = 0.5, joyY = 0.5;
let joyDragging = false;

// Follow mode
let followMode = false;

// Synth
let c15 = null;
let arpeggiator = null;
let synthVisualizer = null;

// Current param values (for dragging)
let paramValues = new Array(N_OUTPUTS).fill(0.5);

// Current groups/names/colors based on output mode
let currentGroups = VISUAL_GROUPS;
let currentNames = VISUAL_PARAM_NAMES;
let currentColors = VISUAL_PARAM_COLORS;

// DOM caches
let paramGroupsEl;
let groupElements = []; // [{el, bodyEl, indices, open}]

// ============================
// Pad preset outputs to N_OUTPUTS
// ============================
function padPresetOutputs(outputs) {
  const padded = new Array(N_OUTPUTS).fill(0.5);
  for (let i = 0; i < outputs.length; i++) padded[i] = outputs[i];
  return padded;
}

// ============================
// Synth Visualizer (parameter landscape)
// ============================
const SYNTH_SECTION_COLORS = [
  { start: 0,   count: 7,  color: '#4488ff', label: 'Env A' },
  { start: 7,   count: 7,  color: '#4488ff', label: 'Env B' },
  { start: 14,  count: 6,  color: '#4488ff', label: 'Env C' },
  { start: 20,  count: 5,  color: '#ff8844', label: 'Osc A' },
  { start: 25,  count: 5,  color: '#ff8844', label: 'Osc B' },
  { start: 30,  count: 6,  color: '#ff4466', label: 'Shp A' },
  { start: 36,  count: 6,  color: '#ff4466', label: 'Shp B' },
  { start: 42,  count: 8,  color: '#44ddaa', label: 'Comb' },
  { start: 50,  count: 7,  color: '#44ddaa', label: 'SVF' },
  { start: 57,  count: 10, color: '#ddaa44', label: 'FB Mix' },
  { start: 67,  count: 14, color: '#ddaa44', label: 'Out Mix' },
  { start: 81,  count: 8,  color: '#aa88dd', label: 'Cab' },
  { start: 89,  count: 13, color: '#dd88aa', label: 'Flanger' },
  { start: 102, count: 7,  color: '#88aadd', label: 'Echo' },
  { start: 109, count: 6,  color: '#88ddaa', label: 'Reverb' },
  { start: 115, count: 11, color: '#999999', label: 'Uni/Mono' },
];

class SynthVisualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.params = new Array(N_SYNTH_OUTPUTS).fill(0.5);
    this.displayParams = new Array(N_SYNTH_OUTPUTS).fill(0.5);
    this._animId = null;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width * (window.devicePixelRatio || 1);
    this.canvas.height = rect.height * (window.devicePixelRatio || 1);
  }

  setParams(values) {
    for (let i = 0; i < this.params.length && i < values.length; i++) {
      this.params[i] = values[i];
    }
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const n = N_SYNTH_OUTPUTS;

    // Lerp display toward target
    for (let i = 0; i < n; i++) {
      this.displayParams[i] += (this.params[i] - this.displayParams[i]) * 0.15;
    }

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    const labelHeight = 28 * (window.devicePixelRatio || 1);
    const topPad = 8 * (window.devicePixelRatio || 1);
    const barAreaH = h - labelHeight - topPad;
    const totalBarW = w / n;
    const barW = Math.max(1, totalBarW * 0.75);
    const gap = totalBarW - barW;

    // Draw section dividers and bars
    let sectionIdx = 0;
    for (const section of SYNTH_SECTION_COLORS) {
      const sx = section.start * totalBarW;
      const sw = section.count * totalBarW;

      // Section background
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      if (sectionIdx % 2 === 0) {
        ctx.fillRect(sx, topPad, sw, barAreaH);
      }

      // Draw bars
      for (let i = section.start; i < section.start + section.count && i < n; i++) {
        const val = this.displayParams[i] || 0;
        const x = i * totalBarW + gap / 2;
        const barH = val * barAreaH;
        const y = topPad + barAreaH - barH;

        ctx.fillStyle = section.color;
        ctx.globalAlpha = 0.4 + val * 0.6;
        ctx.fillRect(x, y, barW, barH);
        ctx.globalAlpha = 1;
      }

      // Section label
      const fontSize = Math.max(7, Math.min(10, sw / (section.label.length * 0.7)));
      ctx.fillStyle = section.color;
      ctx.globalAlpha = 0.7;
      ctx.font = `${fontSize * (window.devicePixelRatio || 1)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(section.label, sx + sw / 2, h - 6 * (window.devicePixelRatio || 1));
      ctx.globalAlpha = 1;

      sectionIdx++;
    }

    // Divider lines between sections
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (const section of SYNTH_SECTION_COLORS) {
      if (section.start === 0) continue;
      const x = section.start * totalBarW;
      ctx.beginPath();
      ctx.moveTo(x, topPad);
      ctx.lineTo(x, h - labelHeight);
      ctx.stroke();
    }
  }
}

// ============================
// Mapping Heatmap (merged joystick + mapping)
// ============================
class MappingView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.gridSize = 20;
    this.dragging = false;
    // Offscreen buffer for the heatmap so drawOverlay can re-composite cheaply
    this._offscreen = document.createElement('canvas');
    this._offscreen.width = canvas.width;
    this._offscreen.height = canvas.height;
    this._offCtx = this._offscreen.getContext('2d');

    // Pointer interaction for joystick input
    canvas.addEventListener('pointerdown', (e) => this._onDown(e));
    canvas.addEventListener('pointermove', (e) => this._onMove(e));
    canvas.addEventListener('pointerup', (e) => this._onUp(e));
    canvas.addEventListener('pointerleave', (e) => this._onUp(e));
    canvas.addEventListener('pointercancel', (e) => this._onUp(e));
    canvas.addEventListener('dblclick', (e) => {
      e.preventDefault();
      toggleFollowMode();
    });
  }

  _getPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return [x, y];
  }

  _onDown(e) {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.dragging = true;
    joyDragging = true;
    const [x, y] = this._getPos(e);
    joyX = x; joyY = y;
    onJoystickMove();
    this.drawOverlay();
  }

  _onMove(e) {
    if (!this.dragging) return;
    e.preventDefault();
    const [x, y] = this._getPos(e);
    joyX = x; joyY = y;
    onJoystickMove();
    this.drawOverlay();
  }

  _onUp(e) {
    this.dragging = false;
    joyDragging = false;
  }

  update() {
    const ctx = this._offCtx;
    const w = this._offscreen.width;
    const h = this._offscreen.height;
    const gs = this.gridSize;
    const cellW = w / gs;
    const cellH = h / gs;

    // Sample grid through network
    const savedInputs = [...iml.inputState];

    for (let gy = 0; gy < gs; gy++) {
      for (let gx = 0; gx < gs; gx++) {
        const nx = (gx + 0.5) / gs;
        const ny = (gy + 0.5) / gs;

        iml.setInput(0, nx);
        iml.setInput(1, ny);
        iml.inputUpdated = true;
        iml.process();
        const out = iml.getOutputs();

        let avg = 0;
        for (let i = 0; i < out.length; i++) avg += out[i];
        avg /= out.length;

        let maxIdx = 0, maxVal = 0;
        for (let i = 0; i < out.length; i++) {
          if (out[i] > maxVal) { maxVal = out[i]; maxIdx = i; }
        }
        const hueInfluence = maxIdx / out.length;

        ctx.fillStyle = heatmapColor(avg * 0.8 + hueInfluence * 0.2);
        ctx.fillRect(gx * cellW, gy * cellH, cellW + 0.5, cellH + 0.5);
      }
    }

    // Draw grid overlay every 5th cell
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 0.5;
    for (let i = 5; i < gs; i += 5) {
      ctx.beginPath();
      ctx.moveTo(i * cellW, 0);
      ctx.lineTo(i * cellW, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cellH);
      ctx.lineTo(w, i * cellH);
      ctx.stroke();
    }

    // Restore inputs
    iml.setInputs(savedInputs);
    iml.inputUpdated = true;
    iml.process();

    this.drawOverlay();
  }

  drawOverlay() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Blit cached heatmap then draw overlay on top
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this._offscreen, 0, 0);

    // Training examples as bright dots
    const features = iml.dataset.features;
    if (features) {
      for (let i = 0; i < features.length; i++) {
        const f = features[i];
        if (!f || f.length < 2) continue;
        const ex = f[0] * w;
        const ey = f[1] * h;
        ctx.fillStyle = '#fff';
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(ex, ey, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Current joystick position as crosshair
    const px = joyX * w;
    const py = joyY * h;
    const accent = outputMode === 'synth' ? '#ff8c00' : '#ff6a00';

    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Cursor dot
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Outer ring
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 10, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ============================
// Constellation
// ============================
function drawConstellation(canvas, values, nParams) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(cx, cy) - 10;

  ctx.clearRect(0, 0, w, h);

  // Faint circle
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  const n = nParams;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const val = values[i] || 0;
    const dotRadius = 2 + val * 4;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;

    const alpha = 0.2 + val * 0.8;
    const color = currentColors[i % currentColors.length];

    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ============================
// Loss Plot
// ============================
function drawLossPlot(canvas, history) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (!history || history.length < 2) {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#333';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No training data', w / 2, h / 2 + 3);
    return;
  }

  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, w, h);

  // Find range
  let maxLoss = 0;
  for (const v of history) if (v > maxLoss) maxLoss = v;
  if (maxLoss === 0) maxLoss = 1;

  const accent = outputMode === 'synth' ? '#ff8c00' : '#ff6a00';

  // Draw line
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const step = w / (history.length - 1);
  for (let i = 0; i < history.length; i++) {
    const x = i * step;
    const y = h - (history[i] / maxLoss) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Fill under
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = accent.replace(')', ', 0.1)').replace('rgb', 'rgba').replace('#', '');
  // Use hex to rgba
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ============================
// Param Groups UI
// ============================
function buildParamGroups() {
  paramGroupsEl.innerHTML = '';
  groupElements = [];

  for (const [name, colorVar, indices] of currentGroups) {
    const group = document.createElement('div');
    group.className = 'wb-group';

    // Resolve CSS variable for accent color
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue(colorVar).trim();

    // Header
    const header = document.createElement('div');
    header.className = 'wb-group-header';
    header.innerHTML = `
      <div class="wb-group-accent" style="background:${accentColor}"></div>
      <span class="wb-group-name">${name}</span>
      <canvas class="wb-group-sparkline" width="40" height="12"></canvas>
      <span class="wb-group-chevron">&#9654;</span>
    `;

    // Body
    const body = document.createElement('div');
    body.className = 'wb-group-body';
    const paramsDiv = document.createElement('div');
    paramsDiv.className = 'wb-group-params';

    for (const idx of indices) {
      const paramName = currentNames[idx] || `P${idx}`;
      const color = currentColors[idx % currentColors.length];

      const row = document.createElement('div');
      row.className = 'wb-param';
      row.innerHTML = `
        <span class="wb-param-name">${paramName}</span>
        <div class="wb-param-track" data-idx="${idx}">
          <div class="wb-param-fill" style="width:50%;background:${color}"></div>
        </div>
        <span class="wb-param-value" data-idx="${idx}">0.50</span>
      `;
      paramsDiv.appendChild(row);
    }

    body.appendChild(paramsDiv);
    group.appendChild(header);
    group.appendChild(body);
    paramGroupsEl.appendChild(group);

    // Toggle collapse
    let isOpen = false;
    header.addEventListener('click', () => {
      isOpen = !isOpen;
      group.classList.toggle('open', isOpen);
    });

    // Dragging on param tracks
    paramsDiv.addEventListener('pointerdown', (e) => {
      if (learningMode !== 'examples') return;
      const track = e.target.closest('.wb-param-track');
      if (!track) return;
      e.preventDefault();
      track.setPointerCapture(e.pointerId);
      const idx = parseInt(track.dataset.idx);
      const setVal = (ev) => {
        const rect = track.getBoundingClientRect();
        const v = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        paramValues[idx] = v;
        updateParamBar(track, v, idx);
        // Push manually-set values to visualizer and synth in real time
        routeOutputs(paramValues);
      };
      setVal(e);
      const onMove = (ev) => { ev.preventDefault(); setVal(ev); };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    groupElements.push({ el: group, bodyEl: paramsDiv, indices, sparklineCanvas: header.querySelector('.wb-group-sparkline') });
  }
}

function updateParamBar(trackEl, value, idx) {
  const fill = trackEl.querySelector('.wb-param-fill');
  if (fill) fill.style.width = (value * 100) + '%';
  // Update value text
  const valEl = trackEl.parentElement.querySelector(`.wb-param-value[data-idx="${idx}"]`);
  if (valEl) valEl.textContent = value.toFixed(2);
}

function updateAllParamBars(values) {
  paramValues = [...values];
  for (const ge of groupElements) {
    let sum = 0;
    for (const idx of ge.indices) {
      const val = values[idx] || 0;
      sum += val;
      const track = ge.bodyEl.querySelector(`.wb-param-track[data-idx="${idx}"]`);
      if (track) updateParamBar(track, val, idx);
    }

    // Update sparkline
    drawGroupSparkline(ge.sparklineCanvas, ge.indices, values);
  }
}

function drawGroupSparkline(canvas, indices, values) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, w, h);

  const n = indices.length;
  const barW = w / n;
  for (let i = 0; i < n; i++) {
    const val = values[indices[i]] || 0;
    const barH = val * h;
    const color = currentColors[indices[i] % currentColors.length];
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(i * barW, h - barH, barW - 0.5, barH);
  }
  ctx.globalAlpha = 1;
}

// ============================
// Routing
// ============================
function routeOutputs(outputs) {
  if (outputMode === 'visual') {
    visualizer.setParams(outputs.slice(0, N_VISUAL_OUTPUTS));
  } else {
    if (synthVisualizer) synthVisualizer.setParams(outputs);
    if (c15 && c15.running) {
      for (let i = 0; i < outputs.length && i < SYNTH_PARAM_MAP.length; i++) {
        const tamed = applyTame(outputs[i], SYNTH_PARAM_MAP[i], tameLevel);
        c15.setParameter(SYNTH_PARAM_MAP[i].id, tamed);
      }
    }
  }
}

// ============================
// Application logic
// ============================
let mappingView;
let lossCanvas;
let constellationCanvas;

function onJoystickMove() {
  iml.setInput(0, joyX);
  iml.setInput(1, joyY);
  iml.process();

  const outputs = iml.getOutputs();
  routeOutputs(outputs);

  // In examples mode, only update bars from network if user isn't dragging
  if (learningMode !== 'examples') {
    updateAllParamBars(outputs);
  } else {
    // Still update param values for display but allow overrides
    // Only update non-dragged params
    updateAllParamBars(outputs);
  }

  const constellationN = outputMode === 'synth' ? N_SYNTH_OUTPUTS : N_VISUAL_OUTPUTS;
  drawConstellation(constellationCanvas, outputs, constellationN);
  updateMetrics();

  // Redraw mapping overlay (cursor position) - cheap
  mappingView.drawOverlay();
}

function onAddExample() {
  const inputs = [joyX, joyY];
  const outputs = [...paramValues];
  iml.addExample(inputs, outputs);
  updateMetrics();
  mappingView.update();
  flash('btn-add');
}

function onTrain() {
  const loss = trainModel();
  if (loss !== null) {
    const outputs = iml.getOutputs();
    routeOutputs(outputs);
    updateAllParamBars(outputs);
    const constellationN = outputMode === 'synth' ? N_SYNTH_OUTPUTS : N_VISUAL_OUTPUTS;
    drawConstellation(constellationCanvas, outputs, constellationN);
    drawLossPlot(lossCanvas, iml.lossHistory);
    mappingView.update();
    updateMetrics();
    flash('btn-train');
  }
}

function onRandomize() {
  iml.randomiseWeights(spreadLevel);
  const outputs = iml.getOutputs();
  routeOutputs(outputs);
  updateAllParamBars(outputs);
  const constellationN = outputMode === 'synth' ? N_SYNTH_OUTPUTS : N_VISUAL_OUTPUTS;
  drawConstellation(constellationCanvas, outputs, constellationN);
  noiseLevel = 0.05;
  mappingView.update();
  updateMetrics();
}

function onClear() {
  iml.clearDataset();
  iml.lossHistory = [];
  iml.bestLoss = null;
  iml.totalTrainingIterations = 0;
  noiseLevel = 0.05;
  clearState();
  drawLossPlot(lossCanvas, []);
  mappingView.update();
  updateMetrics();
}

function onThumbsUp() {
  const inputs = [joyX, joyY];
  const outputs = [...iml.getOutputs()];
  iml.addExample(inputs, outputs);
  trainModel();
  noiseLevel *= rlExplorationDecay;
  noiseLevel = Math.max(noiseLevel, 0.005);
  drawLossPlot(lossCanvas, iml.lossHistory);
  mappingView.update();
  updateMetrics();
  flash('btn-thumbsup');
}

function onThumbsDown() {
  noiseLevel = Math.min(noiseLevel * 1.5, 0.3);
  iml.moveWeights(noiseLevel);
  const outputs = iml.getOutputs();
  routeOutputs(outputs);
  updateAllParamBars(outputs);
  const constellationN = outputMode === 'synth' ? N_SYNTH_OUTPUTS : N_VISUAL_OUTPUTS;
  drawConstellation(constellationCanvas, outputs, constellationN);
  mappingView.update();
  updateMetrics();
  flash('btn-thumbsdown');
}

function trainModel() {
  let lastPlotUpdate = 0;
  const loss = iml.train({
    onIteration: (iter, iterLoss) => {
      if (iter - lastPlotUpdate < 8) return;
      lastPlotUpdate = iter;
      drawLossPlot(lossCanvas, [...iml.lossHistory, iterLoss]);
    },
  });
  return loss;
}

function updateMetrics() {
  const el = (id) => document.getElementById(id);
  el('metric-examples').textContent = iml.exampleCount;
  el('metric-loss').textContent = iml.lastLoss !== null ? iml.lastLoss.toFixed(6) : '\u2014';
  el('metric-noise').textContent = noiseLevel.toFixed(3);
  el('metric-joy').textContent = `${joyX.toFixed(2)}, ${joyY.toFixed(2)}`;
}

function flash(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 200);
}

// ============================
// Toast notifications
// ============================
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden', 'fade-out');
  // Clear any previous timeout
  if (toast._timeout) clearTimeout(toast._timeout);
  if (toast._fadeTimeout) clearTimeout(toast._fadeTimeout);
  toast._timeout = setTimeout(() => {
    toast.classList.add('fade-out');
    toast._fadeTimeout = setTimeout(() => {
      toast.classList.add('hidden');
      toast.classList.remove('fade-out');
    }, 500);
  }, 1500);
}

// ============================
// Follow mode
// ============================
function toggleFollowMode() {
  followMode = !followMode;
  const badge = document.getElementById('follow-badge');
  const toggleBtn = document.getElementById('follow-toggle-btn');
  const panel = document.querySelector('.wb-mapping-panel');

  if (followMode) {
    badge.classList.remove('hidden');
    toggleBtn.classList.add('active');
    panel.classList.add('follow-active');
    showToast('Follow mode ON');
  } else {
    badge.classList.add('hidden');
    toggleBtn.classList.remove('active');
    panel.classList.remove('follow-active');
    showToast('Follow mode OFF');
  }
}

function onFollowPointerMove(e) {
  if (!followMode) return;
  // Map screen coordinates to 0-1
  const x = Math.max(0, Math.min(1, e.clientX / window.innerWidth));
  const y = Math.max(0, Math.min(1, e.clientY / window.innerHeight));
  joyX = x;
  joyY = y;
  onJoystickMove();
}

// ============================
// Output mode switching
// ============================
function setOutputMode(mode) {
  outputMode = mode;
  const badge = document.getElementById('mode-badge');
  const synthControls = document.getElementById('synth-controls');
  const presetsVisual = document.getElementById('presets-visual');
  const label = document.getElementById('constellation-label');
  const visualCanvas = document.getElementById('visual-canvas');
  const synthVisCanvas = document.getElementById('synth-vis-canvas');

  if (mode === 'synth') {
    document.body.classList.add('synth-mode');
    badge.textContent = 'Synth';
    badge.classList.add('synth');
    synthControls.classList.remove('hidden');
    if (presetsVisual) presetsVisual.style.display = 'none';
    currentGroups = SYNTH_GROUPS;
    currentNames = SYNTH_PARAM_NAMES;
    currentColors = SYNTH_PARAM_COLORS;
    label.textContent = `${N_SYNTH_OUTPUTS} synth parameters`;
    // Show synth canvas, hide visual canvas
    visualCanvas.classList.add('hidden');
    synthVisCanvas.classList.remove('hidden');
  } else {
    document.body.classList.remove('synth-mode');
    badge.textContent = 'Visual';
    badge.classList.remove('synth');
    synthControls.classList.add('hidden');
    if (presetsVisual) presetsVisual.style.display = '';
    currentGroups = VISUAL_GROUPS;
    currentNames = VISUAL_PARAM_NAMES;
    currentColors = VISUAL_PARAM_COLORS;
    label.textContent = `${N_VISUAL_OUTPUTS} parameters`;
    // Show visual canvas, hide synth canvas
    visualCanvas.classList.remove('hidden');
    synthVisCanvas.classList.add('hidden');
  }

  // Toggle button state
  document.getElementById('toggle-visual').classList.toggle('active', mode === 'visual');
  document.getElementById('toggle-synth').classList.toggle('active', mode === 'synth');

  // Resize the now-visible canvas so it picks up correct dimensions
  if (mode === 'visual') {
    requestAnimationFrame(() => {
      visualizer.resize();
      visualizer.initParticles();
    });
  } else if (synthVisualizer) {
    requestAnimationFrame(() => synthVisualizer._resize());
  }

  buildParamGroups();
  const outputs = iml.getOutputs();
  updateAllParamBars(outputs);
  routeOutputs(outputs);
  const constellationN = mode === 'synth' ? N_SYNTH_OUTPUTS : N_VISUAL_OUTPUTS;
  drawConstellation(constellationCanvas, outputs, constellationN);
  mappingView.update();
}

// ============================
// Learning mode switching
// ============================
function setLearningMode(mode) {
  learningMode = mode;
  document.getElementById('mode-examples').classList.toggle('active', mode === 'examples');
  document.getElementById('mode-rl').classList.toggle('active', mode === 'rl');
  document.getElementById('examples-controls').classList.toggle('hidden', mode !== 'examples');
  document.getElementById('rl-controls').classList.toggle('hidden', mode !== 'rl');
}

// ============================
// Presets
// ============================
function loadPreset(name) {
  iml.clearDataset();

  if (name === 'calm-to-chaotic') {
    iml.addExample([0.1, 0.9], padPresetOutputs([0.25, 0.3, 0.1, 0.55, 0.2, 0.3, 0.02, 0.05, 0.9, 0.45, 0.25, 0.2, 0.9, 0.0, 0.0, 0.2, 0.05, 0.0, 0.0, 0.2]));
    iml.addExample([0.9, 0.1], padPresetOutputs([0.75, 0.7, 0.9, 0.05, 0.8, 0.7, 0.9, 0.95, 0.3, 0.2, 0.85, 0.7, 0.25, 0.55, 1.0, 0.92, 0.02, 0.95, 0.8, 0.85]));
    iml.addExample([0.5, 0.5], padPresetOutputs([0.5, 0.5, 0.5, 0.3, 0.5, 0.5, 0.4, 0.5, 0.7, 0.6, 0.5, 0.45, 0.55, 0.9, 0.5, 0.65, 0.08, 0.45, 0.4, 0.5]));
  } else if (name === 'rainbow-sweep') {
    iml.addExample([0.0, 0.5], padPresetOutputs([0.5, 0.5, 0.4, 0.0, 0.3, 0.4, 0.05, 0.3, 0.8, 0.55, 0.4, 0.3, 0.8, 0.0, 0.0, 0.45, 0.08, 0.2, 0.25, 0.45]));
    iml.addExample([0.5, 0.5], padPresetOutputs([0.5, 0.5, 0.4, 0.5, 0.3, 0.4, 0.05, 0.3, 0.8, 0.55, 0.55, 0.35, 0.7, 0.0, 0.4, 0.45, 0.08, 0.45, 0.4, 0.6]));
    iml.addExample([1.0, 0.5], padPresetOutputs([0.5, 0.5, 0.4, 1.0, 0.3, 0.4, 0.05, 0.3, 0.8, 0.55, 0.75, 0.45, 0.6, 0.0, 0.8, 0.45, 0.08, 0.7, 0.55, 0.75]));
  } else if (name === 'vortex') {
    iml.addExample([0.5, 0.5], padPresetOutputs([0.0, 0.8, 0.8, 0.6, 0.1, 0.15, 0.02, 1.0, 1.0, 0.3, 0.95, 0.85, 0.25, 1.0, 0.5, 0.95, 0.01, 1.0, 1.0, 1.0]));
    iml.addExample([0.0, 0.0], padPresetOutputs([0.5, 0.2, 0.3, 0.8, 0.9, 0.6, 0.08, 0.1, 0.35, 0.8, 0.25, 0.15, 0.8, 0.5, 0.2, 0.35, 0.2, 0.15, 0.2, 0.25]));
    iml.addExample([1.0, 1.0], padPresetOutputs([0.5, 0.2, 0.3, 0.2, 0.9, 0.6, 0.08, 0.1, 0.35, 0.8, 0.25, 0.15, 0.8, 0.5, 0.8, 0.35, 0.2, 0.15, 0.2, 0.25]));
    iml.addExample([0.0, 1.0], padPresetOutputs([0.3, 0.4, 0.5, 0.4, 0.5, 0.4, 0.05, 0.5, 0.65, 0.5, 0.55, 0.45, 0.45, 0.2, 0.4, 0.7, 0.1, 0.5, 0.4, 0.55]));
    iml.addExample([1.0, 0.0], padPresetOutputs([0.7, 0.4, 0.5, 0.0, 0.5, 0.4, 0.05, 0.5, 0.65, 0.5, 0.55, 0.45, 0.45, 0.2, 0.9, 0.7, 0.1, 0.5, 0.4, 0.55]));
  }

  const loss = trainModel();
  const outputs = iml.getOutputs();
  routeOutputs(outputs);
  updateAllParamBars(outputs);
  const constellationN = outputMode === 'synth' ? N_SYNTH_OUTPUTS : N_VISUAL_OUTPUTS;
  drawConstellation(constellationCanvas, outputs, constellationN);
  drawLossPlot(lossCanvas, iml.lossHistory);
  mappingView.update();
  updateMetrics();
}

// ============================
// Synth controls
// ============================
function initSynthControls() {
  const startBtn = document.getElementById('synth-start');
  const volumeSlider = document.getElementById('synth-volume');
  const arpToggleBtn = document.getElementById('arp-toggle');
  const arpProgression = document.getElementById('arp-progression');
  const arpTempo = document.getElementById('arp-tempo');
  const arpOctaves = document.getElementById('arp-octaves');
  const arpOffset = document.getElementById('arp-offset');

  startBtn.addEventListener('click', async () => {
    if (c15.running) {
      arpeggiator.stop();
      arpToggleBtn.textContent = 'Arp: Play';
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

  arpToggleBtn.addEventListener('click', () => {
    if (!c15.running) return;
    if (arpeggiator.playing) {
      arpeggiator.stop();
      arpToggleBtn.textContent = 'Arp: Play';
    } else {
      arpeggiator.start();
      arpToggleBtn.textContent = 'Arp: Stop';
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

// ============================
// localStorage persistence
// ============================
function saveState() {
  try {
    const features = iml.dataset.features;
    const labels = iml.dataset.labels;
    if (!features || features.length === 0) return;
    const data = { features, labels };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('[NISPS] saveState failed:', e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.features || !data.labels || data.features.length === 0) return false;
    for (let i = 0; i < data.features.length; i++) {
      // Pad old saves (20 outputs) to current N_OUTPUTS with 0.5 defaults
      let labels = data.labels[i];
      if (labels.length < N_OUTPUTS) {
        labels = padPresetOutputs(labels);
      }
      iml.addExample(data.features[i], labels);
    }
    trainModel();
    return true;
  } catch (e) {
    console.warn('[NISPS] loadState failed:', e);
    return false;
  }
}

function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('[NISPS] clearState failed:', e);
  }
}

// ============================
// Keyboard shortcuts
// ============================
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  // RL shortcuts: 1=negative, 2=positive
  if (learningMode === 'rl') {
    if (e.key === '1' || e.code === 'Numpad1') { e.preventDefault(); onThumbsDown(); }
    if (e.key === '2' || e.code === 'Numpad2') { e.preventDefault(); onThumbsUp(); }
  }
  // Follow mode toggle: f
  if (e.key === 'f' || e.key === 'F') {
    // Don't toggle if user is typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    e.preventDefault();
    toggleFollowMode();
  }
});

// ============================
// Animation
// ============================
function animate() {
  if (!animating) return;
  if (outputMode === 'visual') {
    visualizer.draw();
  } else if (synthVisualizer) {
    synthVisualizer.draw();
  }
  requestAnimationFrame(animate);
}

// ============================
// Init
// ============================
function init() {
  // IML — random weights, then restore saved data if available
  iml = new IML(N_INPUTS, N_OUTPUTS, [32, 48, 64], 1000, 1.0, 0.00001);
  iml.setLogger(msg => console.log('[NISPS]', msg));

  // Flow field visualizer
  const visCanvas = document.getElementById('visual-canvas');
  visualizer = new FlowFieldVisualizer(visCanvas);

  // Synth parameter landscape visualizer
  const synthVisCanvas = document.getElementById('synth-vis-canvas');
  synthVisualizer = new SynthVisualizer(synthVisCanvas);

  // Mapping view (merged joystick + heatmap)
  mappingView = new MappingView(document.getElementById('mapping-canvas'));

  // Canvases
  lossCanvas = document.getElementById('loss-canvas');
  constellationCanvas = document.getElementById('constellation-canvas');

  // Param groups
  paramGroupsEl = document.getElementById('param-groups');
  buildParamGroups();

  // Controls wiring
  document.getElementById('btn-add').addEventListener('click', onAddExample);
  document.getElementById('btn-train').addEventListener('click', onTrain);
  document.getElementById('btn-randomize').addEventListener('click', onRandomize);
  document.getElementById('btn-clear').addEventListener('click', onClear);
  document.getElementById('btn-thumbsup').addEventListener('click', onThumbsUp);
  document.getElementById('btn-thumbsdown').addEventListener('click', onThumbsDown);
  document.getElementById('btn-randomize-rl').addEventListener('click', onRandomize);

  // Learning mode — RL is default
  document.getElementById('mode-examples').addEventListener('click', () => setLearningMode('examples'));
  document.getElementById('mode-rl').addEventListener('click', () => setLearningMode('rl'));

  // Output mode
  document.getElementById('toggle-visual').addEventListener('click', () => setOutputMode('visual'));
  document.getElementById('toggle-synth').addEventListener('click', () => setOutputMode('synth'));

  // Follow mode toggle button
  document.getElementById('follow-toggle-btn').addEventListener('click', () => toggleFollowMode());

  // Follow mode: global pointer move
  window.addEventListener('pointermove', onFollowPointerMove);

  // Presets
  document.querySelectorAll('.preset-pill[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => loadPreset(btn.dataset.preset));
  });

  // Help
  const helpBtn = document.getElementById('help-btn');
  const helpOverlay = document.getElementById('help-overlay');
  if (helpBtn && helpOverlay) {
    helpBtn.addEventListener('click', () => helpOverlay.classList.toggle('hidden'));
    helpOverlay.addEventListener('click', () => helpOverlay.classList.add('hidden'));
  }

  // Synth
  c15 = new C15Bridge();
  c15.onStatusChange = (msg) => {
    const el = document.getElementById('synth-status');
    if (el) el.textContent = msg;
  };
  c15.loadParams();
  arpeggiator = new Arpeggiator(c15);
  initSynthControls();

  // Resize
  window.addEventListener('resize', () => {
    visualizer.resize();
    visualizer.initParticles();
    if (synthVisualizer) synthVisualizer._resize();
  });

  // Restore saved data if available
  const restored = loadState();

  // Initial inference
  iml.setInput(0, 0.5);
  iml.setInput(1, 0.5);
  iml.process();
  const outputs = iml.getOutputs();
  visualizer.setParams(outputs.slice(0, N_VISUAL_OUTPUTS));
  updateAllParamBars(outputs);
  drawConstellation(constellationCanvas, outputs, N_VISUAL_OUTPUTS);
  drawLossPlot(lossCanvas, restored ? iml.lossHistory : []);
  mappingView.update();
  updateMetrics();

  // Auto-save every 10 seconds
  setInterval(saveState, 10000);

  // Start animation
  animate();
}

document.addEventListener('DOMContentLoaded', init);
