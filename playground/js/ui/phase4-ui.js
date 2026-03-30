/**
 * Phase 4 UI — Output Pipeline + Visualization + Polish
 *
 * Integrates:
 *   - Output freeze button on floating bar
 *   - Weight health + gradient flow panel in settings drawer
 *   - Session preset UI in settings drawer
 *   - Wires output pipeline sliders to actual OutputPipeline instance
 *
 * Usage:
 *   import { initPhase4UI } from './ui/phase4-ui.js';
 *   const phase4 = initPhase4UI({ outputPipeline, iml, controlSurface, ... });
 *
 * @module phase4-ui
 */

import { WeightHealthIndicator } from './weight-health.js';
import { GradientFlowIndicator } from './gradient-flow.js';
import { SessionPresetManager } from './session-presets.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEALTH_UPDATE_INTERVAL = 500; // ms between weight health updates

// Snowflake SVG icon (for output freeze button)
const SNOWFLAKE_SVG = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
  <line x1="7" y1="1" x2="7" y2="13"/>
  <line x1="1" y1="7" x2="13" y2="7"/>
  <line x1="3" y1="3" x2="11" y2="11"/>
  <line x1="11" y1="3" x2="3" y2="11"/>
  <line x1="7" y1="1" x2="5.5" y2="2.5"/>
  <line x1="7" y1="1" x2="8.5" y2="2.5"/>
  <line x1="7" y1="13" x2="5.5" y2="11.5"/>
  <line x1="7" y1="13" x2="8.5" y2="11.5"/>
