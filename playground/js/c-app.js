// NISPS Journey — Design C
// Phases that dissolve: Explore -> Teach -> Perform

import { IML } from './nisps/iml.js';
import { FlowFieldVisualizer } from './ui/visualizer.js';
import { C15Bridge } from './synth/c15-bridge.js';
import { Arpeggiator } from './synth/arpeggiator.js';
import { MIDIInput } from './synth/midi-input.js';
import { SYNTH_PARAM_MAP, SYNTH_PARAM_NAMES, SYNTH_PARAM_COLORS, applyTame } from './synth/param-map.js';
import { GamepadInput } from './ui/gamepad.js';

// ============================================================
// Constants
// ============================================================
const N_INPUTS = 2;
const N_VISUAL_OUTPUTS = 20;
const N_SYNTH_OUTPUTS = SYNTH_PARAM_MAP.length; // 126
const N_OUTPUTS = N_SYNTH_OUTPUTS;
const STORAGE_KEY = 'nisps-c-journey';
const IDLE_TIMEOUT = 5000;
const TWO_PI = Math.PI * 2;

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

// 6 preset output arrays — each produces a distinct visual state
const PRESETS = [
  { name: 'Calm',   synth: 'Soft Pad',
    outputs: [0.1, 0.3, 0.15, 0.55, 0.2, 0.35, 0.02, 0.1, 0.5, 0.5, 0.3, 0.1, 0.8, 0.0, 0.0, 0.7, 0.05, 0.0, 0.0, 0.2] },
  { name: 'Storm',  synth: 'Bright FM',
    outputs: [0.7, 0.7, 0.9, 0.1, 0.9, 0.6, 0.12, 0.95, 1.0, 0.8, 0.8, 0.7, 0.3, 0.33, 0.15, 0.3, 0.15, 0.6, 0.4, 0.9] },
  { name: 'Spiral', synth: 'Resonant',
    outputs: [0.5, 0.5, 0.5, 0.3, 0.4, 0.3, 0.04, 0.3, 0.9, 0.6, 0.5, 0.3, 0.6, 0.0, 0.5, 0.6, 0.08, 0.0, 0.0, 0.5] },
  { name: 'Pulse',  synth: 'Pluck',
    outputs: [0.0, 0.4, 0.7, 0.8, 0.5, 0.5, 0.08, 0.5, 0.3, 0.3, 4.0/8.2, 1.0, 0.15, 0.67, 0.3, 0.1, 0.02, 0.2, 0.2, 0.3] },
  { name: 'Drift',  synth: 'Dark Pad',
    outputs: [0.2, 0.2, 0.1, 0.7, 0.15, 0.2, 0.015, 0.05, 0.4, 0.9, 0.15, 0.05, 0.95, 0.0, 0.05, 0.95, 0.01, 0.0, 0.0, 0.1] },
  { name: 'Swarm',  synth: 'Metallic',
    outputs: [0.9, 0.8, 0.8, 0.45, 0.7, 0.2, 0.1, 0.8, 0.6, 0.4, 0.6, 0.5, 0.2, 0.33, 0.2, 0.15, 0.2, 0.9, 0.9, 0.95] },
];

// --- Tame URL param ---
const _urlParams = new URLSearchParams(window.location.search);
const tameLevel = parseFloat(_urlParams.get('tame') ?? '1');
const spreadLevel = Math.max(0, Math.min(1, parseFloat(_urlParams.get('spread') ?? '0.6') || 0.6));

// ============================================================
// State
// ============================================================
let iml;
let visualizer;
let c15 = null;
let arpeggiator = null;
let midiInput = null;

let phase = 'explore'; // 'explore' | 'teach' | 'perform'
let outputMode = 'visual'; // 'visual' | 'synth'
// teachMode removed — Examples and RL controls are always visible together
let selectedPreset = -1;
let noiseLevel = 0.05;
let animating = true;
let joystickX = 0.5;
let joystickY = 0.5;
let joystickActive = false;
let joystickInteractionTime = 0;
let gamepad;
let ctasShown = false;
// rlHintShown removed — no separate RL mode hint needed
let idleTimer = null;
let currentParamNames = VISUAL_PARAM_NAMES;
let currentParamColors = VISUAL_PARAM_COLORS;

