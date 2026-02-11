// NISPS Playground - Main application
// Wires IML engine to visual system with joystick input and dual learning modes

import { IML } from './nisps/iml.js';
import { FlowFieldVisualizer } from './ui/visualizer.js';
import { VirtualJoystick } from './ui/joystick.js';
import { Controls } from './ui/controls.js';
import { ParamDisplay } from './ui/param-display.js';

const N_INPUTS = 2;
const N_OUTPUTS = 20;

// --- State ---
let iml;
let visualizer;
let joystick;
let controls;
let paramDisplay;
let learningMode = 'examples'; // 'examples' | 'rl'
let noiseLevel = 0.05;
let rlExplorationDecay = 0.97;
let animating = true;
let gamepadIndex = -1;
let gamepadButtonsPrev = [];
let gamepadConnected = false;
let gamepadLastAxes = [0.5, 0.5];

// --- Init ---
function init() {
  iml = new IML(N_INPUTS, N_OUTPUTS, [10, 10, 14], 1000, 1.0, 0.00001);
  iml.setLogger(msg => console.log('[NISPS]', msg));

  // Visualizer
  const canvas = document.getElementById('visual-canvas');
  visualizer = new FlowFieldVisualizer(canvas);

  // Joystick
  joystick = new VirtualJoystick(document.getElementById('joystick-container'), {
    size: 160,
    springBack: false,
    onChange: onJoystickMove,
  });

  // Parameter display
  paramDisplay = new ParamDisplay(document.getElementById('param-display'), N_OUTPUTS);

  // Controls
  controls = new Controls(document.getElementById('controls-container'), {
    onAddExample,
    onTrain,
    onRandomize,
    onClear,
    onThumbsUp,
    onThumbsDown,
    onModeChange,
  });

  // Resize handling
  window.addEventListener('resize', () => {
    visualizer.resize();
    visualizer.initParticles();
  });

  // Help overlay
  const helpBtn = document.getElementById('help-btn');
  const helpOverlay = document.getElementById('help-overlay');
  if (helpBtn && helpOverlay) {
    helpBtn.addEventListener('click', () => helpOverlay.classList.toggle('hidden'));
    helpOverlay.addEventListener('click', () => helpOverlay.classList.add('hidden'));
  }

  window.addEventListener('gamepadconnected', () => refreshDashboard());
  window.addEventListener('gamepaddisconnected', () => refreshDashboard());

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

// --- Animation loop ---
function animate() {
  if (!animating) return;
  pollGamepad();
  visualizer.draw();
  requestAnimationFrame(animate);
}

// --- Joystick handler ---
function onJoystickMove(x, y) {
  iml.setInput(0, x);
  iml.setInput(1, y);
  iml.process();

  const outputs = iml.getOutputs();
  visualizer.setParams(outputs);

  // Only update param display from network in inference (not when user is dragging)
  if (learningMode !== 'examples' || paramDisplay.activeBar < 0) {
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
    visualizer.setParams(outputs);
    paramDisplay.update(outputs);
    controls.updateStatus(iml.exampleCount, loss, noiseLevel);
    controls.updateLossPlot(iml.lossHistory);
    refreshDashboard();
    flash('btn-train');
  }
}

function onRandomize() {
  iml.randomiseWeights();
  const outputs = iml.getOutputs();
  visualizer.setParams(outputs);
  paramDisplay.update(outputs);
  noiseLevel = 0.05; // reset noise
  controls.updateStatus(iml.exampleCount, iml.lastLoss, noiseLevel);
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
  noiseLevel = Math.min(noiseLevel * 1.5, 0.3);

  // Perturb weights
  iml.moveWeights(noiseLevel);

  const outputs = iml.getOutputs();
  visualizer.setParams(outputs);
  paramDisplay.update(outputs);
  controls.updateStatus(iml.exampleCount, iml.lastLoss, noiseLevel);
  refreshDashboard();
  flash('btn-thumbsdown');
}

function onModeChange(mode) {
  learningMode = mode;
  if (mode === 'examples') {
    paramDisplay.setDraggable(true);
  } else {
    paramDisplay.setDraggable(false);
  }
  controls.updateStatus(iml.exampleCount, iml.lastLoss, noiseLevel);
  refreshDashboard();
}

// --- Presets ---
window.loadPreset = function(name) {
  iml.clearDataset();

  if (name === 'calm-to-chaotic') {
    // Bottom-left: slow, smooth, cool; top-right: fast, turbulent, warm
    iml.addExample([0.1, 0.9], [0.25, 0.3, 0.1, 0.55, 0.2, 0.3, 0.02, 0.05, 0.9, 0.45, 0.25, 0.2, 0.9, 0.0, 0.0, 0.2, 0.05, 0.0, 0.0, 0.2]);
    iml.addExample([0.9, 0.1], [0.75, 0.7, 0.9, 0.05, 0.8, 0.7, 0.9, 0.95, 0.3, 0.2, 0.85, 0.7, 0.25, 0.55, 1.0, 0.92, 0.02, 0.95, 0.8, 0.85]);
    iml.addExample([0.5, 0.5], [0.5, 0.5, 0.5, 0.3, 0.5, 0.5, 0.4, 0.5, 0.7, 0.6, 0.5, 0.45, 0.55, 0.9, 0.5, 0.65, 0.08, 0.45, 0.4, 0.5]);
  } else if (name === 'rainbow-sweep') {
    // Left to right sweeps through hues
    iml.addExample([0.0, 0.5], [0.5, 0.5, 0.4, 0.0, 0.3, 0.4, 0.05, 0.3, 0.8, 0.55, 0.4, 0.3, 0.8, 0.0, 0.0, 0.45, 0.08, 0.2, 0.25, 0.45]);
    iml.addExample([0.5, 0.5], [0.5, 0.5, 0.4, 0.5, 0.3, 0.4, 0.05, 0.3, 0.8, 0.55, 0.55, 0.35, 0.7, 0.0, 0.4, 0.45, 0.08, 0.45, 0.4, 0.6]);
    iml.addExample([1.0, 0.5], [0.5, 0.5, 0.4, 1.0, 0.3, 0.4, 0.05, 0.3, 0.8, 0.55, 0.75, 0.45, 0.6, 0.0, 0.8, 0.45, 0.08, 0.7, 0.55, 0.75]);
  } else if (name === 'vortex') {
    // Center: tight spiral, edges: wide flow
    iml.addExample([0.5, 0.5], [0.0, 0.8, 0.8, 0.6, 0.1, 0.15, 0.02, 1.0, 1.0, 0.3, 0.95, 0.85, 0.25, 1.0, 0.5, 0.95, 0.01, 1.0, 1.0, 1.0]);
    iml.addExample([0.0, 0.0], [0.5, 0.2, 0.3, 0.8, 0.9, 0.6, 0.08, 0.1, 0.35, 0.8, 0.25, 0.15, 0.8, 0.5, 0.2, 0.35, 0.2, 0.15, 0.2, 0.25]);
    iml.addExample([1.0, 1.0], [0.5, 0.2, 0.3, 0.2, 0.9, 0.6, 0.08, 0.1, 0.35, 0.8, 0.25, 0.15, 0.8, 0.5, 0.8, 0.35, 0.2, 0.15, 0.2, 0.25]);
    iml.addExample([0.0, 1.0], [0.3, 0.4, 0.5, 0.4, 0.5, 0.4, 0.05, 0.5, 0.65, 0.5, 0.55, 0.45, 0.45, 0.2, 0.4, 0.7, 0.1, 0.5, 0.4, 0.55]);
    iml.addExample([1.0, 0.0], [0.7, 0.4, 0.5, 0.0, 0.5, 0.4, 0.05, 0.5, 0.65, 0.5, 0.55, 0.45, 0.45, 0.2, 0.9, 0.7, 0.1, 0.5, 0.4, 0.55]);
  }

  const loss = trainModel();
  const outputs = iml.getOutputs();
  visualizer.setParams(outputs);
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
        iml.addExample(data.features[i], data.labels[i]);
      }
      trainModel();
      const outputs = iml.getOutputs();
      visualizer.setParams(outputs);
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
    mode: learningMode,
    joystickX: joystick.x,
    joystickY: joystick.y,
    outputMean: mean,
    outputSpread: Math.sqrt(variance),
    bestLoss: iml.bestLoss,
    totalTrainingIterations: iml.totalTrainingIterations,
    gamepadConnected,
  });
}

