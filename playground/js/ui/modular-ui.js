import { MODULAR_PRESETS, applyPreset } from '../synth/modular-presets.js';

/**
 * modular-ui.js — Phase C of the "Modular" audio mode.
 *
 * User-facing control panel for ModularEngine:
 *   - Sub-engine toggle (Subtractive / Additive / FM)
 *   - Mod pool count steppers (ADSR 1..16, LFO 1..32)
 *   - Per-slot enable toggles (independent of count)
 *   - Matrix grid editor (sources × destinations, signed [-1, 1] amounts)
 *   - Expose engine sound params to the MLP
 *
 * The panel is mounted as a drawer in the existing `#drawer-stack`, with a
 * matching dock icon injected into `#dock`. Both are hidden until the
 * modular engine becomes active.
 *
 * Matrix paramMeta layout (from Phase B, VERIFIED at runtime via label
 * prefix `MM_Matrix/` on rebuild): mod sources first (ADSR + LFO), matrix
 * cells second (dest-major, source-major within each destination), opted-in
 * engine sound params last. We discover matrix cells by group prefix, not
 * by hardcoded offsets, so that count changes / sub-engine swaps are safe.
 *
 * Raw matrix cell range is [-1, 1]; paramMeta normalises to [0, 1] via
 * `(raw - min) / (max - min)`. UI uses signed values directly and converts
 * `(v + 1) / 2` when calling `engine.setParam(i, norm01)`.
 *
 * @module modular-ui
 */

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'nisps-modular-state';

const MAX_ADSR = 16;
const MAX_LFO  = 32;

