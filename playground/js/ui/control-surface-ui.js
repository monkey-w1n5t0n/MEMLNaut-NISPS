// Control Surface UI — DOM for compound axes + settings drawer
// Renders 3 compact sliders on the floating bar and a gear-icon settings drawer.
//
// Usage:
//   import { initControlSurfaceUI } from './ui/control-surface-ui.js';
//   const { surface, destroy } = initControlSurfaceUI();
//   // surface is the ControlSurface instance

import { ControlSurface, CONTROL_PRESETS, PARAM_DEFAULTS, PARAM_RANGES, LOG_SCALE_PARAMS } from './control-surface.js';

// ---- Parameter metadata for the drawer ----

const SECTIONS = [
  {
    id: 'input',
    label: 'Input',
    params: [
      { name: 'zoom',         label: 'Zoom',        log: true },
      { name: 'deadzone',     label: 'Deadzone' },
      { name: 'inputCurve',   label: 'Curve' },
      { name: 'smoothing',    label: 'Smoothing' },
      { name: 'momentumZoom', label: 'Momentum',    type: 'select', options: ['off', 'gentle', 'strong'] },
      { name: 'invertX',      label: 'Invert X',    type: 'toggle' },
      { name: 'invertY',      label: 'Invert Y',    type: 'toggle' },
    ],
  },
  {
    id: 'training',
    label: 'Training',
    params: [
      { name: 'learningRate',         label: 'Learning Rate',  log: true },
      { name: 'maxIterations',        label: 'Max Iterations' },
      { name: 'convergenceThreshold', label: 'Convergence',    log: true },
      { name: 'rlTrainIntensity',     label: 'RL Intensity' },
      { name: 'maxExamples',          label: 'Max Examples' },
      { name: 'exampleDecay',         label: 'Example Decay' },
    ],
  },
  {
    id: 'exploration',
    label: 'Exploration',
    params: [
      { name: 'spread',             label: 'Spread' },
      { name: 'noiseFloor',         label: 'Noise Floor' },
      { name: 'noiseCap',           label: 'Noise Cap' },
      { name: 'noiseGrowth',        label: 'Noise Growth' },
      { name: 'noiseDecay',         label: 'Noise Decay' },
      { name: 'weightDecay',        label: 'Weight Decay' },
      { name: 'noiseDistribution',  label: 'Distribution',    type: 'select', options: ['gaussian', 'cauchy'] },
      { name: 'layerAwareNoise',    label: 'Layer-Aware',     type: 'toggle' },
      { name: 'zoomAwareFeedback',  label: 'Zoom-Aware FB',   type: 'toggle' },
    ],
  },
  {
    id: 'output',
    label: 'Output',
    params: [
      { name: 'outputSmoothing', label: 'Smoothing' },
      { name: 'outputSlewRate',  label: 'Slew Rate' },
      { name: 'tame',            label: 'Tame' },
      { name: 'globalCurve',     label: 'Global Curve' },
    ],
  },
];

// ---- Utility: log-scale slider helpers ----

function toLogSlider(value, min, max) {
  // Map a log-scale value to 0-1 slider position
  const logMin = Math.log(min);
  const logMax = Math.log(max);
  return (Math.log(Math.max(value, min)) - logMin) / (logMax - logMin);
}

function fromLogSlider(sliderPos, min, max) {
  const logMin = Math.log(min);
  const logMax = Math.log(max);
  return Math.exp(logMin + sliderPos * (logMax - logMin));
}

function formatValue(name, value) {
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'string') return value;
  if (typeof value !== 'number') return String(value);
  // Convergence threshold: scientific notation
  if (name === 'convergenceThreshold') return value.toExponential(1);
  // Integers
  if (name === 'maxExamples' || name === 'maxIterations') return Math.round(value).toString();
  // Small decimals
  if (Math.abs(value) < 0.01 && value !== 0) return value.toExponential(1);
  if (Math.abs(value) < 1) return value.toFixed(3);
  return value.toFixed(2);
}

// ---- Build DOM ----

/**
 * Initialize the control surface UI.
 * Inserts compound axis sliders into the floating bar and creates the settings drawer.
 * Returns { surface, destroy }.
 */
