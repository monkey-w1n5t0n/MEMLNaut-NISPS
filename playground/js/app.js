// NISPS Playground - Main application
// Wires IML engine to visual system OR C15 synth with joystick input and unified learning controls

import { IML } from './nisps/iml.js';
import { FlowFieldVisualizer } from './ui/visualizer.js';
import { VirtualJoystick } from './ui/joystick.js';
import { Controls } from './ui/controls.js';
import { ParamDisplay } from './ui/param-display.js';
import { C15Bridge } from './synth/c15-bridge.js';
import { Arpeggiator } from './synth/arpeggiator.js';
import { SYNTH_PARAM_MAP, SYNTH_PARAM_NAMES, SYNTH_PARAM_COLORS, applyTame } from './synth/param-map.js';
import { GamepadInput } from './ui/gamepad.js';

const N_INPUTS = 2;
const N_VISUAL_OUTPUTS = 20;
const N_SYNTH_OUTPUTS = SYNTH_PARAM_MAP.length; // 126
const N_OUTPUTS = N_SYNTH_OUTPUTS; // MLP always produces full output; visual uses first 20

// Visual mode param display config
const VISUAL_PARAM_NAMES = ['Flow', 'Scale', 'Speed', 'Hue', 'Spread', 'Size', 'Trail', 'Turb', 'Attract', 'Radius', 'DispRate', 'DispAmt', 'Lifetime', 'Respawn', 'Advection', 'Inertia', 'Drag', 'Repulse', 'RepCnt', 'RepRate'];
const VISUAL_PARAM_COLORS = ['#ff6a00', '#00ccff', '#ff6600', '#ff00cc', '#ffcc00', '#88ff00', '#0088ff', '#ff3366', '#9bff5f', '#59d3ff', '#ff8f3f', '#a0b7ff', '#f4ff7a', '#ffa8db', '#7dffc8', '#ffd166', '#8ad4ff', '#ff5f5f', '#ffc15f', '#ff8a3d'];

// --- State ---
let iml;
let visualizer;
let joystick;
let controls;
let paramDisplay;
let outputMode = 'visual';    // 'visual' | 'synth'
let noiseLevel = 0.05;
let rlExplorationDecay = 0.97;
let animating = true;
let gamepad;
let gamepadConnected = false;
let followMode = false;
let visualExpanded = false;
let appRoot;
let expandVisualBtn;

// Synth state
let c15 = null;
let arpeggiator = null;

// Devmode: tame level (0 = no mitigation, 1 = strongest)
// Set via URL ?tame=0.7 or window.setTameLevel(0.7)
const _urlParams = new URLSearchParams(location.search);
let tameLevel = parseFloat(_urlParams.get('tame') ?? '1');
if (isNaN(tameLevel)) tameLevel = 1;
tameLevel = Math.max(0, Math.min(1, tameLevel));
let spreadLevel = parseFloat(_urlParams.get('spread') ?? '0.6');
if (isNaN(spreadLevel)) spreadLevel = 0.6;
spreadLevel = Math.max(0, Math.min(1, spreadLevel));
window.setTameLevel = (v) => { tameLevel = Math.max(0, Math.min(1, v)); console.log(`[NISPS] tame=${tameLevel}`); };
window.getTameLevel = () => tameLevel;