</svg>`;

// ---------------------------------------------------------------------------
// Main initialization
// ---------------------------------------------------------------------------

/**
 * Initialize Phase 4 UI components.
 *
 * @param {object} opts
 * @param {import('./output-pipeline.js').OutputPipeline} opts.outputPipeline
 * @param {object} opts.iml — WasmIML or IML instance
 * @param {import('./control-surface.js').ControlSurface} opts.controlSurface
 * @param {function} opts.getGroupOverrides — returns current groupOverrides array
 * @param {function} opts.getActiveSynthPresetId — returns active synth preset id
 * @param {import('./input-pipeline.js').InputPipeline} opts.inputPipeline
 * @param {function} opts.onSessionLoad — callback(preset) when a session is loaded
 * @returns {object} { weightHealth, gradientFlow, sessionManager, destroy }
 */
export function initPhase4UI(opts) {
  const {
    outputPipeline,
    iml,
    controlSurface,
    getGroupOverrides,
    getActiveSynthPresetId,
    inputPipeline,
    onSessionLoad,
  } = opts;

  // ---- Weight Health ----
  const weightHealth = new WeightHealthIndicator();

  // ---- Gradient Flow ----
  // layerSizes from the IML instance
  const layerSizes = iml.layerSizes || [3, 32, 48, 64, 126];
  const gradientFlow = new GradientFlowIndicator(layerSizes);

  // ---- Session Presets ----
  const sessionManager = new SessionPresetManager();

  // ---- 1. Output Freeze Button ----
  const freezeBtn = createFreezeButton(outputPipeline);

  // ---- 2. Network Health Panel (in settings drawer) ----
  const healthPanel = createHealthPanel(weightHealth, gradientFlow);

  // ---- 3. Session Preset UI (in settings drawer) ----
  const sessionUI = createSessionUI(sessionManager, {
    controlSurface,
    outputPipeline,
    inputPipeline,
    getGroupOverrides,
    getActiveSynthPresetId,
    onSessionLoad,
  });

  // ---- 4. Wire output pipeline sliders ----
  wireOutputPipelineSliders(outputPipeline, controlSurface);

  // ---- Periodic weight health updates ----
  let healthInterval = setInterval(() => {
    updateWeightHealth(iml, weightHealth, healthPanel.canvas, healthPanel.ctx, gradientFlow, healthPanel.gradCanvas, healthPanel.gradCtx);
  }, HEALTH_UPDATE_INTERVAL);

  // ---- Inject styles ----
  injectPhase4Styles();

  // ---- Cleanup ----
  function destroy() {
    clearInterval(healthInterval);
    freezeBtn.remove();
    healthPanel.container.remove();
    sessionUI.container.remove();
    const styleEl = document.getElementById('phase4-styles');
    if (styleEl) styleEl.remove();
  }

  return {
    weightHealth,
    gradientFlow,
    sessionManager,
    freezeBtn,
    /**
     * Call before iml.train() / iml.trainAsync() to capture weight snapshot.
     */
    captureBeforeTrain() {
      const weights = getFlatWeights(iml);
      if (weights) gradientFlow.captureBeforeTrain(weights);
    },
    /**
     * Call after training completes to capture weight snapshot and update gradient flow.
     */
    captureAfterTrain() {
      const weights = getFlatWeights(iml);
      if (weights) {
        gradientFlow.captureAfterTrain(weights);
        // Immediately refresh the health panel
        updateWeightHealth(iml, weightHealth, healthPanel.canvas, healthPanel.ctx, gradientFlow, healthPanel.gradCanvas, healthPanel.gradCtx);
      }
    },
    destroy,
  };
}

// ---------------------------------------------------------------------------
// Freeze Button
// ---------------------------------------------------------------------------

function createFreezeButton(outputPipeline) {
  const $barContent = document.querySelector('.floating-bar-content') || document.getElementById('floating-bar');
  if (!$barContent) {
    console.warn('[Phase4] floating-bar not found');
    return document.createElement('button');
  }

  const btn = document.createElement('button');
  btn.className = 'float-btn p4-freeze-btn';
  btn.id = 'btn-freeze-output';
  btn.title = 'Freeze output (synth/visual stays locked)';
  btn.innerHTML = SNOWFLAKE_SVG;

  btn.addEventListener('click', () => {
    const frozen = !outputPipeline.isFrozen();
    outputPipeline.setFrozen(frozen);
    btn.classList.toggle('active', frozen);
    btn.title = frozen ? 'Unfreeze output' : 'Freeze output';
  });

  $barContent.appendChild(btn);

  return btn;
}

// ---------------------------------------------------------------------------
// Network Health Panel
// ---------------------------------------------------------------------------

function createHealthPanel(weightHealth, gradientFlow) {
  // Find the settings drawer body
  const drawerBody = document.querySelector('.cs-drawer-body');
  if (!drawerBody) {
    // Drawer not yet created; defer by creating a detached element
    const container = document.createElement('div');
    return {
      container,
      canvas: document.createElement('canvas'),
      ctx: null,
      gradCanvas: document.createElement('canvas'),
      gradCtx: null,
    };
  }

  const container = document.createElement('div');
  container.className = 'cs-section p4-health-section';
  container.innerHTML = `
    <div class="cs-section-header">
      <span>Network Health</span>
      <span class="cs-section-chevron">&#9660;</span>
    </div>
    <div class="cs-section-body">
      <div class="p4-health-row">
        <div class="p4-health-label">Weight Health</div>
        <canvas class="p4-health-canvas" width="120" height="32"></canvas>
      </div>
      <div class="p4-health-row">
        <div class="p4-health-label">Gradient Flow</div>
        <canvas class="p4-grad-canvas" width="120" height="48"></canvas>
      </div>
    </div>
  `;

  // Collapse toggle
  const header = container.querySelector('.cs-section-header');
  header.addEventListener('click', () => {
    container.classList.toggle('collapsed');
  });

  // Append to drawer body (at the bottom)
  drawerBody.appendChild(container);

  const canvas = container.querySelector('.p4-health-canvas');
  const gradCanvas = container.querySelector('.p4-grad-canvas');

  return {
    container,
    canvas,
    ctx: canvas.getContext('2d'),
    gradCanvas,
    gradCtx: gradCanvas.getContext('2d'),
  };
}

// ---------------------------------------------------------------------------
// Session Preset UI
// ---------------------------------------------------------------------------

function createSessionUI(sessionManager, deps) {
  const drawerBody = document.querySelector('.cs-drawer-body');
  if (!drawerBody) {
    return { container: document.createElement('div') };
  }

  const container = document.createElement('div');
  container.className = 'p4-session-section';

  const presets = sessionManager.list();

  container.innerHTML = `
    <div class="p4-session-header">Session Presets</div>
    <div class="p4-session-row">
      <select class="p4-session-select" id="p4-session-select">
        <option value="">-- load session --</option>
        ${presets.map(p => `<option value="${p.name}">${p.name}</option>`).join('')}
      </select>
      <button class="p4-session-btn p4-session-load" id="p4-session-load" title="Load selected session">Load</button>
      <button class="p4-session-btn p4-session-del" id="p4-session-delete" title="Delete selected session">&times;</button>
    </div>
    <div class="p4-session-row">
      <input type="text" class="p4-session-name" id="p4-session-name" placeholder="Session name..." maxlength="40">
      <button class="p4-session-btn p4-session-save" id="p4-session-save" title="Save current session">Save</button>
      <button class="p4-session-btn p4-session-share" id="p4-session-share" title="Copy URL to clipboard">URL</button>
    </div>
  `;

  // Insert at the top of the drawer body (before the preset row)
  const firstChild = drawerBody.firstChild;
  drawerBody.insertBefore(container, firstChild);

  // Wire interactions
  const $select = container.querySelector('#p4-session-select');
  const $loadBtn = container.querySelector('#p4-session-load');
  const $deleteBtn = container.querySelector('#p4-session-delete');
  const $nameInput = container.querySelector('#p4-session-name');
  const $saveBtn = container.querySelector('#p4-session-save');
  const $shareBtn = container.querySelector('#p4-session-share');

  function refreshDropdown() {
    const list = sessionManager.list();
    $select.innerHTML = `<option value="">-- load session --</option>` +
      list.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
  }

  function getCurrentState() {
    return {
      controlSurface: deps.controlSurface ? deps.controlSurface.getState() : null,
      synthPresetId: deps.getActiveSynthPresetId ? deps.getActiveSynthPresetId() : null,
      groupOverrides: deps.getGroupOverrides ? deps.getGroupOverrides() : null,
      inputPipeline: deps.inputPipeline ? deps.inputPipeline.getConfig() : null,
      outputPipeline: deps.outputPipeline ? deps.outputPipeline.getConfig() : null,
    };
  }

  $saveBtn.addEventListener('click', () => {
    const name = $nameInput.value.trim();
    if (!name) return;
    sessionManager.save(name, getCurrentState());
    $nameInput.value = '';
    refreshDropdown();
    $select.value = name;
  });

  $loadBtn.addEventListener('click', () => {
    const name = $select.value;
    if (!name) return;
    const preset = sessionManager.load(name);
    if (preset && deps.onSessionLoad) {
      deps.onSessionLoad(preset);
    }
  });

  $deleteBtn.addEventListener('click', () => {
    const name = $select.value;
    if (!name) return;
    sessionManager.delete(name);
    refreshDropdown();
  });

  $shareBtn.addEventListener('click', () => {
    const state = getCurrentState();
    const preset = sessionManager.capture('share', state);
    const params = sessionManager.toURL(preset);
    const url = new URL(window.location.href);
    // Clear existing session params
    for (const key of ['sp', 'cs', 'op', 'co']) {
      url.searchParams.delete(key);
    }
    // Append session params
    const sessionParams = new URLSearchParams(params);
    for (const [k, v] of sessionParams) {
      url.searchParams.set(k, v);
    }
    navigator.clipboard.writeText(url.toString()).then(() => {
      $shareBtn.textContent = 'Copied!';
      setTimeout(() => { $shareBtn.textContent = 'URL'; }, 1500);
    }).catch(() => {
      $shareBtn.textContent = 'Error';
      setTimeout(() => { $shareBtn.textContent = 'URL'; }, 1500);
    });
  });

  return { container, refreshDropdown };
}

// ---------------------------------------------------------------------------
// Wire Output Pipeline Sliders
// ---------------------------------------------------------------------------

/**
 * Listen for controlsurface:change events and pipe output-related params
 * into the OutputPipeline instance.
 */
function wireOutputPipelineSliders(outputPipeline, controlSurface) {
  document.addEventListener('controlsurface:change', (e) => {
    const p = e.detail;

    if (p.outputSmoothing != null) {
      outputPipeline.setSmoothing(p.outputSmoothing);
    }
    if (p.outputSlewRate != null) {
      outputPipeline.setSlewRate(p.outputSlewRate);
    }
    if (p.globalCurve != null) {
      outputPipeline.setGlobalCurve(p.globalCurve);
    }
    // Note: 'tame' is handled at groupOverrides init time (baked into min/max),
    // not as a runtime pipeline stage.
  });
}

// ---------------------------------------------------------------------------
// Weight Health Update
// ---------------------------------------------------------------------------

function getFlatWeights(iml) {
  // WasmIML has _getFlatWeights()
  if (typeof iml._getFlatWeights === 'function') {
    return iml._getFlatWeights();
  }
  // JS IML: flatten from mlp.getWeights() structure
  if (iml.mlp && typeof iml.mlp.getWeights === 'function') {
    const structured = iml.mlp.getWeights();
    const flat = [];
    for (const layer of structured) {
      for (const node of layer) {
        flat.push(...node.weights, node.bias);
      }
    }
    return new Float32Array(flat);
  }
  return null;
}

function updateWeightHealth(iml, weightHealth, canvas, ctx, gradientFlow, gradCanvas, gradCtx) {
  const weights = getFlatWeights(iml);
  if (weights) {
    weightHealth.update(weights);
  }

  if (ctx && canvas) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    weightHealth.draw(ctx, 0, 0, canvas.width, canvas.height);
  }

  if (gradCtx && gradCanvas) {
    gradCtx.clearRect(0, 0, gradCanvas.width, gradCanvas.height);
    gradientFlow.draw(gradCtx, 0, 0, gradCanvas.width, gradCanvas.height);
  }
}

// ---------------------------------------------------------------------------
// CSS injection
// ---------------------------------------------------------------------------

function injectPhase4Styles() {
  if (document.getElementById('phase4-styles')) return;

  const style = document.createElement('style');
  style.id = 'phase4-styles';
  style.textContent = `