export function initControlSurfaceUI() {
  const surface = new ControlSurface();

  // Apply default preset
  surface.applyPreset('default');

  // --- Floating bar: compound axis sliders ---
  const $barContent = document.querySelector('.floating-bar-content') || document.getElementById('floating-bar');
  const axisContainer = document.createElement('div');
  axisContainer.className = 'cs-axes';
  axisContainer.innerHTML = `
    <div class="cs-axis" data-axis="boldness">
      <label class="cs-axis-label">Bold</label>
      <input type="range" class="cs-axis-slider" min="0" max="1" step="0.01" value="0.5">
    </div>
    <div class="cs-axis" data-axis="memory">
      <label class="cs-axis-label">Mem</label>
      <input type="range" class="cs-axis-slider" min="0" max="1" step="0.01" value="0.5">
    </div>
    <div class="cs-axis" data-axis="precision">
      <label class="cs-axis-label">Prec</label>
      <input type="range" class="cs-axis-slider" min="0" max="1" step="0.01" value="0.3">
    </div>
  `;

  $barContent.appendChild(axisContainer);

  // Wire axis sliders
  const axisSliders = {};
  for (const axisEl of axisContainer.querySelectorAll('.cs-axis')) {
    const axisName = axisEl.dataset.axis;
    const slider = axisEl.querySelector('.cs-axis-slider');
    axisSliders[axisName] = slider;

    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      if (axisName === 'boldness') surface.setBoldness(val);
      else if (axisName === 'memory') surface.setMemory(val);
      else if (axisName === 'precision') surface.setPrecision(val);
    });

    // Double-tap to clear all overrides for this axis
    let lastTap = 0;
    slider.addEventListener('pointerdown', () => {
      const now = Date.now();
      if (now - lastTap < 350) {
        surface.clearAllOverrides();
        syncDrawerValues();
      }
      lastTap = now;
    });
  }

  // --- Gear button (settings drawer toggle) ---
  const gearBtn = document.createElement('button');
  gearBtn.className = 'cs-gear-btn';
  gearBtn.title = 'Control surface settings';
  gearBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="8" cy="8" r="2.5"/>
    <path d="M13.3 9.5a1.2 1.2 0 00.24 1.32l.04.04a1.45 1.45 0 11-2.05 2.05l-.04-.04a1.2 1.2 0 00-1.32-.24 1.2 1.2 0 00-.73 1.1v.12a1.45 1.45 0 11-2.9 0v-.06a1.2 1.2 0 00-.78-1.1 1.2 1.2 0 00-1.32.24l-.04.04a1.45 1.45 0 11-2.05-2.05l.04-.04a1.2 1.2 0 00.24-1.32 1.2 1.2 0 00-1.1-.73h-.12a1.45 1.45 0 110-2.9h.06a1.2 1.2 0 001.1-.78 1.2 1.2 0 00-.24-1.32l-.04-.04A1.45 1.45 0 114.38 1.68l.04.04a1.2 1.2 0 001.32.24h.06a1.2 1.2 0 00.73-1.1V.74a1.45 1.45 0 112.9 0v.06a1.2 1.2 0 00.73 1.1 1.2 1.2 0 001.32-.24l.04-.04a1.45 1.45 0 112.05 2.05l-.04.04a1.2 1.2 0 00-.24 1.32v.06a1.2 1.2 0 001.1.73h.12a1.45 1.45 0 110 2.9h-.06a1.2 1.2 0 00-1.1.73z"/>
  </svg>`;

  // Place gear button near the help button (top-right area)
  const $helpBtn = document.getElementById('help-btn');
  if ($helpBtn && $helpBtn.parentNode) {
    $helpBtn.parentNode.insertBefore(gearBtn, $helpBtn);
  } else {
    document.body.appendChild(gearBtn);
  }

  // --- Settings drawer ---
  const overlay = document.createElement('div');
  overlay.className = 'cs-drawer-overlay hidden';

  const drawer = document.createElement('div');
  drawer.className = 'cs-drawer';

  // Build drawer content
  drawer.innerHTML = buildDrawerHTML();
  overlay.appendChild(drawer);
  document.body.appendChild(overlay);

  // --- Wire drawer interactions ---

  let drawerOpen = false;

  function openDrawer() {
    drawerOpen = true;
    overlay.classList.remove('hidden');
    requestAnimationFrame(() => {
      overlay.classList.add('open');
      drawer.classList.add('open');
    });
    syncDrawerValues();
  }

  function closeDrawer() {
    drawerOpen = false;
    overlay.classList.remove('open');
    drawer.classList.remove('open');
    setTimeout(() => {
      if (!drawerOpen) overlay.classList.add('hidden');
    }, 220);
  }

  gearBtn.addEventListener('click', () => {
    if (drawerOpen) closeDrawer();
    else openDrawer();
  });

  // Close on overlay click (outside drawer)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDrawer();
  });

  // Close button inside drawer
  const closeBtn = drawer.querySelector('.cs-drawer-close');
  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);

  // Preset dropdown
  const presetSelect = drawer.querySelector('#cs-preset-select');
  if (presetSelect) {
    presetSelect.addEventListener('change', () => {
      const id = presetSelect.value;
      if (id && CONTROL_PRESETS[id]) {
        surface.applyPreset(id);
        // Sync axis sliders
        axisSliders.boldness.value = surface.getBoldness();
        axisSliders.memory.value = surface.getMemory();
        axisSliders.precision.value = surface.getPrecision();
        syncDrawerValues();
      }
    });
  }

  // Reset button
  const resetBtn = drawer.querySelector('#cs-reset-preset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      const id = presetSelect?.value || 'default';
      surface.applyPreset(id);
      axisSliders.boldness.value = surface.getBoldness();
      axisSliders.memory.value = surface.getMemory();
      axisSliders.precision.value = surface.getPrecision();
      syncDrawerValues();
    });
  }

  // Section expand/collapse
  for (const header of drawer.querySelectorAll('.cs-section-header')) {
    header.addEventListener('click', () => {
      const section = header.parentElement;
      section.classList.toggle('collapsed');
    });
  }

  // Wire individual parameter controls
  wireParamControls(drawer, surface, () => syncDrawerValues());

  // --- Sync drawer values from surface state ---

  function syncDrawerValues() {
    const params = surface.getParams();
    for (const section of SECTIONS) {
      for (const p of section.params) {
        const val = params[p.name];
        const el = drawer.querySelector(`[data-param="${p.name}"]`);
        if (!el) continue;

        const range = PARAM_RANGES[p.name];

        if (p.type === 'toggle') {
          const checkbox = el.querySelector('input[type="checkbox"]');
          if (checkbox) checkbox.checked = !!val;
        } else if (p.type === 'select') {
          const select = el.querySelector('select');
          if (select) select.value = val;
        } else if (range) {
          const slider = el.querySelector('input[type="range"]');
          const valueSpan = el.querySelector('.cs-param-value');
          if (slider) {
            if (p.log || LOG_SCALE_PARAMS.has(p.name)) {
              slider.value = toLogSlider(val, range[0], range[1]);
            } else {
              slider.value = val;
            }
          }
          if (valueSpan) valueSpan.textContent = formatValue(p.name, val);
        }

        // Show override indicator
        const overrideIndicator = el.querySelector('.cs-override-dot');
        if (overrideIndicator) {
          overrideIndicator.classList.toggle('active', surface.hasOverride(p.name));
        }
      }
    }
  }

  // Listen for external changes to the surface (e.g. from app code)
  surface.onChange(() => {
    if (drawerOpen) syncDrawerValues();
  });

  // --- Inject styles ---
  injectStyles();

  // --- Cleanup function ---
  function destroy() {
    axisContainer.remove();
    gearBtn.remove();
    overlay.remove();
    const styleEl = document.getElementById('cs-styles');
    if (styleEl) styleEl.remove();
  }

  return { surface, destroy };
}


// ---- Build drawer HTML ----

function buildDrawerHTML() {
  let html = `
    <div class="cs-drawer-header">
      <span class="cs-drawer-title">Control Surface</span>
      <button class="cs-drawer-close">&times;</button>
    </div>
    <div class="cs-drawer-body">
      <div class="cs-preset-row">
        <label class="cs-preset-label">Preset</label>
        <select id="cs-preset-select" class="cs-preset-select">
          ${Object.keys(CONTROL_PRESETS).map(id =>
            `<option value="${id}">${id.replace(/-/g, ' ')}</option>`
          ).join('')}
        </select>
        <button id="cs-reset-preset" class="cs-reset-btn" title="Reset to preset">Reset</button>
      </div>
  `;

  for (const section of SECTIONS) {
    html += `
      <div class="cs-section" data-section="${section.id}">
        <div class="cs-section-header">
          <span>${section.label}</span>
          <span class="cs-section-chevron">&#9660;</span>
        </div>
        <div class="cs-section-body">
    `;

    for (const p of section.params) {
      html += buildParamRow(p);
    }

    html += `
        </div>
      </div>
    `;
  }

  html += `</div>`;
  return html;
}

function buildParamRow(p) {
  const range = PARAM_RANGES[p.name];

  if (p.type === 'toggle') {
    return `
      <div class="cs-param-row" data-param="${p.name}">
        <label class="cs-param-label">
          <span class="cs-override-dot"></span>
          ${p.label}
        </label>
        <input type="checkbox" class="cs-toggle" ${PARAM_DEFAULTS[p.name] ? 'checked' : ''}>
      </div>
    `;
  }

  if (p.type === 'select') {
    const options = p.options || [];
    return `
      <div class="cs-param-row" data-param="${p.name}">
        <label class="cs-param-label">
          <span class="cs-override-dot"></span>
          ${p.label}
        </label>
        <select class="cs-select">
          ${options.map(o => `<option value="${o}">${o}</option>`).join('')}
        </select>
      </div>
    `;
  }

  // Numeric slider
  const isLog = p.log || LOG_SCALE_PARAMS.has(p.name);
  const min = range ? range[0] : 0;
  const max = range ? range[1] : 1;
  const step = isLog ? 0.001 : (range ? (range[2] || 0.01) : 0.01);
  const sliderMin = isLog ? 0 : min;
  const sliderMax = isLog ? 1 : max;
  const defaultVal = PARAM_DEFAULTS[p.name] ?? 0.5;
  const sliderDefault = isLog ? toLogSlider(defaultVal, min, max) : defaultVal;

  return `
    <div class="cs-param-row" data-param="${p.name}">
      <label class="cs-param-label">
        <span class="cs-override-dot"></span>
        ${p.label}
      </label>
      <div class="cs-slider-row">
        <input type="range" class="cs-slider" min="${sliderMin}" max="${sliderMax}" step="${step}" value="${sliderDefault}">
        <span class="cs-param-value">${formatValue(p.name, defaultVal)}</span>
      </div>
    </div>
  `;
}


// ---- Wire parameter controls ----

function wireParamControls(drawer, surface, syncFn) {
  for (const section of SECTIONS) {
    for (const p of section.params) {
      const el = drawer.querySelector(`[data-param="${p.name}"]`);
      if (!el) continue;

      const range = PARAM_RANGES[p.name];

      if (p.type === 'toggle') {
        const checkbox = el.querySelector('input[type="checkbox"]');
        if (checkbox) {
          checkbox.addEventListener('change', () => {
            surface.setOverride(p.name, checkbox.checked);
            syncFn();
          });
        }
      } else if (p.type === 'select') {
        const select = el.querySelector('select');
        if (select) {
          select.addEventListener('change', () => {
            surface.setOverride(p.name, select.value);
            syncFn();
          });
        }
      } else if (range) {
        const slider = el.querySelector('input[type="range"]');
        const valueSpan = el.querySelector('.cs-param-value');
        const isLog = p.log || LOG_SCALE_PARAMS.has(p.name);

        if (slider) {
          slider.addEventListener('input', () => {
            let val;
            if (isLog) {
              val = fromLogSlider(parseFloat(slider.value), range[0], range[1]);
            } else {
              val = parseFloat(slider.value);
            }
            surface.setOverride(p.name, val);
            if (valueSpan) valueSpan.textContent = formatValue(p.name, val);
            // Update override dot
            const dot = el.querySelector('.cs-override-dot');
            if (dot) dot.classList.add('active');
          });

          // Double-tap slider to clear override for this param
          let lastTap = 0;
          slider.addEventListener('pointerdown', () => {
            const now = Date.now();
            if (now - lastTap < 350) {
              surface.clearOverride(p.name);
              syncFn();
            }
            lastTap = now;
          });
        }
      }
    }
  }
}


// ---- CSS injection ----

function injectStyles() {
  if (document.getElementById('cs-styles')) return;

  const style = document.createElement('style');
  style.id = 'cs-styles';
  style.textContent = `
