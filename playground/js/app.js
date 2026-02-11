// NISPS Playground - Main application
// Wires IML engine to visual system with joystick input and dual learning modes

import { IML } from './nisps/iml.js';
import { FlowFieldVisualizer } from './ui/visualizer.js';
import { VirtualJoystick } from './ui/joystick.js';
import { Controls } from './ui/controls.js';
import { ParamDisplay } from './ui/param-display.js';

const N_INPUTS = 2;
const N_OUTPUTS = 8;

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

  // Run initial inference to populate outputs
  iml.setInput(0, 0.5);
  iml.setInput(1, 0.5);
  iml.process();
  visualizer.setParams(iml.getOutputs());
  paramDisplay.update(iml.getOutputs());

  // Start animation
  animate();

  // Load from localStorage if available
  loadState();
}

// --- Animation loop ---
function animate() {
  if (!animating) return;
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
}

// --- Examples mode callbacks ---
function onAddExample() {
  // Use current joystick position as input, param bar values as desired output
  const inputs = [joystick.x, joystick.y];
  const outputs = [...paramDisplay.values];
  iml.addExample(inputs, outputs);
  controls.updateStatus(iml.exampleCount, iml.lastLoss, noiseLevel);
  flash('btn-add');
}

function onTrain() {
  const loss = iml.train();
  if (loss !== null) {
    // After training, switch back to inference and update display
    const outputs = iml.getOutputs();
    visualizer.setParams(outputs);
    paramDisplay.update(outputs);
    controls.updateStatus(iml.exampleCount, loss, noiseLevel);
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
}

function onClear() {
  iml.clearDataset();
  noiseLevel = 0.05;
  controls.updateStatus(0, null, noiseLevel);
  clearState();
}

// --- RL mode callbacks ---
function onThumbsUp() {
  // Save current input->output mapping as a positive example
  const inputs = [joystick.x, joystick.y];
  const outputs = [...iml.getOutputs()];
  iml.addExample(inputs, outputs);

  // Retrain incrementally
  iml.train();

  // Decay noise - more positive examples = less exploration
  noiseLevel *= rlExplorationDecay;
  noiseLevel = Math.max(noiseLevel, 0.005);

  controls.updateStatus(iml.exampleCount, iml.lastLoss, noiseLevel);
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
}

// --- Presets ---
window.loadPreset = function(name) {
  iml.clearDataset();

  if (name === 'calm-to-chaotic') {
    // Bottom-left: slow, smooth, cool; top-right: fast, turbulent, warm
    iml.addExample([0.1, 0.9], [0.25, 0.3, 0.1, 0.55, 0.2, 0.3, 0.02, 0.05]);
    iml.addExample([0.9, 0.1], [0.75, 0.7, 0.9, 0.05, 0.8, 0.7, 0.9, 0.95]);
    iml.addExample([0.5, 0.5], [0.5, 0.5, 0.5, 0.3, 0.5, 0.5, 0.4, 0.5]);
  } else if (name === 'rainbow-sweep') {
    // Left to right sweeps through hues
    iml.addExample([0.0, 0.5], [0.5, 0.5, 0.4, 0.0, 0.3, 0.4, 0.05, 0.3]);
    iml.addExample([0.5, 0.5], [0.5, 0.5, 0.4, 0.5, 0.3, 0.4, 0.05, 0.3]);
    iml.addExample([1.0, 0.5], [0.5, 0.5, 0.4, 1.0, 0.3, 0.4, 0.05, 0.3]);
  } else if (name === 'vortex') {
    // Center: tight spiral, edges: wide flow
    iml.addExample([0.5, 0.5], [0.0, 0.8, 0.8, 0.6, 0.1, 0.15, 0.02, 1.0]);
    iml.addExample([0.0, 0.0], [0.5, 0.2, 0.3, 0.8, 0.9, 0.6, 0.08, 0.1]);
    iml.addExample([1.0, 1.0], [0.5, 0.2, 0.3, 0.2, 0.9, 0.6, 0.08, 0.1]);
    iml.addExample([0.0, 1.0], [0.3, 0.4, 0.5, 0.4, 0.5, 0.4, 0.05, 0.5]);
    iml.addExample([1.0, 0.0], [0.7, 0.4, 0.5, 0.0, 0.5, 0.4, 0.05, 0.5]);
  }

  const loss = iml.train();
  const outputs = iml.getOutputs();
  visualizer.setParams(outputs);
  paramDisplay.update(outputs);
  controls.updateStatus(iml.exampleCount, loss, noiseLevel);
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
      iml.train();
      const outputs = iml.getOutputs();
      visualizer.setParams(outputs);
      paramDisplay.update(outputs);
      controls.updateStatus(iml.exampleCount, iml.lastLoss, noiseLevel);
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

// --- Start ---
document.addEventListener('DOMContentLoaded', () => {
  init();
  // Start in examples mode with draggable params
  paramDisplay.setDraggable(true);
});