// --- Init ---
function init() {
  iml = new IML(N_INPUTS, N_OUTPUTS, [32, 48, 64], 1000, 1.0, 0.00001);
  iml.setLogger(msg => console.log('[NISPS]', msg));

  // Visualizer
  appRoot = document.querySelector('.app');
  expandVisualBtn = document.getElementById('expand-visual-btn');

  const canvas = document.getElementById('visual-canvas');
  visualizer = new FlowFieldVisualizer(canvas);

  // Joystick
  joystick = new VirtualJoystick(document.getElementById('joystick-container'), {
    size: 160,
    trackpadScale: 2,
    springBack: false,
    onChange: onJoystickMove,
    onFollowModeChange: (enabled) => {
      followMode = enabled;
      refreshDashboard();
    },
  });

  // Parameter display (start in visual mode with 20 params)
  paramDisplay = new ParamDisplay(document.getElementById('param-display'), N_VISUAL_OUTPUTS);

  // Controls
  controls = new Controls(document.getElementById('controls-container'), {
    onAddExample,
    onTrain,
    onRandomize,
    onClear,
    onClearExamples,
    onThumbsUp,
    onThumbsDown,
  });

  // Resize handling
  window.addEventListener('resize', () => {
    resizeVisualizerSurface();
  });

  if (expandVisualBtn) {
    expandVisualBtn.addEventListener('click', () => setVisualExpanded(!visualExpanded));
    updateExpandButtonState();
  }

  // Help overlay
  const helpBtn = document.getElementById('help-btn');
  const helpOverlay = document.getElementById('help-overlay');
  if (helpBtn && helpOverlay) {
    helpBtn.addEventListener('click', () => helpOverlay.classList.toggle('hidden'));
    helpOverlay.addEventListener('click', () => helpOverlay.classList.add('hidden'));
  }

  // Side panel
  initSidePanel();

  // Init synth
  c15 = new C15Bridge();
  c15.onStatusChange = (msg) => {
    const el = document.getElementById('synth-status');
    if (el) el.textContent = msg;
  };
  c15.loadParams();
  arpeggiator = new Arpeggiator(c15);

  // Wire synth controls
  initSynthControls();

  gamepad = new GamepadInput({
    onMove: (x, y) => {
      if (paramDisplay.activeBar < 0) {
        joystick.setPosition(x, y, { emit: true, touching: true });
      }
    },
    onButton: (btn) => {
      if (btn === 'rb') onThumbsUp();
      if (btn === 'lb') onThumbsDown();
    },
    onConnectionChange: (connected) => {
      gamepadConnected = connected;
      refreshDashboard();
    },
  });
  window.addEventListener('keydown', onKeyDown);

  // Run initial inference to populate outputs
  iml.setInput(0, 0.5);
  iml.setInput(1, 0.5);
  iml.process();
  visualizer.setParams(iml.getOutputs());
  paramDisplay.update(iml.getOutputs());
  controls.updateStatus(iml.exampleCount, iml.lastLoss, noiseLevel);
  controls.updateLossPlot(iml.lossHistory);
  refreshDashboard();

  // Start animation
  animate();

  // Load from localStorage if available
  loadState();
}

// --- Side Panel ---
function initSidePanel() {
  const panel = document.getElementById('side-panel');
  const toggle = document.getElementById('side-panel-toggle');
  const close = document.getElementById('side-panel-close');
  const backdrop = document.getElementById('side-panel-backdrop');

  const openPanel = () => {
    panel.classList.add('open');
    backdrop.classList.remove('hidden');
  };
  const closePanel = () => {
    panel.classList.remove('open');
    backdrop.classList.add('hidden');
  };

  toggle.addEventListener('click', openPanel);
  close.addEventListener('click', closePanel);
  backdrop.addEventListener('click', closePanel);

  // Tab switching
  panel.querySelectorAll('.sp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.mode;
      setOutputMode(mode);

      panel.querySelectorAll('.sp-tab').forEach(t => t.classList.toggle('active', t === tab));
    });
  });
}

function setOutputMode(mode) {
  outputMode = mode;

  const synthControls = document.getElementById('synth-controls');
  const visualInfo = document.getElementById('visual-info');
  const presetsVisual = document.getElementById('presets-visual');
  const modeBadge = document.getElementById('mode-badge');
  const paramContainer = document.getElementById('param-display');

  if (mode === 'synth') {
    synthControls.classList.remove('hidden');
    visualInfo.classList.add('hidden');
    presetsVisual.classList.add('hidden');
    modeBadge.textContent = 'Synth';
    modeBadge.classList.add('synth');
    paramContainer.classList.add('synth-mode');

    // Rebuild param display with all synth params
    paramDisplay.rebuild(N_SYNTH_OUTPUTS, SYNTH_PARAM_NAMES, SYNTH_PARAM_COLORS);
    paramDisplay.setDraggable(true);
  } else {
    synthControls.classList.add('hidden');
    visualInfo.classList.remove('hidden');
    presetsVisual.classList.remove('hidden');
    modeBadge.textContent = 'Visual';
    modeBadge.classList.remove('synth');
    paramContainer.classList.remove('synth-mode');

    // Rebuild param display with visual params (first 20)
    paramDisplay.rebuild(N_VISUAL_OUTPUTS, VISUAL_PARAM_NAMES, VISUAL_PARAM_COLORS);
    paramDisplay.setDraggable(true);
  }

  // Re-run inference and route outputs
  routeOutputs(iml.getOutputs());
}