/* ---- Control Surface: Compound Axes (floating bar) ---- */
.cs-axes {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 4px;
}

.cs-axis {
  display: flex;
  align-items: center;
  gap: 3px;
}

.cs-axis-label {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.45);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
  cursor: default;
  user-select: none;
}

.cs-axis-slider {
  width: 48px;
  height: 3px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.cs-axis-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent, #ff6a00);
  cursor: pointer;
  border: none;
}

.cs-axis-slider::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent, #ff6a00);
  border: none;
  cursor: pointer;
}

/* ---- Gear button ---- */
.cs-gear-btn {
  position: fixed;
  bottom: 96px;
  right: 50px;
  z-index: 45;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.08));
  background: var(--glass-bg, rgba(13, 13, 13, 0.65));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: var(--text-dim, #888);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  padding: 0;
}

.cs-gear-btn:hover,
.cs-gear-btn:active {
  border-color: var(--accent, #ff6a00);
  color: var(--accent, #ff6a00);
}

/* ---- Drawer overlay ---- */
.cs-drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(0, 0, 0, 0);
  transition: background 0.2s ease;
  pointer-events: auto;
}

.cs-drawer-overlay.hidden {
  display: none;
}

.cs-drawer-overlay.open {
  background: rgba(0, 0, 0, 0.4);
}

/* ---- Drawer panel ---- */
.cs-drawer {
  position: fixed;
  top: 0;
  right: -320px;
  width: 300px;
  height: 100%;
  z-index: 91;
  background: rgba(0, 0, 0, 0.88);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  transition: right 0.2s ease;
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
}

.cs-drawer.open {
  right: 0;
}

/* ---- Drawer header ---- */
.cs-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.cs-drawer-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  text-transform: uppercase;
  letter-spacing: 0.8px;
}