// Synth visualizer
let synthVisualizer = null;

// Follow mode
let followMode = false;

// Joystick internal state
let joyDragging = false;
let joyKnobX = 0.5;
let joyKnobY = 0.5;

// DOM refs
let app, visCanvas;

// ============================================================
// Synth sections for visualizer
// ============================================================
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

// ============================================================
// Pad outputs helper
// ============================================================
function padOutputs(arr) {
  const padded = new Array(N_OUTPUTS).fill(0.5);
  for (let i = 0; i < arr.length; i++) padded[i] = arr[i];
  return padded;
}

// ============================================================
// SynthVisualizer — parameter landscape
// ============================================================
class SynthVisualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.targets = new Array(N_SYNTH_OUTPUTS).fill(0.5);
    this.current = new Array(N_SYNTH_OUTPUTS).fill(0.5);
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.w = rect.width;
    this.h = rect.height;
  }

  setParams(outputs) {
    for (let i = 0; i < outputs.length && i < this.targets.length; i++) {
      this.targets[i] = Math.max(0, Math.min(1, outputs[i]));
    }
  }

  draw() {
    const { ctx, w, h, current, targets } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, w, h);

    // Lerp current toward targets
    for (let i = 0; i < current.length; i++) {
      current[i] += (targets[i] - current[i]) * 0.12;
    }

    const totalParams = N_SYNTH_OUTPUTS;
    const margin = 40;
    const bottomMargin = 24;
    const topMargin = 12;
    const barAreaW = w - margin * 2;
    const barAreaH = h - topMargin - bottomMargin;
    const gapBetweenSections = 2;
    const totalGaps = (SYNTH_SECTIONS.length - 1) * gapBetweenSections;
    const barWidth = Math.max(1, (barAreaW - totalGaps) / totalParams);

    let x = margin;
    let paramIdx = 0;

    for (const section of SYNTH_SECTIONS) {
      // Section label
      const sectionWidth = barWidth * section.count;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.font = '9px 'JetBrains Mono', monospace';
      ctx.textAlign = 'center';
      ctx.fillText(section.name, x + sectionWidth / 2, h - 6);

      // Section divider line at top
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, topMargin);
      ctx.lineTo(x, h - bottomMargin);
      ctx.stroke();

      // Draw bars
      for (let j = 0; j < section.count && paramIdx < totalParams; j++, paramIdx++) {
        const val = current[paramIdx];
        const barH = val * barAreaH;
        const barY = topMargin + barAreaH - barH;

        // Bar fill
        ctx.fillStyle = section.color;
        ctx.globalAlpha = 0.6 + val * 0.4;
        ctx.fillRect(x, barY, Math.max(1, barWidth - 0.5), barH);
        ctx.globalAlpha = 1;

        x += barWidth;
      }
      x += gapBetweenSections;
    }

    ctx.restore();
  }
}

