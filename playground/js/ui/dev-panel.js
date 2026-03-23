// Dev panel — draggable, collapsible floating panel for tuning hand tracking parameters
// Gated on ?devmode=true URL parameter

import { HAND_TRACKER_DEFAULTS } from './hand-tracker.js';

const PARAMS = [
  {
    key: 'minHandDetectionConfidence',
    label: 'Detection confidence',
    min: 0.1, max: 1.0, step: 0.05,
    help: 'Palm detection threshold. Lower = more aggressive detection, more false positives.',
  },
  {
    key: 'minHandPresenceConfidence',
    label: 'Presence confidence',
    min: 0.1, max: 1.0, step: 0.05,
    help: 'Hand presence threshold. Lower = holds onto tracked hands longer.',
  },
  {
    key: 'minTrackingConfidence',
    label: 'Tracking confidence',
    min: 0.1, max: 1.0, step: 0.05,
    help: 'Frame-to-frame tracking IoU. Lower = tracks through fast movement.',
  },
  {
    key: 'smoothingFactor',
    label: 'Smoothing',
    min: 0.05, max: 1.0, step: 0.05,
    help: 'Feature smoothing (EMA factor). Lower = smoother/laggier, higher = more responsive/jittery.',
  },
  {
    key: 'gestureHoldMs',
    label: 'Gesture hold (ms)',
    min: 100, max: 1500, step: 50,
    help: 'How long a gesture must be held before firing.',
  },
  {
    key: 'useWorldLandmarks',
    label: 'World landmarks',
    type: 'toggle',
    help: 'Use real-world meter coords (distance-independent) vs image-normalized coords.',
  },
];

