/**
 * Phase 3 UI Integration — Auto-Explore button, Heatmap toggle,
 * Pressure indicator, and settings drawer additions.
 *
 * Wires PressureFeedback, AutoExplore, and InputHeatmap into the
 * immersive app's DOM and event flow.
 *
 * Usage:
 *   import { initPhase3UI } from './ui/phase3-ui.js';
 *   const p3 = initPhase3UI({
 *     onAutoExplore: ({ intensity }) => { ... },
 *     getZoomLevel: () => pipeline.getZoomLevel(),
 *   });
 *   // In animation loop:
 *   p3.tick(deltaTime);
 *
 * @module phase3-ui
 */

import { PressureFeedback } from './pressure-feedback.js';
import { AutoExplore } from './auto-explore.js';
import { InputHeatmap } from './input-heatmap.js';

// ---- Style injection ----

const PHASE3_STYLES = `
/* ---- Auto-Explore button ---- */
.auto-explore-btn {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 2px solid rgba(52, 211, 153, 0.4);
  background: rgba(13, 13, 13, 0.65);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: rgba(52, 211, 153, 0.7);
  font-family: inherit;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.3px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  transition: all 0.2s ease;
  position: relative;
  overflow: visible;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

.auto-explore-btn:active {
  transform: scale(0.9);
}

.auto-explore-btn.active {
  border-color: rgba(52, 211, 153, 0.7);
  background: rgba(52, 211, 153, 0.15);
  color: rgba(52, 211, 153, 1);
  box-shadow: 0 0 16px rgba(52, 211, 153, 0.3);
}

.auto-explore-btn.active .ae-icon {
  animation: ae-wander 2s ease-in-out infinite;
}

@keyframes ae-wander {
  0%, 100% { transform: translate(0, 0); }
  25% { transform: translate(2px, -1px); }
  50% { transform: translate(-1px, 2px); }
  75% { transform: translate(-2px, -1px); }
}

/* Progress ring (SVG overlay) */
.ae-progress-ring {
  position: absolute;
  inset: -3px;
  width: calc(100% + 6px);
  height: calc(100% + 6px);
  pointer-events: none;
  transform: rotate(-90deg);
}

.ae-progress-ring circle {
  fill: none;
  stroke: rgba(52, 211, 153, 0.6);
  stroke-width: 2;
  stroke-dasharray: 175;
  stroke-dashoffset: 175;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.1s linear;
}

/* ---- Heatmap toggle ---- */
.heatmap-toggle {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(13, 13, 13, 0.5);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5;
  transition: all 0.15s ease;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

.heatmap-toggle:active {
  transform: scale(0.85);
}

.heatmap-toggle.active {
  border-color: rgba(255, 200, 100, 0.5);
  background: rgba(255, 200, 100, 0.15);
  color: rgba(255, 200, 100, 0.9);
}

.heatmap-toggle svg {
  width: 14px;
  height: 14px;
}

/* Color mode label (appears briefly on mode switch) */
.heatmap-mode-label {
  position: absolute;
  top: 30px;
  right: 0;
  background: rgba(13, 13, 13, 0.8);
  color: rgba(255, 200, 100, 0.8);
  font-size: 9px;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s ease;
  z-index: 5;
}

.heatmap-mode-label.visible {
  opacity: 1;
}

/* ---- Pressure indicator ---- */
.pressure-indicator {
  position: absolute;
  bottom: -10px;
  left: 50%;
  transform: translateX(-50%);
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.pressure-indicator.visible {
  opacity: 1;
}

.pressure-indicator-fill {
  height: 100%;
  width: 0%;
  border-radius: 2px;
  background: linear-gradient(90deg, rgba(255, 200, 100, 0.6), rgba(255, 106, 0, 0.8));
  transition: width 0.1s ease;
}

/* ---- Settings drawer additions ---- */
.cs-section[data-section="phase3"] .cs-section-header {
  color: rgba(52, 211, 153, 0.8);
}
`;

// ---- Eye icon SVG ----
const EYE_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/>
  <circle cx="8" cy="8" r="2"/>
</svg>`;

// ---- Wander icon SVG ----
const WANDER_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="ae-icon">
  <path d="M3 12c2-3 4 1 5-2s3-5 5-3"/>
  <circle cx="3" cy="12" r="1.5" fill="currentColor"/>
</svg>`;