// ============================================================
// Init
// ============================================================
function init() {
  app = document.getElementById('app');
  visCanvas = document.getElementById('vis-canvas');

  iml = new IML(N_INPUTS, N_OUTPUTS, [32, 48, 64], 1000, 1.0, 0.00001);
  iml.setLogger(msg => console.log('[NISPS]', msg));

  visualizer = new FlowFieldVisualizer(visCanvas);

  // Synth visualizer
  const synthVisCanvas = document.getElementById('synth-vis-canvas');
  synthVisualizer = new SynthVisualizer(synthVisCanvas);

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

  // Build heatmap cells
  buildHeatmap();

  // Build param sliders
  buildParamSliders();

  // Render preset thumbnails
  renderPresetThumbnails();

  // Wire events
  wirePhaseNav();
  wireModeToggle();
  wirePresetGrid();
  wireTeachActions();
  wireRLButtons();
  wireSynthControls();
  wirePerformUI();
  wireJoystick();
  wireHeatmapTooltip();

  // Keyboard shortcuts for RL (work in all phases)
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key === '1' || e.code === 'Numpad1') {
      e.preventDefault();
      onThumbsDown();
    }
    if (e.key === '2' || e.code === 'Numpad2') {
      e.preventDefault();
      onThumbsUp();
    }
  });

  // Gamepad
  gamepad = new GamepadInput({
    onMove: (x, y) => {
      updateJoystick(x, y);
      drawJoystick();
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

  // Follow mode wiring
  wireFollowMode();

  // Resize
  window.addEventListener('resize', onResize);

  // Try to load saved state
  const loaded = loadState();
  if (loaded) {
    setPhase('perform');
  } else {
    setPhase('explore');
  }

  // Initial inference
  iml.setInput(0, 0.5);
  iml.setInput(1, 0.5);
  iml.process();
  routeOutputs(iml.getOutputs());

  // Start animation
  animate();
}

// ============================================================
// Phase management
// ============================================================
function setPhase(p) {
  phase = p;
  app.className = `app phase-${p}`;
  delete app.dataset.teachMode;

  // Update dots
  document.querySelectorAll('.phase-dot').forEach(dot => {
    dot.classList.toggle('active', dot.dataset.phase === p);
  });

  // Phase-specific setup
  if (p === 'explore') {
    ctasShown = false;
    joystickInteractionTime = 0;
    const prompt = document.getElementById('prompt-text');
    if (prompt) prompt.textContent = 'Move the joystick to explore';
    document.getElementById('explore-ctas')?.classList.add('hidden');
  }

  if (p === 'teach') {
    updateTeachStatus();
  }

  if (p === 'perform') {
    resetIdleTimer();
    // Show audio control if synth mode
    const audioCtrl = document.getElementById('audio-control');
    if (audioCtrl) {
      audioCtrl.classList.toggle('hidden', outputMode !== 'synth');
    }
  }

  // Resize visualizer for canvas height change
  requestAnimationFrame(() => {
    setTimeout(() => onResize(), 450); // after CSS transition
  });
}

function wirePhaseNav() {
  document.querySelectorAll('.phase-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const target = dot.dataset.phase;
      if (target === 'teach' || target === 'perform') {
        setPhase(target);
      } else {
        setPhase('explore');
      }
    });
  });

  // Explore CTAs
  document.getElementById('cta-teach')?.addEventListener('click', () => {
    setPhase('teach');
  });

  document.getElementById('cta-preset')?.addEventListener('click', () => {
    // Load a preset, add examples at corners, train, go to perform
    loadPresetAndPerform(0);
  });
}

function loadPresetAndPerform(presetIdx) {
  const preset = PRESETS[presetIdx];
  // Add examples at 4 corners + center with this preset's outputs
  const positions = [[0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85], [0.5, 0.5]];
  iml.clearDataset();
  const paddedOutputs = padOutputs(preset.outputs);
  for (const [x, y] of positions) {
    iml.addExample([x, y], paddedOutputs);
  }
  iml.train();
  iml.setInput(0, joystickX);
  iml.setInput(1, joystickY);
  iml.process();
  routeOutputs(iml.getOutputs());
  saveState();
  setPhase('perform');
}

// ============================================================
// Output routing
// ============================================================
function routeOutputs(outputs) {
  if (outputMode === 'visual') {
    visualizer.setParams(outputs.slice(0, N_VISUAL_OUTPUTS));
  } else {
    synthVisualizer.setParams(outputs);
  }
  updateHeatmap(outputs);

  if (outputMode === 'synth' && c15 && c15.running) {
    for (let i = 0; i < outputs.length && i < SYNTH_PARAM_MAP.length; i++) {
      const tamed = applyTame(outputs[i], SYNTH_PARAM_MAP[i], tameLevel);
      c15.setParameter(SYNTH_PARAM_MAP[i].id, tamed);
    }
  }
}

// ============================================================
// Heatmap strip
// ============================================================
function buildHeatmap() {
  const container = document.getElementById('heatmap-cells');
  container.innerHTML = '';
  const count = currentParamNames.length;
  for (let i = 0; i < count; i++) {
    const cell = document.createElement('div');
    cell.className = 'heatmap-cell';
    cell.dataset.index = i;
    const bar = document.createElement('div');
    bar.className = 'heatmap-bar';
    bar.style.backgroundColor = currentParamColors[i] || '#ff6a00';
    bar.style.width = '50%';
    cell.appendChild(bar);
    container.appendChild(cell);
  }
  const strip = document.getElementById('heatmap-strip');
  strip.classList.toggle('wide', count > 30);
  document.getElementById('heatmap-count').textContent = String(count);
}