// Matrix cell cycle on left-click (positive only). Shift-click → 0.
// Right-click opens a menu with ±1 / 0 / random.
const CLICK_CYCLE = [0, 0.25, 0.5, 0.75, 1.0];

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
    matrixGrid:     null,
    matrixEmpty:    null,
    soundParamList: null,
  };

  // ---- Build panel sections ----
  buildSubEngineSection(drawer.body, refs, applySubEngineChange);
  buildPresetsSection(drawer.body, openPresetOverlay);
  buildCountSection(drawer.body, refs, applyCountChange);
  buildEnableSection(drawer.body, refs, applyEnableChange);
  buildMatrixSection(drawer.body, refs, {
    onCellCycle:    (src, dst)        => cycleCell(src, dst),
    onCellInvert:   (src, dst)        => setCell(src, dst, -getCell(src, dst)),
    onCellZero:     (src, dst)        => setCell(src, dst, 0),
    onCellPrecise:  (src, dst, el)    => openPreciseEditor(src, dst, el),
    onCellMenu:     (src, dst, el, e) => openCellMenu(src, dst, el, e),
  });
  buildSoundParamSection(drawer.body, refs, applyExposeChange);

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
        rebuildMatrixGrid();
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
      // paramMeta:change listener rebuilds the grid
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
    rebuildMatrixGrid();
  }

  function refreshCountValues() {
    if (refs.adsrCountValue) refs.adsrCountValue.textContent = String(uiState.adsrCount);
    if (refs.lfoCountValue)  refs.lfoCountValue.textContent  = String(uiState.lfoCount);
  }

  // ---------------------------------------------------------------------------
  // Build: enable switches
  // ---------------------------------------------------------------------------

  function refreshEnableRow() {
    const active = getEngine?.();
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
  // Matrix grid
  // ---------------------------------------------------------------------------

  /**
   * Given engine paramMeta, discover matrix cells by group prefix.
   * Returns a Map: `${s}|${d}` -> paramMeta index.
   */
  function buildMatrixIndex(engine) {
    const out = new Map();
    const meta = engine?.paramMeta ?? [];
    for (let i = 0; i < meta.length; i++) {
      const m = meta[i];
      if (!m || !m.group || !m.group.startsWith('Matrix/')) continue;
      // Label is like "MM_Matrix/s03_d08_amp" — parse out s and d.
      const lbl = m.label || '';
      const match = lbl.match(/s(\d{2})_d(\d{2})_/);
      if (!match) continue;
      const s = parseInt(match[1], 10);
      const d = parseInt(match[2], 10);
      out.set(`${s}|${d}`, i);
    }
    return out;
  }

  // Current cell values (signed [-1, 1]), keyed by "s|d". Populated from
  // paramMeta entries on rebuild; mutated by user interaction.
  const cellValues = new Map();

  function getCell(s, d) { return cellValues.get(`${s}|${d}`) ?? 0; }

  function setCell(s, d, value, { persistToEngine = true } = {}) {
    const v = Math.max(-1, Math.min(1, value));
    cellValues.set(`${s}|${d}`, v);
    updateCellDOM(s, d, v);
    if (!persistToEngine) return;
    const engine = getEngine?.();
    if (!engine || engine.id !== 'modular') return;

    // Matrix cells are direct DSP knobs by default — write straight to
    // the worklet by Faust label. (If a cell has been opt'd into the MLP
    // output vector via setExposeMatrixCell, the MLP will overwrite it on
    // the next inference tick; that's fine, this write still feeds the
    // worklet immediately for tactile feedback.)
    const destNames = engine.destNames || [];
    const destName = destNames[d];
    if (!destName) return;
    const label = `MM_Matrix/s${String(s).padStart(2, '0')}_d${String(d).padStart(2, '0')}_${destName}`;
    engine._setRawByLabel?.(label, v);
  }

  function cycleCell(s, d) {
    const cur = getCell(s, d);
    // Cycle positive steps only, wrapping back to 0.
    // Negatives reached via right-click menu or precise editor.
    let nextIdx = 0;
    // Match to nearest current step, then advance.
    if (cur > 0) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < CLICK_CYCLE.length; i++) {
        const diff = Math.abs(CLICK_CYCLE[i] - cur);
        if (diff < bestD) { bestD = diff; best = i; }
      }
      nextIdx = (best + 1) % CLICK_CYCLE.length;
    } else {
      // From 0 or negative: jump up to 0.25 to start the cycle.
      nextIdx = 1;
    }
    setCell(s, d, CLICK_CYCLE[nextIdx]);
  }

  let matrixIndexCache = new Map();

  function rebuildMatrixGrid() {
    const engine = getEngine?.();
    const gridEl = refs.matrixGrid;
    if (!gridEl) return;

    gridEl.innerHTML = '';
    matrixIndexCache = new Map();
    cellValues.clear();

    if (!engine || engine.id !== 'modular') {
      if (refs.matrixEmpty) refs.matrixEmpty.textContent = 'Modular engine not active.';
      return;
    }

    const destNames = engine.destNames || [];
    if (destNames.length === 0) {
      if (refs.matrixEmpty) refs.matrixEmpty.textContent = 'Waiting for sub-engine…';
      return;
    }

    // Matrix cells may or may not be in paramMeta (they're opt-in for MLP
    // control; default is that the matrix is a direct-DSP patch editor).
    // Build the paramMeta index for cells that ARE exposed, so updateLive
    // can mirror MLP outputs into them; other cells are direct-edit only.
    matrixIndexCache = buildMatrixIndex(engine);
    if (refs.matrixEmpty) refs.matrixEmpty.textContent = '';

    // Seed current values from the engine's _lastRawByLabel map (which
    // tracks every write via setParam / _setRawByLabel / default patch),
    // falling back to the walk-entry init value for cells the user has
    // never touched. (destNames is already in scope from the early guard.)
    const lastRaw = engine._lastRawByLabel || new Map();
    for (let d = 0; d < destNames.length; d++) {
      const destName = destNames[d];
      for (let s = 0; s < 48; s++) {
        const label = `MM_Matrix/s${String(s).padStart(2, '0')}_d${String(d).padStart(2, '0')}_${destName}`;
        const walk = engine._labelToWalk?.get?.(label);
        if (!walk) continue;
        const raw = lastRaw.has(label) ? lastRaw.get(label) : walk.init;
        cellValues.set(`${s}|${d}`, raw);
      }
    }

    // Determine visible source range from current counts.
    const adsrN = uiState.adsrCount;
    const lfoN  = uiState.lfoCount;
    const visibleSources = [];
    for (let i = 0; i < adsrN; i++) visibleSources.push({ s: i,            label: `A${i + 1}`, kind: 'adsr' });
    for (let i = 0; i < lfoN;  i++) visibleSources.push({ s: 16 + i,       label: `L${i + 1}`, kind: 'lfo'  });
    // NOTE: source index layout — sources 0..15 are ADSRs, 16..47 are LFOs.
    // This mirrors the Faust .dsp's MM_* declaration order, VERIFIED by the
    // walk-entry labels: matrix column s00..s15 are ADSRs, s16..s47 are LFOs.

    const cols = destNames.length;
    const rows = visibleSources.length;

    // CSS grid: 1 header col + N dest cols × 1 header row + M source rows
    gridEl.style.gridTemplateColumns = `auto repeat(${cols}, minmax(28px, 1fr))`;
    gridEl.style.gridTemplateRows    = `auto repeat(${rows}, 32px)`;

    // Top-left corner
    const corner = document.createElement('div');
    corner.className = 'mm-corner';
    gridEl.appendChild(corner);

    // Column headers
    destNames.forEach((name, d) => {
      const h = document.createElement('div');
      h.className = 'mm-col-header';
      h.textContent = shortDest(name);
      h.title = name;
      gridEl.appendChild(h);
    });

    // Rows
    visibleSources.forEach((src) => {
      const rh = document.createElement('div');
      rh.className = `mm-row-header mm-src-${src.kind}`;
      rh.textContent = src.label;
      rh.title = src.kind === 'adsr' ? `ADSR ${src.s + 1}` : `LFO ${src.s - 15}`;
      gridEl.appendChild(rh);

      for (let d = 0; d < cols; d++) {
        const cell = document.createElement('div');
        cell.className = 'mm-cell';
        cell.dataset.s = src.s;
        cell.dataset.d = d;
        const has = matrixIndexCache.has(`${src.s}|${d}`);
        if (!has) cell.classList.add('unavailable');
        attachCellHandlers(cell, src.s, d);
        gridEl.appendChild(cell);
        updateCellDOM(src.s, d, getCell(src.s, d));
      }
    });
  }

  function updateCellDOM(s, d, v) {
    const cell = refs.matrixGrid?.querySelector(`.mm-cell[data-s="${s}"][data-d="${d}"]`);
    if (!cell) return;
    const abs = Math.abs(v);
    const label = v === 0
      ? ''
      : (v > 0 ? '' : '−') + abs.toFixed(2).replace(/^0/, '');
    cell.textContent = label;
    const alpha = Math.min(1, abs);
    const color = v >= 0
      ? `rgba(255, 106, 0, ${alpha * 0.85})`   // accent (positive)
      : `rgba(80, 160, 255, ${alpha * 0.85})`; // blue (negative / inverted)
    cell.style.background = alpha > 0.01
      ? color
      : 'rgba(255, 255, 255, 0.04)';
    cell.classList.toggle('nonzero', alpha > 0.01);
  }

  function attachCellHandlers(cell, s, d) {
    let longPressTimer = null;
    let didLongPress = false;

    cell.addEventListener('click', (e) => {
      if (cell.classList.contains('unavailable')) return;
      if (didLongPress) { didLongPress = false; return; }
      if (e.shiftKey) { setCell(s, d, 0); return; }
      cycleCell(s, d);
    });

    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (cell.classList.contains('unavailable')) return;
      openCellMenu(s, d, cell, e);
    });

    // Long-press → precise editor (mobile-friendly).
    const startLong = () => {
      longPressTimer = setTimeout(() => {
        didLongPress = true;
        openPreciseEditor(s, d, cell);
      }, 500);
    };
    const cancelLong = () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    };
    cell.addEventListener('pointerdown', startLong);
    cell.addEventListener('pointerup',     cancelLong);
    cell.addEventListener('pointerleave',  cancelLong);
    cell.addEventListener('pointercancel', cancelLong);
  }

  function openPreciseEditor(s, d, cellEl) {
    const cur = getCell(s, d);
    const input = prompt(`Matrix s${pad2(s)} → d${pad2(d)}  (range -1..1)`, String(cur));
    if (input == null) return;
    const v = parseFloat(input);
    if (!Number.isFinite(v)) return;
    setCell(s, d, v);
  }

  function openCellMenu(s, d, cellEl, ev) {
    const existing = document.getElementById('mm-cell-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'mm-cell-menu';
    menu.className = 'mm-cell-menu';
    const actions = [
      { label: 'Set +1',   fn: () => setCell(s, d,  1) },
      { label: 'Set +0.5', fn: () => setCell(s, d,  0.5) },
      { label: 'Set 0',    fn: () => setCell(s, d,  0) },
      { label: 'Set -0.5', fn: () => setCell(s, d, -0.5) },
      { label: 'Set -1',   fn: () => setCell(s, d, -1) },
      { label: 'Invert',   fn: () => setCell(s, d, -getCell(s, d)) },
      { label: 'Random',   fn: () => setCell(s, d, (Math.random() * 2) - 1) },
      { label: 'Precise…', fn: () => openPreciseEditor(s, d, cellEl) },
    ];
    for (const a of actions) {
      const b = document.createElement('button');
      b.textContent = a.label;
      b.addEventListener('click', () => { a.fn(); menu.remove(); });
      menu.appendChild(b);
    }

    document.body.appendChild(menu);
    const rect = cellEl.getBoundingClientRect();
    const x = Math.min(window.innerWidth  - 180, rect.left);
    const y = Math.min(window.innerHeight - menu.offsetHeight - 10, rect.bottom + 4);
    menu.style.left = `${x}px`;
    menu.style.top  = `${y}px`;

    // Dismiss on outside click.
    const dismiss = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('pointerdown', dismiss, true);
      }
    };
    setTimeout(() => document.addEventListener('pointerdown', dismiss, true), 0);
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
  // Preset overlay (Phase E)
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
            // Sync Phase C UI state to reflect the preset's sub-engine
            // and counts so the rebuild that follows matches the engine.
            if (preset.state?.subEngine) uiState.subEngine = preset.state.subEngine;
            if (typeof preset.state?.adsrCount === 'number') {
              uiState.adsrCount = preset.state.adsrCount;
            }
            if (typeof preset.state?.lfoCount === 'number') {
              uiState.lfoCount = preset.state.lfoCount;
            }
            saveUIState();
            onStateChange?.(); // trigger a-app saveState -> persists DSP snapshot
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

    // Dismiss on backdrop click
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
    // paramMeta:change listener rebuilds the matrix & list.
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
        // Sync counts (UI persisted → engine). Guard if method missing.
        if (typeof engine.setModSourceCount === 'function') {
          engine.setModSourceCount(uiState.adsrCount, uiState.lfoCount);
        }
        // Re-expose saved sound params.
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
    rebuildMatrixGrid();
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

  // Listen for close button on our drawer so the dock icon state stays synced.
  drawer.closeBtn.addEventListener('click', () => {
    drawer.root.classList.add('hidden');
    dockIcon.classList.remove('active');
  });

  // Dock icon opens/closes our drawer. We piggy-back on the existing
  // wireDock() event delegation — but since our drawer's id is `drawer-modular`
  // and our icon uses `data-drawer="modular"`, wireDock() already handles it.
  // However, wireDock was wired at init time — any new dock-click delegation
  // works because it's attached to #dock via event delegation.

  // Live-update throttle: the MLP can push ~60 Hz of new output vectors, but
  // rewriting ~120 visible DOM cells that often is wasteful. Cap to ~20 fps.
  const LIVE_UPDATE_INTERVAL_MS = 50;
  let _lastLiveUpdate = 0;

  /**
   * Called from the inference loop with the MLP output vector (normalized
   * [0,1]). Updates visible matrix cell DOM to reflect live values without
   * touching the engine (engine.setParam is already being called on the
   * same tick by routeOutputs).
   */
  function updateLive(outputs) {
    if (!isVisible()) return;
    if (!outputs || outputs.length === 0) return;
    const engine = getEngine?.();
    if (!engine || engine.id !== 'modular') return;
    if (matrixIndexCache.size === 0) return;

    const now = performance.now();
    if (now - _lastLiveUpdate < LIVE_UPDATE_INTERVAL_MS) return;
    _lastLiveUpdate = now;

    const meta = engine.paramMeta;
    const adsrN = uiState.adsrCount;
    const lfoN  = uiState.lfoCount;
    const nVisibleSources = adsrN + lfoN;

    for (const [key, idx] of matrixIndexCache.entries()) {
      // Only update cells whose source is currently visible.
      const barIdx = key.indexOf('|');
      const s = +key.slice(0, barIdx);
      if (s >= 16) {
        // LFO: sources 16..47 map to LFO slots 0..31
        if ((s - 16) >= lfoN) continue;
      } else if (s >= adsrN) {
        continue;
      }
      const m = meta[idx];
      if (!m) continue;
      const norm = outputs[idx];
      if (norm == null) continue;
      const raw = m.min + norm * (m.max - m.min);
      cellValues.set(key, raw);
      updateCellDOM(+key.slice(0, barIdx), +key.slice(barIdx + 1), raw);
    }
  }

  return {
    teardown,
    refresh,
    show,
    hide,
    isVisible,
    updateLive,
    /** Exposed for testability. */
    _debug: {
      getCell,
      setCell,
      cycleCell,
      uiState: () => ({ ...uiState }),
    },
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

  function buildMatrixSection(body, refs, handlers) {
    const section = el('div', 'mm-section mm-matrix-section');
    const header = el('div', 'mm-section-header', 'Matrix');
    // Phase E: the tap-vs-drag mode toggle stub was deleted — drag-to-paint
    // is non-goal for Phase E and the button did nothing functional.
    section.appendChild(header);

    const legend = el('div', 'mm-hint',
      'Click to cycle 0 → 0.25 → 0.5 → 0.75 → 1 → 0. ' +
      'Shift-click: zero. Long-press: precise. Right-click: menu (negatives).');
    section.appendChild(legend);

    const scrollWrap = el('div', 'mm-scroll');
    const grid = el('div', 'mm-grid');
    refs.matrixGrid = grid;
    scrollWrap.appendChild(grid);
    section.appendChild(scrollWrap);

    const empty = el('div', 'mm-hint warn', '');
    refs.matrixEmpty = empty;
    section.appendChild(empty);

    body.appendChild(section);
  }

  function buildSoundParamSection(body, refs, onExposeChange) {
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

  // Insert before the help icon if present, else append.
  const helpIcon = dock.querySelector('.dock-icon[data-drawer="help"]');
  const btn = document.createElement('button');
  btn.className = 'dock-icon hidden';
  btn.dataset.drawer = 'modular';
  btn.title = 'Modular mod pool & matrix';
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

    /* Matrix grid */
    .mm-matrix-section {
      /* Allow this section to take extra vertical space */
    }
    .mm-mode-toggle {
      font-size: 0.6rem;
      padding: 2px 6px;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
      border-radius: 4px;
      color: var(--text-dim, #888);
      cursor: pointer;
      touch-action: manipulation;
    }
    .mm-scroll {
      overflow-x: auto;
      overflow-y: auto;
      max-height: 360px;
      border-radius: 4px;
      border: 1px solid var(--glass-border, rgba(255,255,255,0.06));
    }
    .mm-grid {
      display: grid;
      gap: 1px;
      background: rgba(255,255,255,0.05);
      padding: 1px;
      min-width: max-content;
      touch-action: manipulation;
    }
    .mm-corner,
    .mm-col-header,
    .mm-row-header {
      background: #0d0d0d;
      color: var(--text-dim, #888);
      font-size: 0.55rem;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2px 4px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      position: sticky;
      z-index: 2;
    }
    .mm-col-header {
      top: 0;
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      min-height: 48px;
      min-width: 28px;
    }
    .mm-row-header {
      left: 0;
      min-width: 32px;
      font-weight: 500;
    }
    .mm-row-header.mm-src-adsr { color: #ffb070; }
    .mm-row-header.mm-src-lfo  { color: #6bb6ff; }
    .mm-corner {
      top: 0;
      left: 0;
      z-index: 3;
    }
    .mm-cell {
      background: rgba(255,255,255,0.04);
      cursor: pointer;
      font-size: 0.55rem;
      font-variant-numeric: tabular-nums;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 32px;
      min-width: 28px;
      user-select: none;
      color: #fff;
      transition: background 120ms ease;
    }
    .mm-cell:hover:not(.unavailable) {
      outline: 1px solid rgba(255,255,255,0.25);
    }
    .mm-cell.unavailable {
      cursor: not-allowed;
      background: repeating-linear-gradient(
        45deg,
        rgba(255,255,255,0.02),
        rgba(255,255,255,0.02) 4px,
        rgba(255,255,255,0.05) 4px,
        rgba(255,255,255,0.05) 8px
      );
    }

    /* Context menu */
    .mm-cell-menu {
      position: fixed;
      background: #0d0d0d;
      border: 1px solid var(--glass-border, rgba(255,255,255,0.15));
      border-radius: 6px;
      padding: 4px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      z-index: 9999;
      min-width: 140px;
    }
    .mm-cell-menu button {
      background: transparent;
      border: none;
      color: var(--text, #e0e0e0);
      text-align: left;
      padding: 6px 10px;
      font-size: 0.7rem;
      border-radius: 4px;
      cursor: pointer;
      touch-action: manipulation;
    }
    .mm-cell-menu button:hover {
      background: var(--accent-dim, rgba(255,106,0,0.25));
      color: var(--accent, #ff6a00);
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

    /* Preset overlay (Phase E) */
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
      .mm-cell { min-width: 26px; min-height: 28px; font-size: 0.5rem; }
      .mm-scroll { max-height: 300px; }
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
  // "1_Oscillators" → "Oscillators"
  return group.replace(/^\d+_/, '').replace(/_/g, ' ');
}

function shortDest(name) {
  // Truncate long destination names for column headers.
  if (name.length <= 10) return name;
  return name.slice(0, 9) + '…';
}