function routeOutputs(outputs) {
  // Always update visualizer (it's always visible)
  visualizer.setParams(outputs);

  // If in synth mode, also send to C15 with tame-level constraining
  if (outputMode === 'synth' && c15 && c15.running) {
    for (let i = 0; i < outputs.length && i < SYNTH_PARAM_MAP.length; i++) {
      const value = applyTame(outputs[i], SYNTH_PARAM_MAP[i], tameLevel);
      c15.setParameter(SYNTH_PARAM_MAP[i].id, value);
    }
  }
}

// --- Synth Controls ---
function initSynthControls() {
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
      arpToggle.classList.remove('playing');
      await c15.stop();
      startBtn.textContent = 'Start Audio';
    } else {
      await c15.start();
      startBtn.textContent = 'Stop Audio';
      // Send current NISPS outputs to synth
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
      arpToggle.classList.remove('playing');
    } else {
      arpeggiator.start();
      arpToggle.textContent = 'Stop';
      arpToggle.classList.add('playing');
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

// --- Animation loop ---
function animate() {
  if (!animating) return;
  gamepad.poll();
  visualizer.draw();
  requestAnimationFrame(animate);
}

// --- Joystick handler ---
function onJoystickMove(x, y) {
  iml.setInput(0, x);
  iml.setInput(1, y);
  iml.process();

  const outputs = iml.getOutputs();
  routeOutputs(outputs);

  // Only update param display from network in inference (not when user is dragging)
  if (paramDisplay.activeBar < 0) {
    paramDisplay.update(outputs);
  }

  refreshDashboard();
}

// --- Examples mode callbacks ---
function onAddExample() {
  // Use current joystick position as input, param bar values as desired output
  const inputs = [joystick.x, joystick.y];
  const outputs = [...paramDisplay.values];
  iml.addExample(inputs, outputs);
  controls.updateStatus(iml.exampleCount, iml.lastLoss, noiseLevel);
  refreshDashboard();
  flash('btn-add');
}

function onTrain() {
  const loss = trainModel();
  if (loss !== null) {
    // After training, switch back to inference and update display
    const outputs = iml.getOutputs();
    routeOutputs(outputs);
    paramDisplay.update(outputs);
    controls.updateStatus(iml.exampleCount, loss, noiseLevel);
    controls.updateLossPlot(iml.lossHistory);
    refreshDashboard();
    flash('btn-train');
  }
}

function onRandomize() {
  iml.randomiseWeights(spreadLevel);
  iml.setInput(0, joystick.x);
  iml.setInput(1, joystick.y);
  iml.process();
  const outputs = iml.getOutputs();
  routeOutputs(outputs);
  paramDisplay.update(outputs);
  noiseLevel = 0.05; // reset noise
  controls.updateStatus(iml.exampleCount, iml.lastLoss, noiseLevel);
  refreshDashboard();
}

function onClearExamples() {
  iml.clearDataset();
  controls.updateStatus(0, iml.lastLoss, noiseLevel);
  refreshDashboard();
}

function onClear() {
  iml.clearDataset();
  iml.lossHistory = [];
  iml.bestLoss = null;
  iml.totalTrainingIterations = 0;
  noiseLevel = 0.05;
  controls.updateStatus(0, null, noiseLevel);
  controls.updateLossPlot(iml.lossHistory);
  refreshDashboard();
  clearState();
}

// --- RL mode callbacks ---
function onThumbsUp() {
  // Save current input->output mapping as a positive example
  const inputs = [joystick.x, joystick.y];
  const outputs = [...iml.getOutputs()];
  iml.addExample(inputs, outputs);

  // Retrain incrementally
  trainModel();
  const trainedOutputs = iml.getOutputs();
  routeOutputs(trainedOutputs);
  paramDisplay.update(trainedOutputs);

  // Decay noise - more positive examples = less exploration
  noiseLevel *= rlExplorationDecay;
  noiseLevel = Math.max(noiseLevel, 0.005);

  controls.updateStatus(iml.exampleCount, iml.lastLoss, noiseLevel);
  controls.updateLossPlot(iml.lossHistory);
  refreshDashboard();
  flash('btn-thumbsup');
}

function onThumbsDown() {
  // Increase noise for more exploration
  // spread reduces the noise cap: at spread=1 cap is 0.05 (vs 0.3 at spread=0)
  const noiseCap = 0.3 * (1 - spreadLevel) + 0.05 * spreadLevel;
  noiseLevel = Math.min(noiseLevel * 1.5, noiseCap);

  // Perturb weights (spread scales noise per-layer by 1/sqrt(fan_in))
  iml.moveWeights(noiseLevel, spreadLevel);

  const outputs = iml.getOutputs();
  routeOutputs(outputs);
  paramDisplay.update(outputs);
  controls.updateStatus(iml.exampleCount, iml.lastLoss, noiseLevel);
  refreshDashboard();
  flash('btn-thumbsdown');
}

function onKeyDown(e) {
  if (e.key === 'Escape' && visualExpanded) {
    setVisualExpanded(false);
    return;
  }

  if (!followMode || e.repeat) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.key === '1' || e.code === 'Numpad1') {
    e.preventDefault();
    onThumbsDown();
  } else if (e.key === '2' || e.code === 'Numpad2') {
    e.preventDefault();
    onThumbsUp();
  }
}