function updateHeatmap(outputs) {
  const bars = document.querySelectorAll('.heatmap-bar');
  for (let i = 0; i < bars.length && i < outputs.length; i++) {
    bars[i].style.width = (Math.max(0, Math.min(1, outputs[i])) * 100) + '%';
  }
}

function adjustBrightness(hex, brightness) {
  // Parse hex to RGB, then create HSL-ish brightness adjustment
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const factor = brightness / 100;
  return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
}

function wireHeatmapTooltip() {
  const strip = document.getElementById('heatmap-strip');
  const tooltip = document.getElementById('heatmap-tooltip');

  strip.addEventListener('pointerover', (e) => {
    const cell = e.target.closest('.heatmap-cell');
    if (!cell) { tooltip.classList.remove('show'); return; }
    const idx = parseInt(cell.dataset.index);
    const outputs = iml.getOutputs();
    const name = currentParamNames[idx] || `Param ${idx}`;
    const val = outputs[idx]?.toFixed(3) ?? '?';
    tooltip.textContent = `${name}: ${val}`;
    tooltip.classList.add('show');
  });

  strip.addEventListener('pointerout', () => {
    tooltip.classList.remove('show');
  });
}

// ============================================================
// Mode toggle (Visual/Synth)
// ============================================================
function wireModeToggle() {
  document.querySelectorAll('.mode-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      setOutputMode(mode);
      document.querySelectorAll('.mode-opt').forEach(b => b.classList.toggle('active', b === btn));
    });
  });
}

function setOutputMode(mode) {
  outputMode = mode;
  const visC = document.getElementById('vis-canvas');
  const synthC = document.getElementById('synth-vis-canvas');
  if (mode === 'synth') {
    currentParamNames = SYNTH_PARAM_NAMES;
    currentParamColors = SYNTH_PARAM_COLORS;
    document.getElementById('synth-section')?.classList.remove('hidden');
    // Toggle canvases
    visC?.classList.add('hidden');
    synthC?.classList.remove('hidden');
    synthVisualizer?.resize();
    // Update preset labels to synth names
    document.querySelectorAll('.preset-thumb span').forEach((span, i) => {
      if (PRESETS[i]) span.textContent = PRESETS[i].synth;
    });
  } else {
    currentParamNames = VISUAL_PARAM_NAMES;
    currentParamColors = VISUAL_PARAM_COLORS;
    document.getElementById('synth-section')?.classList.add('hidden');
    // Toggle canvases
    visC?.classList.remove('hidden');
    synthC?.classList.add('hidden');
    document.querySelectorAll('.preset-thumb span').forEach((span, i) => {
      if (PRESETS[i]) span.textContent = PRESETS[i].name;
    });
  }
  buildHeatmap();
  updateHeatmap(iml.getOutputs());
  buildParamSliders();

  // Show/hide audio control in perform phase
  const audioCtrl = document.getElementById('audio-control');
  if (audioCtrl) audioCtrl.classList.toggle('hidden', mode !== 'synth' || phase !== 'perform');
}

// Teach tabs removed — unified teaching panel shows all controls together

// ============================================================
// Preset grid
// ============================================================
function wirePresetGrid() {
  document.querySelectorAll('.preset-thumb').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.preset);
      selectedPreset = idx;
      document.querySelectorAll('.preset-thumb').forEach(b => b.classList.toggle('selected', b === btn));

      // Set the IML output state to this preset's values (for "Add Example")
      const paddedPreset = padOutputs(PRESETS[idx].outputs);
      iml.setOutputs(paddedPreset);
      routeOutputs(paddedPreset);
    });
  });
}

function renderPresetThumbnails() {
  // Render a tiny visualization for each preset
  const canvases = document.querySelectorAll('.preset-canvas');
  canvases.forEach((canvas, i) => {
    if (!PRESETS[i]) return;
    renderMiniPreview(canvas, PRESETS[i].outputs);
  });
}

