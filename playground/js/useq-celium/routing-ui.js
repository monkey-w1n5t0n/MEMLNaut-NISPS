// routing-ui — framework-free per-channel routing editor for uSEQ-Celium.
//
// Renders a 14-row table inside `container` mapping each output channel to
// a source. Mutates the passed-in ChannelRouter in place on every change and
// invokes `onChange(router.getAllConfigs())` so the composer can re-emit a
// routingchange event.
//
// Inline styles only. Compact enough to live inside the existing mode drawer
// without dominating it.

import {
  CHANNEL_COUNT,
  HARD_GATE_COUNT,
  MAIN_CV_COUNT,
} from './routing.js';

const MAX_CV_MLP = 11;
const MAX_VOICES = 4;

const CHANNEL_LABELS = (() => {
  const out = new Array(CHANNEL_COUNT);
  for (let i = 0; i < HARD_GATE_COUNT; i++) out[i] = `Gate ${i + 1}`;
  for (let i = 0; i < MAIN_CV_COUNT; i++) out[HARD_GATE_COUNT + i] = `CV M${i + 1}`;
  for (let i = 0; i < 8; i++) out[HARD_GATE_COUNT + MAIN_CV_COUNT + i] = `CV E${i + 1}`;
  return out;
})();

const ROW_STYLE = {
  display: 'grid',
  gridTemplateColumns: '70px 100px 110px 70px',
  gap: '6px',
  alignItems: 'center',
  fontSize: '11px',
  fontFamily: 'sans-serif',
  padding: '2px 0',
};

const HEADER_STYLE = {
  ...ROW_STYLE,
  fontWeight: 'bold',
  borderBottom: '1px solid #ccc',
  marginBottom: '4px',
  padding: '2px 0 4px',
};

const CELL_STYLE = {
  fontSize: '11px',
  padding: '1px 2px',
};

function applyStyle(el, style) {
  for (const k of Object.keys(style)) el.style[k] = style[k];
}

function mkOption(value, label) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

/**
 * Mount the routing editor.
 *
 * @param {HTMLElement} container
 * @param {import('./routing.js').ChannelRouter} router
 * @param {{voiceCount: number, onChange?: Function}} opts
 * @returns {{destroy: Function, setVoiceCount: Function, refresh: Function}}
 */
export function mountRoutingUI(container, router, opts = {}) {
  if (!container) throw new Error('mountRoutingUI: container is required');
  if (!router) throw new Error('mountRoutingUI: router is required');

  const state = {
    voiceCount: Number.isInteger(opts.voiceCount) ? opts.voiceCount : MAX_VOICES,
    onChange: typeof opts.onChange === 'function' ? opts.onChange : () => {},
  };

  container.classList.add('useq-routing-ui');
  container.innerHTML = '';
  container.style.fontFamily = 'sans-serif';

  // ---- Header row ----------------------------------------------------------
  const header = document.createElement('div');
  applyStyle(header, HEADER_STYLE);
  header.appendChild(textCell('Channel'));
  header.appendChild(textCell('Mode'));
  header.appendChild(textCell('Source'));
  header.appendChild(textCell('Static'));
  container.appendChild(header);

  // ---- Per-row controls ----------------------------------------------------
  const rows = [];
  for (let idx = 0; idx < CHANNEL_COUNT; idx++) {
    const row = buildRow(idx, router, state);
    rows.push(row);
    container.appendChild(row.el);
  }

  function refresh() {
    for (const r of rows) r.refresh();
  }

  function setVoiceCount(n) {
    state.voiceCount = Math.max(1, Math.min(MAX_VOICES, Math.floor(n)));
    for (const r of rows) r.refreshVoices();
  }

  function destroy() {
    for (const r of rows) r.destroy();
    rows.length = 0;
    container.innerHTML = '';
    container.classList.remove('useq-routing-ui');
  }

  return { destroy, setVoiceCount, refresh };
}

function textCell(text) {
  const el = document.createElement('div');
  applyStyle(el, CELL_STYLE);
  el.textContent = text;
  return el;
}