function resizeVisualizerSurface() {
  visualizer.resize();
  visualizer.initParticles();
}

function updateExpandButtonState() {
  if (!expandVisualBtn) return;
  expandVisualBtn.textContent = visualExpanded ? 'Collapse' : 'Expand';
  expandVisualBtn.title = visualExpanded ? 'Collapse visual area' : 'Expand visual area';
  expandVisualBtn.setAttribute('aria-pressed', visualExpanded ? 'true' : 'false');
}

function setVisualExpanded(expanded) {
  visualExpanded = expanded;
  if (appRoot) {
    appRoot.classList.toggle('expanded', visualExpanded);
  }
  updateExpandButtonState();

  // Let CSS layout settle before resizing the drawing surface.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      resizeVisualizerSurface();
    });
  });
}

// --- Presets ---
// Pad a 20-element visual preset array to N_OUTPUTS with 0.5 defaults
function padPreset(values20) {
  const padded = new Array(N_OUTPUTS).fill(0.5);
  for (let i = 0; i < values20.length; i++) padded[i] = values20[i];
  return padded;
}

window.loadPreset = function(name) {
  iml.clearDataset();

  if (name === 'calm-to-chaotic') {
    // Bottom-left: slow, smooth, cool; top-right: fast, turbulent, warm
    iml.addExample([0.1, 0.9], padPreset([0.25, 0.3, 0.1, 0.55, 0.2, 0.3, 0.02, 0.05, 0.9, 0.45, 0.25, 0.2, 0.9, 0.0, 0.0, 0.2, 0.05, 0.0, 0.0, 0.2]));
    iml.addExample([0.9, 0.1], padPreset([0.75, 0.7, 0.9, 0.05, 0.8, 0.7, 0.9, 0.95, 0.3, 0.2, 0.85, 0.7, 0.25, 0.55, 1.0, 0.92, 0.02, 0.95, 0.8, 0.85]));
    iml.addExample([0.5, 0.5], padPreset([0.5, 0.5, 0.5, 0.3, 0.5, 0.5, 0.4, 0.5, 0.7, 0.6, 0.5, 0.45, 0.55, 0.9, 0.5, 0.65, 0.08, 0.45, 0.4, 0.5]));
  } else if (name === 'rainbow-sweep') {
    // Left to right sweeps through hues
    iml.addExample([0.0, 0.5], padPreset([0.5, 0.5, 0.4, 0.0, 0.3, 0.4, 0.05, 0.3, 0.8, 0.55, 0.4, 0.3, 0.8, 0.0, 0.0, 0.45, 0.08, 0.2, 0.25, 0.45]));
    iml.addExample([0.5, 0.5], padPreset([0.5, 0.5, 0.4, 0.5, 0.3, 0.4, 0.05, 0.3, 0.8, 0.55, 0.55, 0.35, 0.7, 0.0, 0.4, 0.45, 0.08, 0.45, 0.4, 0.6]));
    iml.addExample([1.0, 0.5], padPreset([0.5, 0.5, 0.4, 1.0, 0.3, 0.4, 0.05, 0.3, 0.8, 0.55, 0.75, 0.45, 0.6, 0.0, 0.8, 0.45, 0.08, 0.7, 0.55, 0.75]));
  } else if (name === 'vortex') {
    // Center: tight spiral, edges: wide flow
    iml.addExample([0.5, 0.5], padPreset([0.0, 0.8, 0.8, 0.6, 0.1, 0.15, 0.02, 1.0, 1.0, 0.3, 0.95, 0.85, 0.25, 1.0, 0.5, 0.95, 0.01, 1.0, 1.0, 1.0]));
    iml.addExample([0.0, 0.0], padPreset([0.5, 0.2, 0.3, 0.8, 0.9, 0.6, 0.08, 0.1, 0.35, 0.8, 0.25, 0.15, 0.8, 0.5, 0.2, 0.35, 0.2, 0.15, 0.2, 0.25]));
    iml.addExample([1.0, 1.0], padPreset([0.5, 0.2, 0.3, 0.2, 0.9, 0.6, 0.08, 0.1, 0.35, 0.8, 0.25, 0.15, 0.8, 0.5, 0.8, 0.35, 0.2, 0.15, 0.2, 0.25]));
    iml.addExample([0.0, 1.0], padPreset([0.3, 0.4, 0.5, 0.4, 0.5, 0.4, 0.05, 0.5, 0.65, 0.5, 0.55, 0.45, 0.45, 0.2, 0.4, 0.7, 0.1, 0.5, 0.4, 0.55]));
    iml.addExample([1.0, 0.0], padPreset([0.7, 0.4, 0.5, 0.0, 0.5, 0.4, 0.05, 0.5, 0.65, 0.5, 0.55, 0.45, 0.45, 0.2, 0.9, 0.7, 0.1, 0.5, 0.4, 0.55]));
  }

  const loss = trainModel();
  const outputs = iml.getOutputs();
  routeOutputs(outputs);
  paramDisplay.update(outputs);
  controls.updateStatus(iml.exampleCount, loss, noiseLevel);
  controls.updateLossPlot(iml.lossHistory);
  refreshDashboard();
};