function renderMiniPreview(canvas, outputs) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, w, h);

  // Draw a few colored dots to suggest the visual character
  const hueBase = outputs[3] * 360;
  const hueSpread = outputs[4] * 120;
  const speed = outputs[2];
  const turb = outputs[7];
  const particleSize = 1 + outputs[5] * 3;
  const count = 30;

  for (let p = 0; p < count; p++) {
    const hue = (hueBase + (p / count) * hueSpread) % 360;
    const x = w * 0.2 + Math.random() * w * 0.6;
    const y = h * 0.2 + Math.random() * h * 0.6;
    // Offset by speed/turbulence to hint at movement
    const ox = (Math.random() - 0.5) * turb * 10;
    const oy = (Math.random() - 0.5) * speed * 8;
    ctx.fillStyle = `hsl(${hue}, 70%, 55%)`;
    ctx.beginPath();
    ctx.arc(x + ox, y + oy, particleSize, 0, TWO_PI);
    ctx.fill();
  }
}

// ============================================================
// Teach actions
// ============================================================
function wireTeachActions() {
  document.getElementById('btn-add-example')?.addEventListener('click', () => {
    const outputs = iml.getOutputs();
    iml.addExample([joystickX, joystickY], outputs);
    updateTeachStatus();
    drawMinimap();

    // Pulse the train button
    const trainBtn = document.getElementById('btn-train');
    trainBtn?.classList.add('pulse');
  });

  document.getElementById('btn-train')?.addEventListener('click', () => {
    if (iml.exampleCount === 0) return;
    const trainBtn = document.getElementById('btn-train');
    trainBtn?.classList.remove('pulse');
    trainBtn.textContent = 'Training...';

    // Use setTimeout to allow UI update
    setTimeout(() => {
      iml.train({
        onIteration: (iter, loss) => {
          if (iter % 100 === 0) {
            trainBtn.textContent = `Loss: ${loss.toFixed(5)}`;
          }
        },
      });

      // Re-run inference
      iml.setInput(0, joystickX);
      iml.setInput(1, joystickY);
      iml.process();
      routeOutputs(iml.getOutputs());

      trainBtn.textContent = 'Train';
      updateTeachStatus();
      saveState();
    }, 50);
  });

  document.getElementById('btn-clear-examples')?.addEventListener('click', () => {
    iml.clearDataset();
    updateTeachStatus();
    drawMinimap();
  });

  document.getElementById('btn-clear')?.addEventListener('click', () => {
    iml.clearDataset();
    iml.randomiseWeights(spreadLevel);
    iml.setInput(0, joystickX);
    iml.setInput(1, joystickY);
    iml.process();
    routeOutputs(iml.getOutputs());
    selectedPreset = -1;
    document.querySelectorAll('.preset-thumb').forEach(b => b.classList.remove('selected'));
    updateTeachStatus();
    drawMinimap();
    clearSavedState();
  });

  document.getElementById('btn-randomize')?.addEventListener('click', () => {
    iml.randomiseWeights(spreadLevel);
    iml.setInput(0, joystickX);
    iml.setInput(1, joystickY);
    iml.process();
    routeOutputs(iml.getOutputs());
    updateTeachStatus();
  });

  document.getElementById('btn-done')?.addEventListener('click', () => {
    if (iml.exampleCount > 0 && iml.lastLoss === null) {
      // Auto-train if there are untrained examples
      iml.train();
      iml.setInput(0, joystickX);
      iml.setInput(1, joystickY);
      iml.process();
      routeOutputs(iml.getOutputs());
    }
    saveState();
    setPhase('perform');
  });
}

function updateTeachStatus() {
  const text = document.getElementById('status-text');
  if (!text) return;
  const count = iml.exampleCount;
  const lossStr = iml.lastLoss !== null ? ` \u00b7 loss ${iml.lastLoss.toFixed(5)}` : '';
  text.textContent = `${count} example${count !== 1 ? 's' : ''}${lossStr}`;
}