/**
 * Initialize Phase 3 UI.
 *
 * @param {object} options
 * @param {function} options.onAutoExplore - callback({ intensity }) on auto-step
 * @param {function} options.getZoomLevel  - () => number (current zoom 0-1)
 * @param {function} [options.inferFn]     - (inputs) => outputs for heatmap
 * @param {function} [options.getZoomWindow] - () => { x1, y1, x2, y2 }
 * @returns {{ pressure, autoExplore, heatmap, tick, updateHeatmap, destroy, getConfig, setConfig }}
 */
export function initPhase3UI(options = {}) {
  const { onAutoExplore, getZoomLevel, inferFn, getZoomWindow } = options;

  // ---- Instances ----
  const pressure = new PressureFeedback({ holdEnabled: true, pressureEnabled: false });
  const autoExplore = new AutoExplore();
  const heatmap = new InputHeatmap();

  // Wire auto-explore callback
  autoExplore.onExplore((data) => {
    if (onAutoExplore) onAutoExplore(data);
  });

  // ---- Inject styles ----
  if (!document.getElementById('phase3-styles')) {
    const style = document.createElement('style');
    style.id = 'phase3-styles';
    style.textContent = PHASE3_STYLES;
    document.head.appendChild(style);
  }

  // ---- Auto-Explore button ----
  const $rlButtons = document.getElementById('rl-buttons');
  const $autoBtn = document.createElement('button');
  $autoBtn.className = 'auto-explore-btn';
  $autoBtn.title = 'Auto-Explore: automated wandering';
  $autoBtn.innerHTML = `
    ${WANDER_SVG}
    <span style="font-size:9px;line-height:1">Auto</span>
    <svg class="ae-progress-ring" viewBox="0 0 62 62">
      <circle cx="31" cy="31" r="28"/>
    </svg>
  `;

  if ($rlButtons) {
    $rlButtons.appendChild($autoBtn);
  }

  const $progressCircle = $autoBtn.querySelector('.ae-progress-ring circle');
  const circumference = 2 * Math.PI * 28; // r=28
  if ($progressCircle) {
    $progressCircle.style.strokeDasharray = circumference;
    $progressCircle.style.strokeDashoffset = circumference;
  }

  $autoBtn.addEventListener('click', () => {
    autoExplore.toggle();
    $autoBtn.classList.toggle('active', autoExplore.active);
  });

  // ---- Heatmap toggle (on joy-map) ----
  const $joystickContainer = document.querySelector('.joystick-container');
  let $heatmapToggle = null;
  let $hmModeLabel = null;
  let _hmLabelTimeout = null;

  if ($joystickContainer) {
    // Ensure position context
    if (getComputedStyle($joystickContainer).position === 'static') {
      $joystickContainer.style.position = 'relative';
    }

    $heatmapToggle = document.createElement('button');
    $heatmapToggle.className = 'heatmap-toggle';
    $heatmapToggle.title = 'Toggle input heatmap';
    $heatmapToggle.innerHTML = EYE_SVG;
    $joystickContainer.appendChild($heatmapToggle);

    $hmModeLabel = document.createElement('div');
    $hmModeLabel.className = 'heatmap-mode-label';
    $joystickContainer.appendChild($hmModeLabel);

    // Tap to toggle, long-press to cycle color mode
    let _pressTimer = null;
    let _didLongPress = false;

    $heatmapToggle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      _didLongPress = false;
      _pressTimer = setTimeout(() => {
        _didLongPress = true;
        if (heatmap.enabled) {
          const mode = heatmap.cycleColorMode();
          showModeLabel(mode);
          // Trigger recompute
          if (inferFn) {
            heatmap.invalidate();
            const zw = getZoomWindow ? getZoomWindow() : undefined;
            heatmap.update(inferFn, { zoomWindow: zw });
          }
        }
      }, 500);
    });

    $heatmapToggle.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      clearTimeout(_pressTimer);
      if (!_didLongPress) {
        heatmap.setEnabled(!heatmap.enabled);
        $heatmapToggle.classList.toggle('active', heatmap.enabled);
        if (heatmap.enabled && inferFn) {
          heatmap.invalidate();
          const zw = getZoomWindow ? getZoomWindow() : undefined;
          heatmap.update(inferFn, { zoomWindow: zw });
        }
      }
    });

    $heatmapToggle.addEventListener('pointercancel', () => {
      clearTimeout(_pressTimer);
    });

    // Prevent joy-map from capturing these events
    $heatmapToggle.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  }

  function showModeLabel(mode) {
    if (!$hmModeLabel) return;
    $hmModeLabel.textContent = mode;
    $hmModeLabel.classList.add('visible');
    clearTimeout(_hmLabelTimeout);
    _hmLabelTimeout = setTimeout(() => {
      $hmModeLabel.classList.remove('visible');
    }, 1500);
  }

  // ---- Pressure indicators (on RL buttons) ----
  const $thumbsUp = document.getElementById('btn-thumbsup');
  const $thumbsDown = document.getElementById('btn-thumbsdown');
  const pressureIndicators = [];

  for (const $btn of [$thumbsUp, $thumbsDown]) {
    if (!$btn) continue;
    // Ensure position context
    if (getComputedStyle($btn).position === 'static') {
      $btn.style.position = 'relative';
    }

    const $indicator = document.createElement('div');
    $indicator.className = 'pressure-indicator';
    $indicator.innerHTML = '<div class="pressure-indicator-fill"></div>';
    $btn.appendChild($indicator);
    pressureIndicators.push({ el: $indicator, fill: $indicator.querySelector('.pressure-indicator-fill'), btn: $btn });

    // Wire pointer events for pressure tracking
    $btn.addEventListener('pointerdown', (e) => pressure.onPointerDown(e));
    $btn.addEventListener('pointermove', (e) => pressure.onPointerMove(e));
    $btn.addEventListener('pointerup', (e) => {
      pressure.onPointerUp(e);
      $indicator.classList.remove('visible');
    });
    $btn.addEventListener('pointercancel', (e) => {
      pressure.onPointerUp(e);
      $indicator.classList.remove('visible');
    });
  }

  // ---- Settings drawer additions ----
  addDrawerSection();

  // ---- Frame tick ----

  /**
   * Call once per animation frame.
   * @param {number} deltaTime - seconds since last frame
   */
  function tick(deltaTime) {
    const zoomLevel = getZoomLevel ? getZoomLevel() : 1.0;

    // Auto-explore
    autoExplore.tick(deltaTime, zoomLevel);

    // Update progress ring
    if ($progressCircle && autoExplore.active) {
      const progress = autoExplore.getProgress();
      const offset = circumference * (1 - progress);
      $progressCircle.style.strokeDashoffset = offset;
    } else if ($progressCircle) {
      $progressCircle.style.strokeDashoffset = circumference;
    }

    // Update pressure indicators
    if (pressure.active && pressure.enabled) {
      const intensity = pressure.getIntensity();
      for (const { el, fill } of pressureIndicators) {
        el.classList.add('visible');
        fill.style.width = `${intensity * 100}%`;
      }
    }
  }

  /**
   * Trigger a heatmap update. Call after weight changes (train, randomize, moveWeights).
   */
  function updateHeatmap() {
    if (!heatmap.enabled || !inferFn) return;
    const zw = getZoomWindow ? getZoomWindow() : undefined;
    heatmap.update(inferFn, { zoomWindow: zw });
  }

  // ---- Settings drawer: Phase 3 section ----

  function addDrawerSection() {
    // Find the drawer body
    const $drawerBody = document.querySelector('.cs-drawer-body');
    if (!$drawerBody) return;

    const section = document.createElement('div');
    section.className = 'cs-section';
    section.dataset.section = 'phase3';
    section.innerHTML = `
      <div class="cs-section-header">
        <span>Exploration &amp; Viz</span>
        <span class="cs-section-chevron">&#9660;</span>
      </div>
      <div class="cs-section-body">
        <div class="cs-param-row" data-param="autoExploreInterval">
          <label class="cs-param-label">Auto Interval</label>
          <div class="cs-slider-row">
            <input type="range" class="cs-slider" min="0.5" max="10" step="0.5" value="2">
            <span class="cs-param-value">2.0s</span>
          </div>
        </div>
        <div class="cs-param-row" data-param="autoExploreIntensity">
          <label class="cs-param-label">Auto Intensity</label>
          <div class="cs-slider-row">
            <input type="range" class="cs-slider" min="0.1" max="1" step="0.05" value="0.5">
            <span class="cs-param-value">0.50</span>
          </div>
        </div>
        <div class="cs-param-row" data-param="pressureHold">
          <label class="cs-param-label">Hold Feedback</label>
          <input type="checkbox" class="cs-toggle" checked>
        </div>
        <div class="cs-param-row" data-param="pressureFeedback">
          <label class="cs-param-label">Pressure FB</label>
          <input type="checkbox" class="cs-toggle">
        </div>
        <div class="cs-param-row" data-param="holdCurve">
          <label class="cs-param-label">Hold Curve</label>
          <div class="cs-slider-row">
            <input type="range" class="cs-slider" min="0.5" max="5" step="0.1" value="2">
            <span class="cs-param-value">2.0s</span>
          </div>
        </div>
        <div class="cs-param-row" data-param="heatmapResolution">
          <label class="cs-param-label">Heatmap Res</label>
          <div class="cs-slider-row">
            <input type="range" class="cs-slider" min="4" max="32" step="4" value="16">
            <span class="cs-param-value">16</span>
          </div>
        </div>
        <div class="cs-param-row" data-param="heatmapOpacity">
          <label class="cs-param-label">Heatmap Opacity</label>
          <div class="cs-slider-row">
            <input type="range" class="cs-slider" min="0.1" max="1" step="0.05" value="0.55">
            <span class="cs-param-value">0.55</span>
          </div>
        </div>
      </div>
    `;

    $drawerBody.appendChild(section);

    // Wire collapse
    const header = section.querySelector('.cs-section-header');
    if (header) {
      header.addEventListener('click', () => section.classList.toggle('collapsed'));
    }

    // Wire sliders
    wireSlider(section, 'autoExploreInterval', (val) => {
      autoExplore.setInterval(val);
      return `${val.toFixed(1)}s`;
    });

    wireSlider(section, 'autoExploreIntensity', (val) => {
      autoExplore.setIntensity(val);
      return val.toFixed(2);
    });

    wireSlider(section, 'holdCurve', (val) => {
      pressure.setHoldCurve(val);
      return `${val.toFixed(1)}s`;
    });

    wireSlider(section, 'heatmapResolution', (val) => {
      heatmap.setResolution(val);
      return String(Math.round(val));
    });

    wireSlider(section, 'heatmapOpacity', (val) => {
      heatmap.setOpacity(val);
      return val.toFixed(2);
    });

    // Wire toggles
    wireToggle(section, 'pressureHold', (checked) => {
      pressure.setEnabled(pressure.getPressureEnabled(), checked);
    });

    wireToggle(section, 'pressureFeedback', (checked) => {
      pressure.setEnabled(checked, pressure.getHoldEnabled());
    });
  }

  function wireSlider(container, paramName, onChange) {
    const row = container.querySelector(`[data-param="${paramName}"]`);
    if (!row) return;
    const slider = row.querySelector('input[type="range"]');
    const valueSpan = row.querySelector('.cs-param-value');
    if (!slider) return;
    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      const display = onChange(val);
      if (valueSpan && display) valueSpan.textContent = display;
      // Dispatch controlsurface:change for consistency
      document.dispatchEvent(new CustomEvent('controlsurface:change', {
        detail: { _phase3: true, [paramName]: val },
      }));
    });
  }

  function wireToggle(container, paramName, onChange) {
    const row = container.querySelector(`[data-param="${paramName}"]`);
    if (!row) return;
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (!checkbox) return;
    checkbox.addEventListener('change', () => {
      onChange(checkbox.checked);
    });
  }

  // ---- Cleanup ----

  function destroy() {
    $autoBtn.remove();
    if ($heatmapToggle) $heatmapToggle.remove();
    if ($hmModeLabel) $hmModeLabel.remove();
    for (const { el } of pressureIndicators) el.remove();
    const $styles = document.getElementById('phase3-styles');
    if ($styles) $styles.remove();
    const $section = document.querySelector('.cs-section[data-section="phase3"]');
    if ($section) $section.remove();
    clearTimeout(_hmLabelTimeout);
  }

  // ---- Serialization ----

  function getConfig() {
    return {
      pressure: pressure.getConfig(),
      autoExplore: autoExplore.getConfig(),
      heatmap: heatmap.getConfig(),
    };
  }

  function setConfig(config) {
    if (config.pressure) pressure.setConfig(config.pressure);
    if (config.autoExplore) autoExplore.setConfig(config.autoExplore);
    if (config.heatmap) heatmap.setConfig(config.heatmap);
    // Sync UI
    $autoBtn.classList.toggle('active', autoExplore.active);
    if ($heatmapToggle) $heatmapToggle.classList.toggle('active', heatmap.enabled);
  }

  return {
    pressure,
    autoExplore,
    heatmap,
    tick,
    updateHeatmap,
    destroy,
    getConfig,
    setConfig,
  };
}