export function createDevPanel(handTrackerGetter) {
  if (new URLSearchParams(window.location.search).get('devmode') !== 'true') return null;

  const panel = document.createElement('div');
  panel.className = 'dev-panel';
  panel.innerHTML = `
    <div class="dev-panel-header" id="dev-panel-header">
      <span class="dev-panel-title">Hand Tracking Dev</span>
      <button class="dev-panel-collapse" id="dev-panel-collapse">_</button>
    </div>
    <div class="dev-panel-body" id="dev-panel-body"></div>
  `;
  document.body.appendChild(panel);

  const $body = panel.querySelector('#dev-panel-body');
  const $header = panel.querySelector('#dev-panel-header');
  const $collapse = panel.querySelector('#dev-panel-collapse');
  const sliders = {};

  // Build controls
  for (const p of PARAMS) {
    const row = document.createElement('div');
    row.className = 'dev-row';

    if (p.type === 'toggle') {
      row.innerHTML = `
        <label class="dev-label" title="${p.help}">
          ${p.label}
          <input type="checkbox" class="dev-toggle" data-key="${p.key}"
                 ${HAND_TRACKER_DEFAULTS[p.key] ? 'checked' : ''}>
        </label>
      `;
      const input = row.querySelector('input');
      input.addEventListener('change', () => {
        applyOption(p.key, input.checked);
      });
      sliders[p.key] = input;
    } else {
      const defaultVal = HAND_TRACKER_DEFAULTS[p.key];
      row.innerHTML = `
        <label class="dev-label" title="${p.help}">${p.label}</label>
        <div class="dev-slider-row">
          <input type="range" class="dev-slider" data-key="${p.key}"
                 min="${p.min}" max="${p.max}" step="${p.step}" value="${defaultVal}">
          <span class="dev-value" data-key="${p.key}">${formatVal(p.key, defaultVal)}</span>
        </div>
      `;
      const input = row.querySelector('input[type=range]');
      const display = row.querySelector('.dev-value');
      input.addEventListener('input', () => {
        const val = parseFloat(input.value);
        display.textContent = formatVal(p.key, val);
        applyOption(p.key, val);
      });
      sliders[p.key] = input;
    }

    $body.appendChild(row);
  }

  // Reset button
  const resetRow = document.createElement('div');
  resetRow.className = 'dev-row dev-row-actions';
  resetRow.innerHTML = `<button class="dev-reset-btn">Reset defaults</button>`;
  resetRow.querySelector('button').addEventListener('click', () => {
    for (const p of PARAMS) {
      const def = HAND_TRACKER_DEFAULTS[p.key];
      if (p.type === 'toggle') {
        sliders[p.key].checked = def;
      } else {
        sliders[p.key].value = def;
        sliders[p.key].parentElement.querySelector('.dev-value').textContent = formatVal(p.key, def);
      }
      applyOption(p.key, def);
    }
  });
  $body.appendChild(resetRow);

  // Feature monitor (live feature values)
  const monitorRow = document.createElement('div');
  monitorRow.className = 'dev-row';
  monitorRow.innerHTML = `
    <label class="dev-label">Features</label>
    <canvas id="dev-feature-bars" class="dev-feature-bars" width="200" height="56"></canvas>
  `;
  $body.appendChild(monitorRow);
  const $featureBars = monitorRow.querySelector('canvas');
  const featureCtx = $featureBars.getContext('2d');

  // --- Collapse ---
  let collapsed = false;
  $collapse.addEventListener('click', (e) => {
    e.stopPropagation();
    collapsed = !collapsed;
    $body.style.display = collapsed ? 'none' : '';
    $collapse.textContent = collapsed ? '+' : '_';
    panel.classList.toggle('collapsed', collapsed);
  });

  // --- Drag ---
  let dragging = false, dragOffX = 0, dragOffY = 0;
  $header.addEventListener('pointerdown', (e) => {
    if (e.target === $collapse) return;
    dragging = true;
    dragOffX = e.clientX - panel.offsetLeft;
    dragOffY = e.clientY - panel.offsetTop;
    $header.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  $header.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    panel.style.left = (e.clientX - dragOffX) + 'px';
    panel.style.top = (e.clientY - dragOffY) + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  });
  $header.addEventListener('pointerup', () => { dragging = false; });

  // --- Apply option to hand tracker ---
  function applyOption(key, value) {
    const ht = handTrackerGetter();
    if (ht) {
      ht.setOptions({ [key]: value });
    }
  }

  // --- Feature bar animation ---
  const FEATURE_LABELS = [
    'pX','pY','tC','iC','mC','rC','pnC','s01','s12','s23','s34','rol','pit','pnc'
  ];

  function drawFeatureBars() {
    const ht = handTrackerGetter();
    const w = $featureBars.width;
    const h = $featureBars.height;
    featureCtx.clearRect(0, 0, w, h);

    if (!ht || !ht.active) {
      featureCtx.fillStyle = 'rgba(255,255,255,0.1)';
      featureCtx.font = '9px monospace';
      featureCtx.fillText('No tracking', 60, h / 2 + 3);
      requestAnimationFrame(drawFeatureBars);
      return;
    }

    const features = ht.features;
    const barW = (w - 2) / 14;

    for (let i = 0; i < 14; i++) {
      const v = features[i];
      const x = i * barW + 1;
      const barH = v * (h - 12);

      // Bar background
      featureCtx.fillStyle = 'rgba(255,255,255,0.05)';
      featureCtx.fillRect(x, 10, barW - 1, h - 12);

      // Bar fill
      featureCtx.fillStyle = `hsl(${(i / 14) * 360}, 70%, 55%)`;
      featureCtx.fillRect(x, h - barH, barW - 1, barH);

      // Label
      featureCtx.fillStyle = 'rgba(255,255,255,0.4)';
      featureCtx.font = '6px monospace';
      featureCtx.fillText(FEATURE_LABELS[i], x, 8);
    }

    requestAnimationFrame(drawFeatureBars);
  }
  drawFeatureBars();

  return panel;
}

function formatVal(key, val) {
  if (key === 'gestureHoldMs') return `${val}`;
  return val.toFixed(2);
}