// ============================================================
// RL functions (standalone, callable from buttons or keyboard)
// ============================================================
function onThumbsUp() {
  const inputs = [joystickX, joystickY];
  const outputs = [...iml.getOutputs()];
  iml.addExample(inputs, outputs);
  iml.train();
  iml.setInput(0, joystickX);
  iml.setInput(1, joystickY);
  iml.process();
  routeOutputs(iml.getOutputs());
  noiseLevel = Math.max(0.005, noiseLevel * 0.7);
  updateNoiseRing();
  updateTeachStatus();
  drawMinimap();
  saveState();
}

function onThumbsDown() {
  const noiseCap = 0.3 * (1 - spreadLevel) + 0.05 * spreadLevel;
  noiseLevel = Math.min(noiseCap, noiseLevel * 1.5);
  iml.moveWeights(noiseLevel, spreadLevel);
  iml.setInput(0, joystickX);
  iml.setInput(1, joystickY);
  iml.process();
  routeOutputs(iml.getOutputs());
  updateNoiseRing();
}

function wireRLButtons() {
  document.getElementById('btn-thumbs-up')?.addEventListener('click', onThumbsUp);
  document.getElementById('btn-thumbs-down')?.addEventListener('click', onThumbsDown);
}

function updateNoiseRing() {
  const ring = document.getElementById('noise-ring');
  if (!ring) return;
  if (noiseLevel > 0.01) {
    const thickness = 2 + noiseLevel * 20;
    const opacity = 0.2 + noiseLevel * 1.2;
    ring.style.borderWidth = `${thickness}px`;
    ring.style.opacity = Math.min(1, opacity);
    ring.style.inset = `${-(8 + thickness)}px`;
  } else {
    ring.style.opacity = '0';
  }
}

// ============================================================
// Synth controls
// ============================================================
function wireSynthControls() {
  const startBtn = document.getElementById('synth-start');
  startBtn?.addEventListener('click', async () => {
    if (c15.running) {
      arpeggiator.stop();
      document.getElementById('arp-toggle').textContent = 'Play';
      await c15.stop();
      startBtn.textContent = 'Start Audio';
    } else {
      await c15.start();
      startBtn.textContent = 'Stop Audio';
      routeOutputs(iml.getOutputs());
    }
  });

  document.getElementById('synth-volume')?.addEventListener('input', (e) => {
    c15.setMasterVolume(parseFloat(e.target.value));
  });

  document.getElementById('arp-toggle')?.addEventListener('click', () => {
    if (!c15.running) return;
    const btn = document.getElementById('arp-toggle');
    if (arpeggiator.playing) {
      arpeggiator.stop();
      btn.textContent = 'Play';
    } else {
      arpeggiator.start();
      btn.textContent = 'Stop';
    }
  });

  document.getElementById('arp-progression')?.addEventListener('change', (e) => {
    arpeggiator.progression = e.target.value;
  });

  document.getElementById('arp-tempo')?.addEventListener('input', (e) => {
    arpeggiator.bpm = parseInt(e.target.value);
    const label = document.getElementById('tempo-val');
    if (label) label.textContent = e.target.value;
  });

  // Perform phase audio controls
  document.getElementById('audio-toggle')?.addEventListener('click', async () => {
    const btn = document.getElementById('audio-toggle');
    if (c15.running) {
      arpeggiator.stop();
      await c15.stop();
      btn.textContent = '\u25B6';
    } else {
      await c15.start();
      arpeggiator.start();
      btn.textContent = '\u23F8';
      routeOutputs(iml.getOutputs());
    }
  });

  document.getElementById('audio-vol')?.addEventListener('input', (e) => {
    c15.setMasterVolume(parseFloat(e.target.value));
  });
}

// ============================================================
// MIDI Input
// ============================================================
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
    if (cc === 1) updateJoystick(value, joystickY);
    if (cc === 2) updateJoystick(joystickX, value);
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

// ============================================================
// Perform UI (idle fading, edit button)
// ============================================================
function wirePerformUI() {
  document.getElementById('btn-edit')?.addEventListener('click', () => {
    setPhase('teach');
  });
}