// --- Persistence ---
function saveState() {
  try {
    const state = {
      features: iml.dataset.features,
      labels: iml.dataset.labels,
    };
    localStorage.setItem('nisps-playground', JSON.stringify(state));
  } catch (e) { /* ignore */ }
}

function loadState() {
  try {
    const data = JSON.parse(localStorage.getItem('nisps-playground'));
    if (data && data.features && data.features.length > 0) {
      for (let i = 0; i < data.features.length; i++) {
        // Pad old saves (20 outputs) to current N_OUTPUTS with 0.5 defaults
        const labels = data.labels[i];
        if (labels.length < N_OUTPUTS) {
          while (labels.length < N_OUTPUTS) labels.push(0.5);
        }
        iml.addExample(data.features[i], labels);
      }
      trainModel();
      const outputs = iml.getOutputs();
      routeOutputs(outputs);
      paramDisplay.update(outputs);
      controls.updateStatus(iml.exampleCount, iml.lastLoss, noiseLevel);
      controls.updateLossPlot(iml.lossHistory);
      refreshDashboard();
    }
  } catch (e) { /* ignore */ }
}

function clearState() {
  try { localStorage.removeItem('nisps-playground'); } catch (e) { /* ignore */ }
}

// Auto-save periodically
setInterval(saveState, 10000);

// Visual feedback flash
function flash(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 200);
}

function trainModel() {
  let lastPlotUpdate = 0;
  const loss = iml.train({
    onIteration: (iter, iterLoss) => {
      if (iter - lastPlotUpdate < 8) return;
      lastPlotUpdate = iter;
      controls.updateLossPlot([...iml.lossHistory, iterLoss]);
    },
  });
  return loss;
}

function refreshDashboard() {
  const outputs = iml.getOutputs();
  let mean = 0;
  for (let i = 0; i < outputs.length; i++) mean += outputs[i];
  mean /= Math.max(outputs.length, 1);

  let variance = 0;
  for (let i = 0; i < outputs.length; i++) {
    const diff = outputs[i] - mean;
    variance += diff * diff;
  }
  variance /= Math.max(outputs.length, 1);

  controls.updateMetrics({
    joystickX: joystick.x,
    joystickY: joystick.y,
    outputMean: mean,
    outputSpread: Math.sqrt(variance),
    bestLoss: iml.bestLoss,
    totalTrainingIterations: iml.totalTrainingIterations,
    gamepadConnected,
    followMode,
  });
}

// --- Start ---
document.addEventListener('DOMContentLoaded', () => {
  init();
  // Always enable param dragging
  paramDisplay.setDraggable(true);
});