/* ---- Phase 4: Freeze Button ---- */
.p4-freeze-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  min-width: 28px;
  color: rgba(255, 255, 255, 0.5);
  transition: color 0.15s, background 0.15s;
}

.p4-freeze-btn.active {
  color: #5bcefa;
  background: rgba(91, 206, 250, 0.12);
  border-color: rgba(91, 206, 250, 0.3);
}

.p4-freeze-btn:hover {
  color: #5bcefa;
}

/* ---- Phase 4: Network Health Section ---- */
.p4-health-section {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  margin-top: 4px;
}

.p4-health-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.p4-health-label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  min-width: 70px;
  flex-shrink: 0;
}

.p4-health-canvas {
  border-radius: 3px;
  flex: 1;
  max-width: 140px;
  height: 32px;
}

.p4-grad-canvas {
  border-radius: 3px;
  flex: 1;
  max-width: 140px;
  height: 48px;
}

/* ---- Phase 4: Session Presets ---- */
.p4-session-section {
  padding: 10px 16px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.p4-session-header {
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.6);
  text-transform: uppercase;
  letter-spacing: 0.7px;
  margin-bottom: 6px;
}

.p4-session-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
}

.p4-session-select {
  flex: 1;
  min-width: 0;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 11px;
  padding: 4px 6px;
  font-family: inherit;
}

.p4-session-name {
  flex: 1;
  min-width: 0;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 11px;
  padding: 4px 6px;
  font-family: inherit;
  outline: none;
}

.p4-session-name::placeholder {
  color: rgba(255, 255, 255, 0.25);
}

.p4-session-name:focus {
  border-color: var(--accent, #ff6a00);
}

.p4-session-btn {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 10px;
  padding: 4px 8px;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: all 0.12s;
}

.p4-session-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}

.p4-session-save {
  color: var(--accent, #ff6a00);
  border-color: rgba(255, 106, 0, 0.2);
}

.p4-session-save:hover {
  background: rgba(255, 106, 0, 0.12);
}

.p4-session-del {
  color: rgba(255, 80, 80, 0.7);
  font-size: 14px;
  padding: 2px 6px;
  line-height: 1;
}

.p4-session-del:hover {
  color: rgba(255, 80, 80, 1);
  background: rgba(255, 80, 80, 0.1);
}

.p4-session-share {
  color: rgba(150, 180, 255, 0.7);
  border-color: rgba(150, 180, 255, 0.15);
}

.p4-session-share:hover {
  background: rgba(150, 180, 255, 0.1);
  color: rgba(150, 180, 255, 1);
}
`;
  document.head.appendChild(style);
}