function resetIdleTimer() {
  app.classList.remove('idle');
  if (idleTimer) clearTimeout(idleTimer);
  if (phase === 'perform') {
    idleTimer = setTimeout(() => {
      app.classList.add('idle');
    }, IDLE_TIMEOUT);
  }
}

// ============================================================
// Joystick (canvas-based, inline)
// ============================================================
function wireJoystick() {
  const canvas = document.getElementById('joystick-canvas');
  if (!canvas) return;

  const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    const x = (touch.clientX - rect.left) / rect.width;
    const y = (touch.clientY - rect.top) / rect.height;
    return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
  };

  const onStart = (e) => {
    e.preventDefault();
    joyDragging = true;
    const [x, y] = getPos(e);
    updateJoystick(x, y);
  };

  const onMove = (e) => {
    e.preventDefault();
    if (!joyDragging) return;
    const [x, y] = getPos(e);
    updateJoystick(x, y);
  };

  const onEnd = (e) => {
    e.preventDefault();
    joyDragging = false;
  };

  canvas.addEventListener('pointerdown', onStart);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onEnd);
  canvas.addEventListener('pointercancel', onEnd);
  canvas.addEventListener('pointerleave', onEnd);

  // Draw initial state
  drawJoystick();
}

function updateJoystick(x, y) {
  joyKnobX = x;
  joyKnobY = y;
  joystickX = x;
  joystickY = y;
  joystickActive = true;

  iml.setInput(0, x);
  iml.setInput(1, y);
  iml.process();
  routeOutputs(iml.getOutputs());

  // Explore phase: track interaction
  if (phase === 'explore') {
    joystickInteractionTime += 16; // rough frame time
    if (joystickInteractionTime > 3000 && !ctasShown) {
      ctasShown = true;
      const prompt = document.getElementById('prompt-text');
      if (prompt) prompt.textContent = 'Ready to teach it?';
      document.getElementById('explore-ctas')?.classList.remove('hidden');
    }
  }

  // Reset idle in perform
  if (phase === 'perform') {
    resetIdleTimer();
  }

  drawJoystick();
}

function drawJoystick() {
  const canvas = document.getElementById('joystick-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) / 2 - 4;

  // Background ring
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TWO_PI);
  ctx.fillStyle = 'rgba(13, 13, 13, 0.5)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Crosshair
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy - radius * 0.7);
  ctx.lineTo(cx, cy + radius * 0.7);
  ctx.moveTo(cx - radius * 0.7, cy);
  ctx.lineTo(cx + radius * 0.7, cy);
  ctx.stroke();

  // Knob
  const knobX = 4 + joyKnobX * (w - 8);
  const knobY = 4 + joyKnobY * (h - 8);
  const knobRadius = 10;

  ctx.beginPath();
  ctx.arc(knobX, knobY, knobRadius, 0, TWO_PI);
  ctx.fillStyle = 'rgba(255, 106, 0, 0.7)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 106, 0, 0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Glow
  const glow = ctx.createRadialGradient(knobX, knobY, 0, knobX, knobY, knobRadius * 2.5);
  glow.addColorStop(0, 'rgba(255, 106, 0, 0.15)');
  glow.addColorStop(1, 'rgba(255, 106, 0, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(knobX, knobY, knobRadius * 2.5, 0, TWO_PI);
  ctx.fill();
}

// ============================================================
// Follow mode
// ============================================================
function wireFollowMode() {
  const joyCanvas = document.getElementById('joystick-canvas');
  const followIndicator = document.getElementById('follow-indicator');
  const followPill = document.getElementById('follow-pill');

  function toggleFollowMode() {
    followMode = !followMode;
    followIndicator?.classList.toggle('hidden', !followMode);
    followPill?.classList.toggle('active', followMode);
  }

  // Double-click joystick canvas toggles follow mode
  joyCanvas?.addEventListener('dblclick', (e) => {
    e.preventDefault();
    toggleFollowMode();
  });

  // Follow pill toggle
  followPill?.addEventListener('click', (e) => {
    e.preventDefault();
    toggleFollowMode();
  });

  // Global pointermove for follow mode
  const visCanvas = document.getElementById('vis-canvas');
  window.addEventListener('pointermove', (e) => {
    if (!followMode) return;
    // Map cursor position to 0..1 relative to vis-canvas or full window
    const target = visCanvas || document.body;
    const rect = target.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    updateJoystick(x, y);
  });
}