function buildRow(idx, router, state) {
  const el = document.createElement('div');
  applyStyle(el, ROW_STYLE);

  const label = textCell(CHANNEL_LABELS[idx]);
  el.appendChild(label);

  const modeCell = document.createElement('div');
  applyStyle(modeCell, CELL_STYLE);
  el.appendChild(modeCell);

  const sourceCell = document.createElement('div');
  applyStyle(sourceCell, CELL_STYLE);
  el.appendChild(sourceCell);

  const staticCell = document.createElement('div');
  applyStyle(staticCell, CELL_STYLE);
  el.appendChild(staticCell);

  const isGate = idx < HARD_GATE_COUNT;

  // Mode widget
  let modeEl;
  if (isGate) {
    modeEl = document.createElement('span');
    modeEl.textContent = 'gate';
    modeEl.style.fontSize = '11px';
    modeEl.style.color = '#555';
    modeCell.appendChild(modeEl);
  } else {
    modeEl = document.createElement('select');
    modeEl.style.fontSize = '11px';
    modeEl.style.width = '95px';
    modeEl.appendChild(mkOption('continuous', 'continuous'));
    modeEl.appendChild(mkOption('dynamic-gate', 'dynamic-gate'));
    modeCell.appendChild(modeEl);
  }

  // Source widget (<select>)
  const sourceEl = document.createElement('select');
  sourceEl.style.fontSize = '11px';
  sourceEl.style.width = '105px';
  sourceCell.appendChild(sourceEl);

  // Static value widget (only shown for continuous + static source)
  const staticEl = document.createElement('input');
  staticEl.type = 'number';
  staticEl.min = '0';
  staticEl.max = '1';
  staticEl.step = '0.01';
  staticEl.style.width = '55px';
  staticEl.style.fontSize = '11px';
  staticCell.appendChild(staticEl);

  // --- Helpers to rebuild the source dropdown based on current mode --------
  function refreshSourceOptions() {
    const cfg = router.getChannelConfig(idx);
    sourceEl.innerHTML = '';

    if (isGate) {
      // voice-0..N-1, then none
      for (let i = 0; i < state.voiceCount; i++) {
        sourceEl.appendChild(mkOption(`voice-${i}`, `Voice ${i + 1}`));
      }
      sourceEl.appendChild(mkOption('none', 'None'));
      sourceEl.value = cfg.source;
      if (sourceEl.value !== cfg.source) sourceEl.value = 'none';
    } else if (cfg.mode === 'continuous') {
      for (let i = 0; i < MAX_CV_MLP; i++) {
        sourceEl.appendChild(mkOption(`cv-mlp-${i}`, `CV MLP ${i}`));
      }
      sourceEl.appendChild(mkOption('static', 'Static'));
      sourceEl.value = cfg.source;
      if (sourceEl.value !== cfg.source) sourceEl.value = `cv-mlp-0`;
    } else {
      // dynamic-gate
      for (let i = 0; i < state.voiceCount; i++) {
        sourceEl.appendChild(mkOption(`voice-${i}`, `Voice ${i + 1}`));
      }
      sourceEl.value = cfg.source;
      if (sourceEl.value !== cfg.source) sourceEl.value = 'voice-0';
    }

    // Static input visibility
    const isStatic = !isGate && cfg.mode === 'continuous' && cfg.source === 'static';
    staticEl.style.display = isStatic ? 'inline-block' : 'none';
    if (isStatic) {
      staticEl.value = String(Number.isFinite(cfg.staticValue) ? cfg.staticValue : 0);
    }
  }

  function reflectCfg() {
    const cfg = router.getChannelConfig(idx);
    if (modeEl && modeEl.tagName === 'SELECT') modeEl.value = cfg.mode;
    refreshSourceOptions();
  }

  // --- Event handlers -------------------------------------------------------
  function pushCurrent() {
    const next = readRow();
    try {
      router.setChannelConfig(idx, next);
    } catch (err) {
      console.warn(`[routing-ui] invalid config for channel ${idx}:`, err.message);
      // Re-sync row to router's prior state so the UI doesn't lie.
      reflectCfg();
      return;
    }
    refreshSourceOptions();
    // Reflect clamped staticValue back into the input so the user sees what
    // actually got stored (e.g. typing 1.5 → router clamps to 1 → input shows 1).
    if (!isGate) {
      const stored = router.getChannelConfig(idx);
      if (stored.mode === 'continuous' && stored.source === 'static'
          && Number.isFinite(stored.staticValue)
          && String(stored.staticValue) !== staticEl.value) {
        staticEl.value = String(stored.staticValue);
      }
    }
    state.onChange(router.getAllConfigs());
  }

  function readRow() {
    if (isGate) {
      return { mode: 'gate', source: sourceEl.value };
    }
    const mode = modeEl.value;
    if (mode === 'continuous') {
      const source = sourceEl.value;
      if (source === 'static') {
        const v = parseFloat(staticEl.value);
        return { mode, source, staticValue: Number.isFinite(v) ? v : 0 };
      }
      return { mode, source };
    }
    return { mode, source: sourceEl.value };
  }

  const onModeChange = () => {
    // Coerce source to something valid for the new mode before committing.
    if (isGate) return;
    const newMode = modeEl.value;
    let defaultSource;
    if (newMode === 'continuous') defaultSource = 'cv-mlp-0';
    else defaultSource = 'voice-0';
    try {
      router.setChannelConfig(idx, { mode: newMode, source: defaultSource });
    } catch (err) {
      console.warn(`[routing-ui] channel ${idx} mode change invalid:`, err.message);
      reflectCfg();
      return;
    }
    refreshSourceOptions();
    state.onChange(router.getAllConfigs());
  };

  const onSourceChange = () => pushCurrent();
  const onStaticChange = () => {
    // Only meaningful when static source selected.
    pushCurrent();
  };

  if (!isGate) modeEl.addEventListener('change', onModeChange);
  sourceEl.addEventListener('change', onSourceChange);
  staticEl.addEventListener('change', onStaticChange);
  staticEl.addEventListener('input', onStaticChange);

  // Initial paint
  reflectCfg();

  function refresh() {
    reflectCfg();
  }

  function refreshVoices() {
    // Voice count changed: gate + dynamic-gate source lists may change.
    const cfg = router.getChannelConfig(idx);
    const usesVoice =
      (cfg.mode === 'gate' && /^voice-\d+$/.test(cfg.source)) ||
      cfg.mode === 'dynamic-gate';
    refreshSourceOptions();
    // If the previously-selected voice index is now out of range, clamp it.
    if (usesVoice) {
      const m = /^voice-(\d+)$/.exec(cfg.source);
      if (m && parseInt(m[1], 10) >= state.voiceCount) {
        const next = { ...cfg, source: 'voice-0' };
        try {
          router.setChannelConfig(idx, next);
          state.onChange(router.getAllConfigs());
        } catch { /* no-op */ }
        reflectCfg();
      }
    }
  }

  function destroy() {
    if (!isGate) modeEl.removeEventListener('change', onModeChange);
    sourceEl.removeEventListener('change', onSourceChange);
    staticEl.removeEventListener('change', onStaticChange);
    staticEl.removeEventListener('input', onStaticChange);
  }

  return { el, refresh, refreshVoices, destroy };
}