.cs-drawer-close {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.5);
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  padding: 0;
}

.cs-drawer-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

/* ---- Drawer body ---- */
.cs-drawer-body {
  padding: 0 0 24px;
}

/* ---- Preset row ---- */
.cs-preset-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.cs-preset-label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.cs-preset-select {
  flex: 1;
  height: 28px;
  padding: 0 8px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text, #e0e0e0);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}

.cs-preset-select option {
  background: #1a1a1a;
  color: var(--text, #e0e0e0);
}

.cs-reset-btn {
  height: 28px;
  padding: 0 10px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.5);
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.cs-reset-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

/* ---- Sections ---- */
.cs-section {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.cs-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.cs-section-header:hover {
  background: rgba(255, 255, 255, 0.03);
}

.cs-section-header span:first-child {
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.cs-section-chevron {
  font-size: 8px;
  color: rgba(255, 255, 255, 0.3);
  transition: transform 0.2s;
}

.cs-section.collapsed .cs-section-chevron {
  transform: rotate(-90deg);
}

.cs-section-body {
  padding: 0 16px 8px;
  overflow: hidden;
  transition: max-height 0.2s ease, padding 0.2s ease;
  max-height: 600px;
}

.cs-section.collapsed .cs-section-body {
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

/* ---- Parameter rows ---- */
.cs-param-row {
  margin-bottom: 8px;
}

.cs-param-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  margin-bottom: 3px;
  cursor: default;
}

/* Override dot: shows when param has a manual offset */
.cs-override-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: transparent;
  flex-shrink: 0;
  transition: background 0.15s;
}

.cs-override-dot.active {
  background: var(--accent, #ff6a00);
}

/* ---- Slider row ---- */
.cs-slider-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cs-slider {
  flex: 1;
  height: 3px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.cs-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent, #ff6a00);
  cursor: pointer;
  border: none;
}

.cs-slider::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent, #ff6a00);
  border: none;
  cursor: pointer;
}

.cs-param-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  color: rgba(255, 255, 255, 0.5);
  min-width: 36px;
  text-align: right;
  white-space: nowrap;
}

/* ---- Toggle (checkbox) ---- */
.cs-toggle {
  accent-color: var(--accent, #ff6a00);
  cursor: pointer;
  width: 14px;
  height: 14px;
}

/* ---- Select ---- */
.cs-select {
  height: 24px;
  padding: 0 8px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text, #e0e0e0);
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}

.cs-select option {
  background: #1a1a1a;
  color: var(--text, #e0e0e0);
}

/* ---- Responsive: shrink axes on narrow screens ---- */
@media (max-width: 600px) {
  .cs-axes {
    gap: 4px;
  }
  .cs-axis-slider {
    width: 36px;
  }
  .cs-axis-label {
    font-size: 8px;
  }
  .cs-drawer {
    width: 280px;
    right: -300px;
  }
}
`;
  document.head.appendChild(style);
}