function pollGamepad() {
  if (!navigator.getGamepads) return;
  const gamepads = navigator.getGamepads();
  let gp = null;

  if (gamepadIndex >= 0 && gamepads[gamepadIndex] && gamepads[gamepadIndex].connected) {
    gp = gamepads[gamepadIndex];
  } else {
    gamepadIndex = -1;
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i] && gamepads[i].connected) {
        gp = gamepads[i];
        gamepadIndex = i;
        break;
      }
    }
  }

  const wasConnected = gamepadConnected;
  gamepadConnected = !!gp;
  if (wasConnected !== gamepadConnected) refreshDashboard();
  if (!gp) {
    gamepadButtonsPrev = [];
    return;
  }

  const deadzone = 0.08;
  const rawX = gp.axes[0] || 0;
  const rawY = gp.axes[1] || 0;
  const axisX = Math.abs(rawX) < deadzone ? 0 : rawX;
  const axisY = Math.abs(rawY) < deadzone ? 0 : rawY;
  const mappedX = (axisX + 1) * 0.5;
  const mappedY = (axisY + 1) * 0.5;

  const moved = Math.abs(mappedX - gamepadLastAxes[0]) > 0.002 || Math.abs(mappedY - gamepadLastAxes[1]) > 0.002;
  if (moved && paramDisplay.activeBar < 0) {
    gamepadLastAxes = [mappedX, mappedY];
    joystick.setPosition(mappedX, mappedY, { emit: true, touching: true });
  } else if (!moved && joystick.touching) {
    joystick.setPosition(joystick.x, joystick.y, { emit: false, touching: false });
  }

  // Standard gamepad mapping: LB=4, RB=5
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

// --- Start ---
document.addEventListener('DOMContentLoaded', () => {
  init();
  // Start in examples mode with draggable params
  paramDisplay.setDraggable(true);
});