// ============================================================
// Minimap (training examples positions)
// ============================================================
function drawMinimap() {
  const canvas = document.getElementById('minimap');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = 'rgba(13, 13, 13, 0.9)';
  ctx.fillRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const p = (i / 4) * w;
    ctx.beginPath();
    ctx.moveTo(p, 0); ctx.lineTo(p, h);
    ctx.moveTo(0, p); ctx.lineTo(w, p);
    ctx.stroke();
  }

  // Example dots
  const features = iml.dataset.features;
  if (!features) return;
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    if (!f || f.length < 2) continue;
    const x = f[0] * w;
    const y = f[1] * h;
    ctx.fillStyle = 'rgba(255, 106, 0, 0.8)';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, TWO_PI);
    ctx.fill();
  }

  // Current position
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(joystickX * w, joystickY * h, 5, 0, TWO_PI);
  ctx.stroke();
}

// ============================================================
// Param sliders (fine-tune)
// ============================================================
function buildParamSliders() {
  const container = document.getElementById('param-sliders');
  if (!container) return;
  container.innerHTML = '';

  const outputs = iml.getOutputs();
  for (let i = 0; i < currentParamNames.length; i++) {
    const row = document.createElement('div');
    row.className = 'param-slider-row';
    const label = document.createElement('label');
    label.textContent = currentParamNames[i];
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '0.01';
    input.value = outputs[i] ?? 0.5;
    input.dataset.index = i;

    input.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.index);
      iml.setOutput(idx, parseFloat(e.target.value));
      routeOutputs(iml.getOutputs());
    });

    row.appendChild(label);
    row.appendChild(input);
    container.appendChild(row);
  }
}

function updateParamSliders() {
  const sliders = document.querySelectorAll('.param-slider-row input[type="range"]');
  const outputs = iml.getOutputs();
  sliders.forEach(slider => {
    const idx = parseInt(slider.dataset.index);
    if (idx < outputs.length) {
      slider.value = outputs[idx];
    }
  });
}

// ============================================================
// Resize
// ============================================================
function onResize() {
  visualizer.resize();
  visualizer.initParticles();
  if (synthVisualizer) synthVisualizer.resize();
  drawJoystick();
}

// ============================================================
// Animation loop
// ============================================================
function animate() {
  if (!animating) return;
  if (gamepad) gamepad.poll();

  if (outputMode === 'synth') {
    synthVisualizer.draw();
  } else {
    visualizer.draw();
  }

  // Keep minimap updated if in teach phase
  if (phase === 'teach') {
    // Only redraw minimap occasionally
    if (Math.random() < 0.05) drawMinimap();
  }

  requestAnimationFrame(animate);
}

// ============================================================
// Save / Load state
// ============================================================
function saveState() {
  try {
    const data = {
      features: iml.dataset.features.slice(0, iml.dataset.size),
      labels: iml.dataset.labels.slice(0, iml.dataset.size),
      weights: iml.mlp.getWeights(),
      outputMode,
      joystickX,
      joystickY,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save state:', e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.features || data.features.length === 0) return false;

    // Restore dataset
    for (let i = 0; i < data.features.length; i++) {
      iml.addExample(data.features[i], data.labels[i]);
    }

    // Restore weights
    if (data.weights) {
      iml.mlp.setWeights(data.weights);
    }

    // Restore output mode
    if (data.outputMode) {
      setOutputMode(data.outputMode);
      document.querySelectorAll('.mode-opt').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === data.outputMode);
      });
    }

    // Restore joystick position
    if (data.joystickX !== undefined) {
      joystickX = data.joystickX;
      joystickY = data.joystickY;
      joyKnobX = joystickX;
      joyKnobY = joystickY;
    }

    return true;
  } catch (e) {
    console.warn('Failed to load state:', e);
    return false;
  }
}

function clearSavedState() {
  localStorage.removeItem(STORAGE_KEY);
}

// ============================================================
// Boot
// ============================================================
document.addEventListener('DOMContentLoaded', init);
