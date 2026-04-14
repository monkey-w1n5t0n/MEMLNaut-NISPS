import { MODULAR_PRESETS, applyPreset } from '../synth/modular-presets.js';

/**
 * modular-ui.js — "Quick peek" drawer for the Modular audio mode.
 *
 * User-facing control panel for ModularEngine:
 *   - Sub-engine toggle (Subtractive / Additive / FM)
 *   - Mod pool count steppers (ADSR 1..16, LFO 1..32)
 *   - Per-slot enable toggles (independent of count)
 *   - Expose engine sound params to the MLP
 *   - Quick preset overlay
 *
 * The matrix editor used to live here as a cramped 48×N grid. As of
 * `meml-ptgi` that editor has moved to the full-viewport Patch Bay modal
 * (`patch-bay-modal.js`, `meml-usd6`); this drawer remains as a quick-peek
 * alternative per `meml-coh8`.
 *
 * The panel is mounted as a drawer in the existing `#drawer-stack`, with a
 * matching dock icon injected into `#dock`. Both are hidden until the
 * modular engine becomes active.
 *
 * @module modular-ui
 */

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'nisps-modular-state';

const MAX_ADSR = 16;
const MAX_LFO  = 32;

const SUB_ENGINE_OPTIONS = [
  { id: 'subtractive', label: 'Subtractive' },
  { id: 'additive',    label: 'Additive'    },
  { id: 'fm',          label: 'FM'          },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the Modular UI. Creates the drawer and dock icon (hidden), and
 * wires them to the engine returned by `getEngine()`.
 *
 * @param {object} opts
 * @param {() => object} opts.getEngine    — returns current activeEngine
 * @param {() => void}   [opts.onStateChange] — optional hook when UI state
 *                                               persists to localStorage
 * @returns {{ teardown, refresh, show, hide, isVisible }}
 */
export function initModularUI({ getEngine, onStateChange } = {}) {
  injectStyles();

  const dockIcon = createDockIcon();
  const drawer   = createDrawer();

  const uiState = loadUIState();

  // Subscription handle for the active engine's paramMeta:change event.
  let unsubParamMeta = null;
  let lastWiredEngine = null;

  // DOM refs — populated by the section builders.
  const refs = {
    subEngineBtns:  [],
    adsrCountValue: null,
    lfoCountValue:  null,
    adsrEnables:    [],
    lfoEnables:     [],
    soundParamList: null,
  };

  // ---- Build panel sections ----
  buildSubEngineSection(drawer.body, refs, applySubEngineChange);
  buildPresetsSection(drawer.body, openPresetOverlay);
  buildCountSection(drawer.body, refs, applyCountChange);
  buildEnableSection(drawer.body, refs, applyEnableChange);
  buildSoundParamSection(drawer.body, refs);

  // ---- Apply saved UI state to engine as soon as we can ----
  // We defer engine mutations until refresh() is called with a live engine.
  let pendingRestore = true;

  // ---------------------------------------------------------------------------
  // Engine binding
  // ---------------------------------------------------------------------------

  function bindEngine(engine) {
    if (engine === lastWiredEngine) return;
    if (unsubParamMeta) { try { unsubParamMeta(); } catch (_) { /* ignore */ } }
    unsubParamMeta = null;
    lastWiredEngine = engine;
    if (engine && typeof engine.on === 'function') {
      unsubParamMeta = engine.on('paramMeta:change', () => {
        rebuildSoundParamList();
        refreshSubEngineButtons();
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Build: sub-engine section
  // ---------------------------------------------------------------------------

  function refreshSubEngineButtons() {
    const engine = getEngine?.();
    if (!engine || engine.id !== 'modular') return;
    const available = new Set(engine.availableSubEngines || []);
    const active    = engine.activeSubEngineId;
    for (const btn of refs.subEngineBtns) {
      const id = btn.dataset.subEngine;
      btn.classList.toggle('active', id === active);
      btn.disabled = !available.has(id);
      btn.title = available.has(id)
        ? `Use ${id} sub-engine`
        : `${id} not available yet`;
    }
  }

  async function applySubEngineChange(id) {
    const engine = getEngine?.();
    if (!engine || engine.id !== 'modular') return;
    if (id === engine.activeSubEngineId) return;
    refs.subEngineBtns.forEach(b => b.classList.toggle('busy', b.dataset.subEngine === id));
    try {
      await engine.setSubEngine(id);
      uiState.subEngine = id;
      saveUIState();
    } catch (err) {
      console.error('[modular-ui] setSubEngine failed:', err);
    } finally {
      refs.subEngineBtns.forEach(b => b.classList.remove('busy'));
      refreshSubEngineButtons();
    }
  }

  // ---------------------------------------------------------------------------
  // Build: count section
  // ---------------------------------------------------------------------------

  function applyCountChange(kind, newCount) {
    const engine = getEngine?.();
    if (!engine || engine.id !== 'modular') return;
    const adsr = kind === 'adsr' ? newCount : engine.adsrCount;
    const lfo  = kind === 'lfo'  ? newCount : engine.lfoCount;
    engine.setModSourceCount?.(adsr, lfo);
    uiState.adsrCount = adsr;
    uiState.lfoCount  = lfo;
    // Ensure enable arrays are long enough
    while (uiState.adsrEnables.length < MAX_ADSR) uiState.adsrEnables.push(false);
    while (uiState.lfoEnables.length  < MAX_LFO)  uiState.lfoEnables.push(false);
    // Newly-in-count slots default to enabled (if previously disabled).
    for (let i = 0; i < adsr; i++) if (!uiState.adsrEnables[i]) uiState.adsrEnables[i] = true;
    for (let i = 0; i < lfo;  i++) if (!uiState.lfoEnables[i])  uiState.lfoEnables[i]  = true;
    applyAllEnablesToEngine();
    saveUIState();
    refreshCountValues();
    refreshEnableRow();
  }

  function refreshCountValues() {
    if (refs.adsrCountValue) refs.adsrCountValue.textContent = String(uiState.adsrCount);
    if (refs.lfoCountValue)  refs.lfoCountValue.textContent  = String(uiState.lfoCount);
  }

  // ---------------------------------------------------------------------------
  // Build: enable switches
  // ---------------------------------------------------------------------------

  function refreshEnableRow() {
    for (let i = 0; i < MAX_ADSR; i++) {
      const btn = refs.adsrEnables[i];
      if (!btn) continue;
      const inCount = i < uiState.adsrCount;
      btn.classList.toggle('active',       !!uiState.adsrEnables[i]);
      btn.classList.toggle('out-of-count', !inCount);
      btn.title = inCount
        ? `ADSR ${i + 1}: ${uiState.adsrEnables[i] ? 'enabled' : 'disabled'}`
        : `ADSR ${i + 1}: slot past count (not MLP-driven)`;
    }
    for (let i = 0; i < MAX_LFO; i++) {
      const btn = refs.lfoEnables[i];
      if (!btn) continue;
      const inCount = i < uiState.lfoCount;
      btn.classList.toggle('active',       !!uiState.lfoEnables[i]);
      btn.classList.toggle('out-of-count', !inCount);
      btn.title = inCount
        ? `LFO ${i + 1}: ${uiState.lfoEnables[i] ? 'enabled' : 'disabled'}`
        : `LFO ${i + 1}: slot past count (not MLP-driven)`;
    }
  }

  function applyEnableChange(kind, i, enabled) {
    const engine = getEngine?.();
    if (!engine || engine.id !== 'modular') return;
    if (kind === 'adsr') uiState.adsrEnables[i] = enabled;
    else                 uiState.lfoEnables[i]  = enabled;
    writeEnableToEngine(engine, kind, i, enabled);
    saveUIState();
    refreshEnableRow();
  }

  function writeEnableToEngine(engine, kind, i, enabled) {
    if (typeof engine._setRawByLabel !== 'function') return;
    const label = (kind === 'adsr')
      ? `MM_ADSR/${pad2(i)}_adsr${pad2(i + 1)}_enable`
      : `MM_LFO/${pad2(i)}_lfo${pad2(i + 1)}_enable`;
    engine._setRawByLabel(label, enabled ? 1.0 : 0.0);
  }

  function applyAllEnablesToEngine() {
    const engine = getEngine?.();
    if (!engine || engine.id !== 'modular') return;
    for (let i = 0; i < MAX_ADSR; i++) {
      writeEnableToEngine(engine, 'adsr', i, !!uiState.adsrEnables[i]);
    }
    for (let i = 0; i < MAX_LFO; i++) {
      writeEnableToEngine(engine, 'lfo', i, !!uiState.lfoEnables[i]);
    }
  }

  // ---------------------------------------------------------------------------
  // Sound param exposure
  // ---------------------------------------------------------------------------

  function rebuildSoundParamList() {
    const list = refs.soundParamList;
    if (!list) return;
    list.innerHTML = '';
    const engine = getEngine?.();
    if (!engine || engine.id !== 'modular' ||
        typeof engine.getEngineSoundParamLabels !== 'function') {
      const note = document.createElement('div');
      note.className = 'mm-hint';
      note.textContent = 'Modular engine not active.';
      list.appendChild(note);
      return;
    }
    const entries = engine.getEngineSoundParamLabels();
    if (entries.length === 0) {
      const note = document.createElement('div');
      note.className = 'mm-hint';
      note.textContent = 'No engine sound params exposed by this sub-engine.';
      list.appendChild(note);
      return;
    }

    // Group by top-level prefix for readability.
    const groups = new Map();
    for (const e of entries) {
      const [group] = splitLabel(e.label);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(e);
    }

    for (const [group, params] of groups.entries()) {
      const h = document.createElement('div');
      h.className = 'mm-sound-group';
      h.textContent = prettyGroup(group);
      list.appendChild(h);

      for (const p of params) {
        const row = document.createElement('label');
        row.className = 'mm-sound-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = engine.isEngineParamExposed?.(p.label) ?? false;
        cb.addEventListener('change', () => applyExposeChange(p.label, cb.checked));
        const name = document.createElement('span');
        name.textContent = stripIndexPrefix(splitLabel(p.label)[1]);
        name.title = p.label;
        row.appendChild(cb);
        row.appendChild(name);
        list.appendChild(row);
      }
    }

    const warning = document.createElement('div');
    warning.className = 'mm-hint warn';
    warning.textContent =
      'Toggling exposes/unexposes a param to the MLP. The network is resized ' +
      'in place (training examples are preserved; output layer is warm-started).';
    list.appendChild(warning);
  }

  // ---------------------------------------------------------------------------
  // Preset overlay
  // ---------------------------------------------------------------------------

  async function openPresetOverlay() {
    const existing = document.getElementById('mm-preset-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'mm-preset-overlay';
    overlay.className = 'mm-preset-overlay';

    const panel = document.createElement('div');
    panel.className = 'mm-preset-panel';

    const header = document.createElement('div');
    header.className = 'mm-preset-header';
    const title = document.createElement('div');
    title.className = 'mm-preset-title';
    title.textContent = 'Modular presets';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'mm-preset-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => overlay.remove());
    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const list = document.createElement('div');
    list.className = 'mm-preset-list';
    for (const preset of MODULAR_PRESETS) {
      const item = document.createElement('button');
      item.className = 'mm-preset-item';
      item.dataset.presetId = preset.id;
      const name = document.createElement('div');
      name.className = 'mm-preset-name';
      name.textContent = preset.name;
      const desc = document.createElement('div');
      desc.className = 'mm-preset-desc';
      desc.textContent = preset.description;
      const sub = document.createElement('div');
      sub.className = 'mm-preset-sub';
      sub.textContent = preset.state?.subEngine ?? '';
      item.appendChild(name);
      item.appendChild(desc);
      item.appendChild(sub);
      item.addEventListener('click', async () => {
        item.classList.add('busy');
        try {
          const engine = getEngine?.();
          if (engine && engine.id === 'modular') {
            await applyPreset(engine, preset);
            if (preset.state?.subEngine) uiState.subEngine = preset.state.subEngine;
            if (typeof preset.state?.adsrCount === 'number') {
              uiState.adsrCount = preset.state.adsrCount;
            }
            if (typeof preset.state?.lfoCount === 'number') {
              uiState.lfoCount = preset.state.lfoCount;
            }
            saveUIState();
            onStateChange?.();
            refresh();
          }
        } catch (err) {
          console.error('[modular-ui] preset apply failed:', err);
        } finally {
          item.classList.remove('busy');
          overlay.remove();
        }
      });
      list.appendChild(item);
    }
    panel.appendChild(list);
    overlay.appendChild(panel);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
  }

  function applyExposeChange(label, exposed) {
    const engine = getEngine?.();
    if (!engine || engine.id !== 'modular') return;
    engine.setExposeEngineParam?.(label, exposed);
    if (exposed) {
      if (!uiState.exposedEngineParams.includes(label)) {
        uiState.exposedEngineParams.push(label);
      }
    } else {
      uiState.exposedEngineParams = uiState.exposedEngineParams.filter(l => l !== label);
    }
    saveUIState();
    // paramMeta:change listener rebuilds the sound param list.
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  function show() {
    dockIcon.classList.remove('hidden');
    const engine = getEngine?.();
    if (engine && engine.id === 'modular') bindEngine(engine);
    refresh();
  }

  function hide() {
    dockIcon.classList.add('hidden');
    dockIcon.classList.remove('active');
    drawer.root.classList.add('hidden');
  }

  function isVisible() {
    return !dockIcon.classList.contains('hidden');
  }

  function refresh() {
    const engine = getEngine?.();
    if (!engine || engine.id !== 'modular') return;
    bindEngine(engine);

    // One-time apply of persisted state to the engine.
    if (pendingRestore) {
      pendingRestore = false;
      try {
        if (uiState.subEngine && uiState.subEngine !== engine.activeSubEngineId
            && engine.availableSubEngines?.includes(uiState.subEngine)) {
          engine.setSubEngine?.(uiState.subEngine);
        }
        if (typeof engine.setModSourceCount === 'function') {
          engine.setModSourceCount(uiState.adsrCount, uiState.lfoCount);
        }
        for (const label of uiState.exposedEngineParams) {
          engine.setExposeEngineParam?.(label, true);
        }
        applyAllEnablesToEngine();
      } catch (err) {
        console.warn('[modular-ui] restore failed:', err);
      }
    }

    // Keep UI widgets in sync with engine state (in case engine was
    // mutated outside of our control — e.g. preset load).
    if (engine.adsrCount != null) uiState.adsrCount = engine.adsrCount;
    if (engine.lfoCount  != null) uiState.lfoCount  = engine.lfoCount;

    refreshSubEngineButtons();
    refreshCountValues();
    refreshEnableRow();
    rebuildSoundParamList();
  }

  function teardown() {
    if (unsubParamMeta) { try { unsubParamMeta(); } catch (_) { /* ignore */ } }
    unsubParamMeta = null;
    dockIcon.remove();
    drawer.root.remove();
    const style = document.getElementById('modular-ui-styles');
    if (style) style.remove();
  }

  // Start hidden (engine-gated).
  hide();

  drawer.closeBtn.addEventListener('click', () => {
    drawer.root.classList.add('hidden');
    dockIcon.classList.remove('active');
  });

  return {
    teardown,
    refresh,
    show,
    hide,
    isVisible,
  };

  // ===========================================================================
  // Section builders
  // ===========================================================================

  function buildSubEngineSection(body, refs, onChange) {
    const section = el('div', 'mm-section');
    section.appendChild(el('div', 'mm-section-header', 'Sub-engine'));

    const row = el('div', 'mm-row mm-sub-row');
    for (const opt of SUB_ENGINE_OPTIONS) {
      const b = el('button', 'mm-sub-btn', opt.label);
      b.dataset.subEngine = opt.id;
      b.addEventListener('click', () => onChange(opt.id));
      refs.subEngineBtns.push(b);
      row.appendChild(b);
    }
    section.appendChild(row);
    body.appendChild(section);
  }

  function buildPresetsSection(body, onOpen) {
    const section = el('div', 'mm-section');
    const header = el('div', 'mm-section-header', 'Presets');
    section.appendChild(header);
    const btn = el('button', 'mm-preset-open-btn', 'Load preset…');
    btn.addEventListener('click', onOpen);
    section.appendChild(btn);
    body.appendChild(section);
  }

  function buildCountSection(body, refs, onCountChange) {
    const section = el('div', 'mm-section');
    section.appendChild(el('div', 'mm-section-header', 'Mod Pool'));

    const hint = el('div', 'mm-hint',
      'Slots past the count stay alive in the DSP but are not MLP-driven. ' +
      'Changing counts reinitialises the MLP.');
    section.appendChild(hint);

    const mkStepper = (labelText, kind, max) => {
      const row = el('div', 'mm-row mm-stepper-row');
      row.appendChild(el('label', 'mm-label', labelText));
      const dec  = el('button', 'mm-step-btn', '−');
      const val  = el('span',   'mm-step-val', String(uiState[kind === 'adsr' ? 'adsrCount' : 'lfoCount']));
      const inc  = el('button', 'mm-step-btn', '+');
      dec.addEventListener('click', () => {
        const cur = parseInt(val.textContent, 10);
        if (cur > 1) onCountChange(kind, cur - 1);
      });
      inc.addEventListener('click', () => {
        const cur = parseInt(val.textContent, 10);
        if (cur < max) onCountChange(kind, cur + 1);
      });
      row.appendChild(dec);
      row.appendChild(val);
      row.appendChild(inc);
      row.appendChild(el('span', 'mm-step-range', `(1..${max})`));
      if (kind === 'adsr') refs.adsrCountValue = val;
      else                 refs.lfoCountValue  = val;
      return row;
    };

    section.appendChild(mkStepper('ADSR count', 'adsr', MAX_ADSR));
    section.appendChild(mkStepper('LFO count',  'lfo',  MAX_LFO));
    body.appendChild(section);
  }

  function buildEnableSection(body, refs, onEnableChange) {
    const section = el('div', 'mm-section');
    section.appendChild(el('div', 'mm-section-header', 'Slot enables'));

    const mkRow = (kind, max) => {
      const wrap = el('div', 'mm-enable-wrap');
      wrap.appendChild(el('div', 'mm-enable-label', kind.toUpperCase()));
      const row = el('div', 'mm-enable-row');
      for (let i = 0; i < max; i++) {
        const b = el('button', `mm-enable-btn mm-enable-${kind}`, String(i + 1));
        b.addEventListener('click', () => {
          const enabled = !b.classList.contains('active');
          onEnableChange(kind, i, enabled);
        });
        if (kind === 'adsr') refs.adsrEnables.push(b);
        else                 refs.lfoEnables.push(b);
        row.appendChild(b);
      }
      wrap.appendChild(row);
      return wrap;
    };

    section.appendChild(mkRow('adsr', MAX_ADSR));
    section.appendChild(mkRow('lfo',  MAX_LFO));
    body.appendChild(section);
  }

  function buildSoundParamSection(body, refs) {
    const section = el('div', 'mm-section');
    section.appendChild(el('div', 'mm-section-header', 'Engine sound params'));
    const list = el('div', 'mm-sound-list');
    refs.soundParamList = list;
    section.appendChild(list);
    body.appendChild(section);
  }

  // ===========================================================================
  // localStorage
  // ===========================================================================

  function loadUIState() {
    const defaults = {
      subEngine:  'subtractive',
      adsrCount:  4,
      lfoCount:   8,
      adsrEnables: Array.from({ length: MAX_ADSR }, (_, i) => i < 4),
      lfoEnables:  Array.from({ length: MAX_LFO  }, (_, i) => i < 8),
      exposedEngineParams: [],
    };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaults;
      const s = JSON.parse(raw);
      return {
        subEngine:  typeof s.subEngine === 'string' ? s.subEngine : defaults.subEngine,
        adsrCount:  clamp(s.adsrCount,  1, MAX_ADSR, defaults.adsrCount),
        lfoCount:   clamp(s.lfoCount,   1, MAX_LFO,  defaults.lfoCount),
        adsrEnables: padBool(s.adsrEnables, MAX_ADSR, defaults.adsrEnables),
        lfoEnables:  padBool(s.lfoEnables,  MAX_LFO,  defaults.lfoEnables),
        exposedEngineParams: Array.isArray(s.exposedEngineParams) ? s.exposedEngineParams.slice() : [],
      };
    } catch (_) {
      return defaults;
    }
  }

  function saveUIState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(uiState));
      onStateChange?.();
    } catch (err) {
      console.warn('[modular-ui] saveUIState failed:', err);
    }
  }
}

// ---------------------------------------------------------------------------
// DOM scaffolding
// ---------------------------------------------------------------------------

function createDockIcon() {
  const dock = document.getElementById('dock');
  if (!dock) throw new Error('[modular-ui] #dock not found');

  const helpIcon = dock.querySelector('.dock-icon[data-drawer="help"]');
  const btn = document.createElement('button');
  btn.className = 'dock-icon hidden';
  btn.dataset.drawer = 'modular';
  btn.title = 'Modular mod pool';
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="2" width="3" height="3" rx="0.5"/>
      <rect x="6.5" y="2" width="3" height="3" rx="0.5"/>
      <rect x="11" y="2" width="3" height="3" rx="0.5"/>
      <rect x="2" y="6.5" width="3" height="3" rx="0.5"/>
      <rect x="6.5" y="6.5" width="3" height="3" rx="0.5"/>
      <rect x="11" y="6.5" width="3" height="3" rx="0.5"/>
      <rect x="2" y="11" width="3" height="3" rx="0.5"/>
      <rect x="6.5" y="11" width="3" height="3" rx="0.5"/>
      <rect x="11" y="11" width="3" height="3" rx="0.5"/>
    </svg>
    <span class="dock-label">Mod</span>
  `;
  if (helpIcon) dock.insertBefore(btn, helpIcon);
  else          dock.appendChild(btn);
  return btn;
}

function createDrawer() {
  const stack = document.getElementById('drawer-stack');
  if (!stack) throw new Error('[modular-ui] #drawer-stack not found');

  const root = document.createElement('div');
  root.className = 'drawer hidden mm-drawer';
  root.id = 'drawer-modular';
  root.dataset.drawer = 'modular';

  const header = document.createElement('div');
  header.className = 'drawer-header';
  const title = document.createElement('span');
  title.textContent = 'Modular';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'drawer-close';
  closeBtn.dataset.drawer = 'modular';
  closeBtn.innerHTML = '&times;';
  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'drawer-body mm-body';

  root.appendChild(header);
  root.appendChild(body);
  stack.appendChild(root);

  return { root, header, body, closeBtn };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function injectStyles() {
  if (document.getElementById('modular-ui-styles')) return;
  const s = document.createElement('style');
  s.id = 'modular-ui-styles';
  s.textContent = `
    .mm-drawer .mm-body {
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 8px 10px 16px;
      max-height: 85vh;
    }
    .mm-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px;
      border: 1px solid var(--glass-border, rgba(255,255,255,0.08));
      border-radius: var(--radius-sm, 8px);
      background: rgba(255,255,255,0.02);
    }
    .mm-section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-dim, #888);
      margin-bottom: 2px;
    }
    .mm-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .mm-label {
      flex: 0 0 auto;
      font-size: 0.75rem;
      color: var(--text-dim, #888);
    }
    .mm-hint {
      font-size: 0.65rem;
      color: var(--text-dim, #888);
      line-height: 1.3;
    }
    .mm-hint.warn {
      color: #ffb070;
    }

    /* Sub-engine buttons */
    .mm-sub-row { gap: 4px; }
    .mm-sub-btn {
      flex: 1;
      padding: 8px 10px;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
      border-radius: 6px;
      color: var(--text, #e0e0e0);
      font-size: 0.75rem;
      cursor: pointer;
      min-height: 34px;
      touch-action: manipulation;
    }
    .mm-sub-btn:hover:not(:disabled) { border-color: var(--accent, #ff6a00); }
    .mm-sub-btn.active {
      background: var(--accent-dim, rgba(255,106,0,0.25));
      border-color: var(--accent, #ff6a00);
      color: var(--accent, #ff6a00);
    }
    .mm-sub-btn:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .mm-sub-btn.busy { opacity: 0.6; }

    /* Steppers */
    .mm-stepper-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .mm-stepper-row .mm-label { flex: 1; }
    .mm-step-btn {
      width: 32px;
      height: 32px;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
      border-radius: 6px;
      color: var(--text, #e0e0e0);
      cursor: pointer;
      font-size: 1rem;
      touch-action: manipulation;
    }
    .mm-step-btn:hover { border-color: var(--accent, #ff6a00); }
    .mm-step-val {
      display: inline-block;
      min-width: 28px;
      text-align: center;
      font-variant-numeric: tabular-nums;
      font-weight: 500;
    }
    .mm-step-range {
      font-size: 0.65rem;
      color: var(--text-dim, #888);
      margin-left: 4px;
    }

    /* Enable rows */
    .mm-enable-wrap {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .mm-enable-label {
      font-size: 0.6rem;
      color: var(--text-dim, #888);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .mm-enable-row {
      display: flex;
      flex-wrap: wrap;
      gap: 3px;
    }
    .mm-enable-btn {
      width: 24px;
      height: 24px;
      font-size: 0.6rem;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
      border-radius: 4px;
      color: var(--text-dim, #888);
      cursor: pointer;
      padding: 0;
      touch-action: manipulation;
    }
    .mm-enable-btn.active {
      background: var(--accent-dim, rgba(255,106,0,0.25));
      border-color: var(--accent, #ff6a00);
      color: var(--accent, #ff6a00);
    }
    .mm-enable-btn.out-of-count {
      opacity: 0.35;
    }

    /* Sound params list */
    .mm-sound-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 260px;
      overflow-y: auto;
    }
    .mm-sound-group {
      font-size: 0.6rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-dim, #888);
      margin-top: 6px;
      padding-bottom: 2px;
      border-bottom: 1px solid var(--glass-border, rgba(255,255,255,0.06));
    }
    .mm-sound-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.72rem;
      color: var(--text, #e0e0e0);
      padding: 3px 2px;
      cursor: pointer;
    }
    .mm-sound-row input[type="checkbox"] {
      accent-color: var(--accent, #ff6a00);
      width: 16px;
      height: 16px;
    }

    /* Preset overlay */
    .mm-preset-open-btn {
      padding: 8px 12px;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
      border-radius: 6px;
      color: var(--text, #e0e0e0);
      cursor: pointer;
      font-size: 0.75rem;
      text-align: center;
      touch-action: manipulation;
    }
    .mm-preset-open-btn:hover {
      border-color: var(--accent, #ff6a00);
      color: var(--accent, #ff6a00);
    }
    .mm-preset-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: 16px;
    }
    .mm-preset-panel {
      background: #0d0d0d;
      border: 1px solid var(--glass-border, rgba(255,255,255,0.15));
      border-radius: 10px;
      width: min(420px, 100%);
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
    }
    .mm-preset-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--glass-border, rgba(255,255,255,0.08));
    }
    .mm-preset-title {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text, #e0e0e0);
    }
    .mm-preset-close {
      background: transparent;
      border: none;
      color: var(--text-dim, #888);
      font-size: 1.3rem;
      cursor: pointer;
      padding: 0 6px;
    }
    .mm-preset-close:hover { color: var(--accent, #ff6a00); }
    .mm-preset-list {
      display: flex;
      flex-direction: column;
      gap: 1px;
      background: rgba(255,255,255,0.04);
      overflow-y: auto;
    }
    .mm-preset-item {
      background: #0d0d0d;
      border: none;
      color: var(--text, #e0e0e0);
      text-align: left;
      padding: 10px 16px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 2px;
      touch-action: manipulation;
    }
    .mm-preset-item:hover {
      background: var(--accent-dim, rgba(255,106,0,0.15));
    }
    .mm-preset-item.busy { opacity: 0.5; }
    .mm-preset-name {
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--accent, #ff6a00);
    }
    .mm-preset-desc {
      font-size: 0.7rem;
      color: var(--text-dim, #888);
      line-height: 1.3;
    }
    .mm-preset-sub {
      font-size: 0.6rem;
      color: var(--text-dim, #666);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    /* Mobile tweaks */
    @media (max-width: 640px) {
      .mm-drawer .mm-body { padding: 6px 8px 12px; gap: 10px; }
    }
  `;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function clamp(v, lo, hi, fallback) {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function padBool(arr, len, fallback) {
  const src = Array.isArray(arr) ? arr : fallback;
  const out = new Array(len);
  for (let i = 0; i < len; i++) out[i] = !!src[i];
  return out;
}

function splitLabel(label) {
  const i = label.lastIndexOf('/');
  if (i < 0) return ['', label];
  return [label.slice(0, i), label.slice(i + 1)];
}

function stripIndexPrefix(leaf) {
  return leaf.replace(/^\d+_/, '');
}

function prettyGroup(group) {
  return group.replace(/^\d+_/, '').replace(/_/g, ' ');
}
