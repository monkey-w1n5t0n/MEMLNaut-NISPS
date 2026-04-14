/**
 * patch-bay-modal.js — Full-viewport Patch Bay (48×10 modulation matrix)
 *
 * Replaces the cramped matrix grid in `modular-ui.js` with a spacious,
 * modal-based editor covering the entire viewport. Rows are mod sources
 * (ADSR1..16 then LFO1..32 = 48), columns are sub-engine-aware
 * destinations (10 for all current sub-engines).
 *
 * Each cell exposes:
 *   - A mute toggle (default: muted — matrix cells default off per schema)
 *   - A depth slider (normalised [0,1], 0.5 = no modulation; matrix safe
 *     range is bipolar [-0.9,+0.9])
 *   - Right-click / long-press → quick set values and a precise editor
 *
 * Live feedback: when the MLP drives exposed matrix cells, each cell shows
 * a coloured bar overlay mirroring the current routed value (throttled to
 * ~20 fps, matching modular-ui.js).
 *
 * Engine wiring: all writes go through `engine.setMatrixCell(s, d, norm01)`
 * (meml-4bin / F3), which respects the modular-param-meta safe range.
 * When the caller passes a `preset` object, `preset.matrix[cellKey]` is
 * kept in sync so preset export/save reflects the live patch.
 *
 * Sub-engine-aware destinations: column labels are resolved from
 * `engine.destNames` (populated per sub-engine). Only d00 (pitch), d08
 * (amp), d09 (pan) are stable across sub-engines (see
 * `faust/MODULAR_DESTINATIONS.md`).
 *
 * Mobile fallback: under 480px viewport width the grid becomes
 * horizontally scrollable rather than shrinking cells below a usable size.
 *
 * Public API:
 *   createPatchBay({ engine, preset, onChange }) → { open, close, isOpen,
 *                                                     updateLive, refresh,
 *                                                     setEngine, setPreset,
 *                                                     teardown }
 *   openPatchBay()  — opens the singleton (after createPatchBay has run)
 *   closePatchBay() — closes the singleton
 *
 * @module patch-bay-modal
 */

const MAX_ADSR = 16;
const MAX_LFO  = 32;
const N_SOURCES = MAX_ADSR + MAX_LFO; // 48

const LIVE_UPDATE_INTERVAL_MS = 50; // ~20 fps, matches modular-ui

const pad2 = (n) => String(n).padStart(2, '0');

/** Cell key used in preset.matrix[...]: 'sNN_dNN' */
function cellKey(s, d) { return `s${pad2(s)}_d${pad2(d)}`; }

// ---------------------------------------------------------------------------
// Singleton handle — so openPatchBay() / closePatchBay() can be called as
// bare module functions (e.g. from a keyboard shortcut in meml-coh8).
// ---------------------------------------------------------------------------

let _singleton = null;

export function openPatchBay()  { _singleton?.open();  }
export function closePatchBay() { _singleton?.close(); }

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Patch Bay modal instance bound to an engine + (optional) preset.
 *
 * @param {object}   opts
 * @param {object}   opts.engine     — ModularEngine (must expose
 *                                     `setMatrixCell`, `destNames`,
 *                                     `paramMeta`, `_labelToWalk`,
 *                                     `_lastRawByLabel`).
 * @param {object}  [opts.preset]    — Unified-schema preset. When supplied,
 *                                     writes mutate `preset.matrix[cellKey]`
 *                                     in place.
 * @param {Function}[opts.onChange]  — Called after any cell mutation with
 *                                     `({ s, d, norm01, muted })`. Host
 *                                     typically calls saveState().
 * @returns {object}
 */
export function createPatchBay({ engine, preset, onChange } = {}) {
  injectStyles();

  let _engine = engine || null;
  let _preset = preset || null;
  let _onChange = typeof onChange === 'function' ? onChange : () => {};

  // Cell state keyed by 'sNN_dNN' → { norm01, muted }. norm01 is the
  // normalised [0,1] value passed to setMatrixCell (0.5 = no modulation).
  const cellState = new Map();

  // DOM refs
  const root = document.createElement('div');
  root.className = 'pb-root hidden';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="pb-backdrop"></div>
    <div class="pb-modal" role="dialog" aria-label="Patch Bay — modulation matrix">
      <div class="pb-header">
        <div class="pb-title">Patch Bay</div>
        <div class="pb-subtitle" data-pb-subtitle></div>
        <div class="pb-spacer"></div>
        <button class="pb-btn pb-clear" title="Mute every cell (set to raw 0)">Clear</button>
        <button class="pb-btn pb-close" title="Close (M)" aria-label="Close">×</button>
      </div>
      <div class="pb-scroll">
        <div class="pb-grid" data-pb-grid></div>
      </div>
      <div class="pb-footer">
        <span class="pb-legend">Rows: A1–A16 (ADSR) · L1–L32 (LFO)</span>
        <span class="pb-legend pb-legend-r">Columns: engine-specific destinations (d00 pitch, d08 amp, d09 pan stable across engines)</span>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const gridEl     = root.querySelector('[data-pb-grid]');
  const subtitleEl = root.querySelector('[data-pb-subtitle]');
  const closeBtn   = root.querySelector('.pb-close');
  const clearBtn   = root.querySelector('.pb-clear');
  const backdrop   = root.querySelector('.pb-backdrop');

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  clearBtn.addEventListener('click', clearAllCells);

  // Esc closes
  const onKey = (e) => {
    if (root.classList.contains('hidden')) return;
    if (e.key === 'Escape') { close(); e.stopPropagation(); }
  };
  document.addEventListener('keydown', onKey);

  // Throttled live update
  let _lastLive = 0;
  let _matrixIndex = new Map(); // 's|d' → paramMeta index

  // ---------------------------------------------------------------------------
  // Matrix paramMeta index (mirrors modular-ui.js buildMatrixIndex)
  // ---------------------------------------------------------------------------

  function rebuildMatrixIndex() {
    _matrixIndex = new Map();
    if (!_engine) return;
    const meta = _engine.paramMeta ?? [];
    for (let i = 0; i < meta.length; i++) {
      const m = meta[i];
      if (!m || !m.group || !m.group.startsWith('Matrix/')) continue;
      const match = (m.label || '').match(/s(\d{2})_d(\d{2})_/);
      if (!match) continue;
      const s = parseInt(match[1], 10);
      const d = parseInt(match[2], 10);
      _matrixIndex.set(`${s}|${d}`, i);
    }
  }

  // ---------------------------------------------------------------------------
  // Read current values from engine + preset into cellState
  // ---------------------------------------------------------------------------

  function syncFromEngine() {
    cellState.clear();
    if (!_engine) return;
    const destNames = _engine.destNames || [];
    const lastRaw = _engine._lastRawByLabel || new Map();
    const walk    = _engine._labelToWalk;

    for (let d = 0; d < destNames.length; d++) {
      const destName = destNames[d];
      for (let s = 0; s < N_SOURCES; s++) {
        const key = cellKey(s, d);
        const label = `MM_Matrix/s${pad2(s)}_d${pad2(d)}_${destName}`;
        // Default: muted (matrix cells default off per unified schema)
        let muted = true;
        let norm01 = 0.5; // raw 0

        // Preset wins if present
        if (_preset?.matrix && _preset.matrix[key]) {
          const mc = _preset.matrix[key];
          muted = !!mc.muted;
          if (typeof mc.fixedValue === 'number' && muted) {
            // fixedValue on muted matrix cell is ignored per schema
          }
        }

        // Engine lastRaw overrides if present AND not muted. Use raw to
        // reconstruct a reasonable norm01 (bipolar [-1,+1] → [0,1] uniform).
        if (walk && walk.has(label)) {
          const raw = lastRaw.has(label) ? lastRaw.get(label) : walk.get(label).init;
          if (!muted && typeof raw === 'number') {
            // Map raw [-1,+1] (safe [-0.9,+0.9]) to norm01 [0,1].
            // setMatrixCell uses normToRaw(label, norm01) with safeMin=-0.9
            // safeMax=+0.9 linear → raw = -0.9 + norm01*1.8. Invert.
            norm01 = Math.max(0, Math.min(1, (raw + 0.9) / 1.8));
          }
        }

        cellState.set(key, { muted, norm01 });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // DOM build
  // ---------------------------------------------------------------------------

  function buildGrid() {
    gridEl.innerHTML = '';
    if (!_engine) {
      gridEl.textContent = 'Modular engine not active.';
      return;
    }
    const destNames = _engine.destNames || [];
    const cols = destNames.length;
    if (cols === 0) {
      gridEl.textContent = 'Waiting for sub-engine…';
      return;
    }

    subtitleEl.textContent = `${_engine.activeSubEngineId || 'modular'} — 48 sources × ${cols} destinations`;

    gridEl.style.gridTemplateColumns = `72px repeat(${cols}, minmax(80px, 1fr))`;

    // Top-left corner
    const corner = document.createElement('div');
    corner.className = 'pb-corner';
    corner.textContent = 'src\\dst';
    gridEl.appendChild(corner);

    // Col headers
    destNames.forEach((name, d) => {
      const h = document.createElement('div');
      h.className = 'pb-col-header';
      h.innerHTML = `<span class="pb-d">d${pad2(d)}</span><span class="pb-dn">${name}</span>`;
      h.title = `d${pad2(d)} — ${name}`;
      gridEl.appendChild(h);
    });

    // Rows
    for (let s = 0; s < N_SOURCES; s++) {
      const isADSR = s < MAX_ADSR;
      const label = isADSR ? `A${s + 1}` : `L${s - MAX_ADSR + 1}`;
      const longLabel = isADSR ? `ADSR ${s + 1}` : `LFO ${s - MAX_ADSR + 1}`;

      const rh = document.createElement('div');
      rh.className = `pb-row-header pb-src-${isADSR ? 'adsr' : 'lfo'}`;
      rh.textContent = label;
      rh.title = longLabel;
      gridEl.appendChild(rh);

      for (let d = 0; d < cols; d++) {
        gridEl.appendChild(buildCell(s, d));
      }
    }
  }

  function buildCell(s, d) {
    const key = cellKey(s, d);
    const cell = document.createElement('div');
    cell.className = 'pb-cell';
    cell.dataset.key = key;
    cell.dataset.s = s;
    cell.dataset.d = d;

    const muteBtn = document.createElement('button');
    muteBtn.type = 'button';
    muteBtn.className = 'pb-mute';
    muteBtn.title = 'Mute / unmute';
    muteBtn.textContent = 'M';
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const st = cellState.get(key) || { muted: true, norm01: 0.5 };
      toggleMute(s, d, !st.muted);
    });

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'pb-slider';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.001';
    slider.value = '0.5';
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      if (!Number.isFinite(v)) return;
      writeCell(s, d, v, /*unmute*/ true);
    });

    const live = document.createElement('div');
    live.className = 'pb-live';

    const valueText = document.createElement('div');
    valueText.className = 'pb-value';
    valueText.textContent = '·';

    cell.appendChild(muteBtn);
    cell.appendChild(slider);
    cell.appendChild(live);
    cell.appendChild(valueText);

    // Right-click / long-press → context menu
    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openCellMenu(s, d, cell, e);
    });
    let longTimer = null;
    cell.addEventListener('pointerdown', (e) => {
      if (e.target !== cell && !e.target.classList.contains('pb-live') &&
          !e.target.classList.contains('pb-value')) return;
      longTimer = setTimeout(() => {
        openCellMenu(s, d, cell, e);
      }, 500);
    });
    const cancelLong = () => { if (longTimer) { clearTimeout(longTimer); longTimer = null; } };
    cell.addEventListener('pointerup', cancelLong);
    cell.addEventListener('pointercancel', cancelLong);
    cell.addEventListener('pointerleave', cancelLong);

    // Initial paint
    paintCell(s, d);
    return cell;
  }

  function cellEl(s, d) {
    return gridEl.querySelector(`.pb-cell[data-key="${cellKey(s, d)}"]`);
  }

  function paintCell(s, d) {
    const el = cellEl(s, d);
    if (!el) return;
    const st = cellState.get(cellKey(s, d)) || { muted: true, norm01: 0.5 };
    el.classList.toggle('muted', !!st.muted);
    const slider = el.querySelector('.pb-slider');
    if (slider && document.activeElement !== slider) {
      slider.value = String(st.norm01);
    }
    if (slider) slider.disabled = !!st.muted;

    const muteBtn = el.querySelector('.pb-mute');
    if (muteBtn) muteBtn.classList.toggle('on', !st.muted);

    // Display value as signed bipolar (−1..+1) for legibility.
    const bipolar = st.muted ? 0 : (st.norm01 * 2 - 1);
    const valueText = el.querySelector('.pb-value');
    if (valueText) {
      valueText.textContent = st.muted
        ? '—'
        : (bipolar === 0 ? '0' : (bipolar > 0 ? '+' : '') + bipolar.toFixed(2));
    }
    // Live fill is updated by updateLive(); reset to configured amount
    // so a non-inferring UI still shows something.
    paintLive(s, d, bipolar);
  }

  function paintLive(s, d, bipolar /* -1..+1 */) {
    const el = cellEl(s, d);
    if (!el) return;
    const live = el.querySelector('.pb-live');
    if (!live) return;
    const abs = Math.min(1, Math.abs(bipolar));
    const color = bipolar >= 0
      ? `rgba(255, 106, 0, ${abs * 0.85})`
      : `rgba(80, 160, 255, ${abs * 0.85})`;
    live.style.width = `${Math.round(abs * 100)}%`;
    live.style.background = abs > 0.005 ? color : 'transparent';
    live.style.left = bipolar >= 0 ? '50%' : `${50 - abs * 50}%`;
  }

  // ---------------------------------------------------------------------------
  // Mutators
  // ---------------------------------------------------------------------------

  /** Write cell through engine + preset. */
  function writeCell(s, d, norm01, unmute = false) {
    const key = cellKey(s, d);
    const prev = cellState.get(key) || { muted: true, norm01: 0.5 };
    const next = {
      muted:  unmute ? false : prev.muted,
      norm01: Math.max(0, Math.min(1, norm01)),
    };
    cellState.set(key, next);

    // Engine: if muted, always write raw 0 (norm01=0.5). Otherwise the slider value.
    if (_engine && typeof _engine.setMatrixCell === 'function') {
      const engineNorm = next.muted ? 0.5 : next.norm01;
      _engine.setMatrixCell(s, d, engineNorm);
    }

    // Preset.matrix sync (if preset supplied)
    if (_preset) {
      if (!_preset.matrix) _preset.matrix = {};
      const cur = _preset.matrix[key] || {};
      _preset.matrix[key] = {
        muted: next.muted,
        min:   typeof cur.min === 'number' ? cur.min : 0,
        max:   typeof cur.max === 'number' ? cur.max : 1,
        curve: typeof cur.curve === 'number' ? cur.curve : 0.5,
      };
    }

    paintCell(s, d);
    try { _onChange({ s, d, norm01: next.norm01, muted: next.muted }); }
    catch (err) { console.warn('[patch-bay] onChange threw', err); }
  }

  function toggleMute(s, d, muted) {
    const key = cellKey(s, d);
    const prev = cellState.get(key) || { muted: true, norm01: 0.5 };
    const next = { muted: !!muted, norm01: prev.norm01 };
    cellState.set(key, next);

    if (_engine && typeof _engine.setMatrixCell === 'function') {
      // muted → raw 0, unmuted → replay stored norm01
      _engine.setMatrixCell(s, d, next.muted ? 0.5 : next.norm01);
    }
    if (_preset) {
      if (!_preset.matrix) _preset.matrix = {};
      const cur = _preset.matrix[key] || {};
      _preset.matrix[key] = {
        muted: next.muted,
        min:   typeof cur.min === 'number' ? cur.min : 0,
        max:   typeof cur.max === 'number' ? cur.max : 1,
        curve: typeof cur.curve === 'number' ? cur.curve : 0.5,
      };
    }
    paintCell(s, d);
    try { _onChange({ s, d, norm01: next.norm01, muted: next.muted }); }
    catch (err) { console.warn('[patch-bay] onChange threw', err); }
  }

  function clearAllCells() {
    const destNames = _engine?.destNames || [];
    for (let d = 0; d < destNames.length; d++) {
      for (let s = 0; s < N_SOURCES; s++) {
        toggleMute(s, d, true);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Cell context menu (quick set + precise editor)
  // ---------------------------------------------------------------------------

  function openCellMenu(s, d, anchorEl, ev) {
    const existing = document.getElementById('pb-cell-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'pb-cell-menu';
    menu.className = 'pb-cell-menu';
    const actions = [
      { label: 'Unmute + set +1',   fn: () => writeCell(s, d, 1.0,  true) },
      { label: 'Unmute + set +0.5', fn: () => writeCell(s, d, 0.75, true) },
      { label: 'Unmute + set 0',    fn: () => writeCell(s, d, 0.5,  true) },
      { label: 'Unmute + set −0.5', fn: () => writeCell(s, d, 0.25, true) },
      { label: 'Unmute + set −1',   fn: () => writeCell(s, d, 0.0,  true) },
      { label: 'Mute (raw 0)',      fn: () => toggleMute(s, d, true) },
      { label: 'Precise…',           fn: () => {
        const st = cellState.get(cellKey(s, d)) || { norm01: 0.5 };
        const bipolar = st.norm01 * 2 - 1;
        const input = prompt(`s${pad2(s)} → d${pad2(d)} (−1..+1)`, String(bipolar));
        if (input == null) return;
        const v = parseFloat(input);
        if (!Number.isFinite(v)) return;
        const norm = Math.max(0, Math.min(1, (v + 1) / 2));
        writeCell(s, d, norm, true);
      } },
    ];
    for (const a of actions) {
      const b = document.createElement('button');
      b.textContent = a.label;
      b.addEventListener('click', () => { a.fn(); menu.remove(); });
      menu.appendChild(b);
    }

    document.body.appendChild(menu);
    const rect = anchorEl.getBoundingClientRect();
    const x = Math.min(window.innerWidth  - 200, (ev?.clientX ?? rect.left));
    const y = Math.min(window.innerHeight - menu.offsetHeight - 10, (ev?.clientY ?? rect.bottom + 4));
    menu.style.left = `${x}px`;
    menu.style.top  = `${y}px`;

    const dismiss = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('pointerdown', dismiss, true);
      }
    };
    setTimeout(() => document.addEventListener('pointerdown', dismiss, true), 0);
  }

  // ---------------------------------------------------------------------------
  // Live MLP output mirroring (called from a-app.js inference loop)
  // ---------------------------------------------------------------------------

  function updateLive(outputs) {
    if (root.classList.contains('hidden')) return;
    if (!outputs || outputs.length === 0) return;
    if (_matrixIndex.size === 0) return;

    const now = performance.now();
    if (now - _lastLive < LIVE_UPDATE_INTERVAL_MS) return;
    _lastLive = now;

    const meta = _engine?.paramMeta ?? [];
    for (const [key, idx] of _matrixIndex.entries()) {
      const m = meta[idx];
      if (!m) continue;
      const norm = outputs[idx];
      if (norm == null) continue;
      const raw = m.min + norm * (m.max - m.min);
      const bipolar = Math.max(-1, Math.min(1, raw));
      const barIdx = key.indexOf('|');
      const s = +key.slice(0, barIdx);
      const d = +key.slice(barIdx + 1);
      paintLive(s, d, bipolar);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  function open() {
    refresh();
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
  }

  function close() {
    root.classList.add('hidden');
    root.setAttribute('aria-hidden', 'true');
    const menu = document.getElementById('pb-cell-menu');
    if (menu) menu.remove();
  }

  function isOpen() {
    return !root.classList.contains('hidden');
  }

  function refresh() {
    rebuildMatrixIndex();
    syncFromEngine();
    buildGrid();
  }

  function setEngine(engine) { _engine = engine || null; if (isOpen()) refresh(); }
  function setPreset(preset) { _preset = preset || null; if (isOpen()) refresh(); }

  function teardown() {
    document.removeEventListener('keydown', onKey);
    root.remove();
    if (_singleton && _singleton.root === root) _singleton = null;
  }

  const api = {
    open, close, isOpen, updateLive, refresh,
    setEngine, setPreset, teardown, root,
  };
  _singleton = api;
  return api;
}

// ---------------------------------------------------------------------------
// Styles (injected once)
// ---------------------------------------------------------------------------

function injectStyles() {
  if (document.getElementById('patch-bay-styles')) return;
  const s = document.createElement('style');
  s.id = 'patch-bay-styles';
  s.textContent = `
.pb-root { position: fixed; inset: 0; z-index: 9500; font-family: inherit; color: #f3f3f3; }
.pb-root.hidden { display: none; }
.pb-backdrop { position: absolute; inset: 0; background: rgba(8, 8, 10, 0.78); backdrop-filter: blur(4px); }
.pb-modal {
  position: absolute; inset: 24px; background: #161618;
  border: 1px solid #2a2a2e; border-radius: 10px;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 10px 40px rgba(0,0,0,0.6);
}
.pb-header {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; border-bottom: 1px solid #2a2a2e; background: #1c1c1f;
}
.pb-title { font-size: 14px; font-weight: 600; letter-spacing: 0.02em; }
.pb-subtitle { font-size: 12px; color: #9aa; }
.pb-spacer { flex: 1; }
.pb-btn {
  background: #2a2a2e; border: 1px solid #3a3a3e; color: #eee;
  border-radius: 6px; padding: 4px 12px; cursor: pointer; font: inherit; font-size: 12px;
}
.pb-btn:hover { background: #34343a; }
.pb-close { padding: 2px 10px; font-size: 18px; line-height: 1; }
.pb-scroll { flex: 1; overflow: auto; padding: 10px; }
.pb-grid {
  display: grid; gap: 2px; min-width: max-content;
  font-size: 11px;
}
.pb-corner {
  position: sticky; top: 0; left: 0; z-index: 3;
  background: #1c1c1f; color: #777;
  padding: 6px 8px; font-size: 10px; text-align: center;
  border-bottom: 1px solid #2a2a2e;
}
.pb-col-header {
  position: sticky; top: 0; z-index: 2;
  background: #1c1c1f; padding: 6px 8px; text-align: center;
  display: flex; flex-direction: column; gap: 2px;
  border-bottom: 1px solid #2a2a2e;
}
.pb-col-header .pb-d { color: #666; font-size: 9px; }
.pb-col-header .pb-dn { color: #eee; font-size: 11px; text-transform: lowercase; word-break: break-word; }
.pb-row-header {
  position: sticky; left: 0; z-index: 1;
  background: #1c1c1f; padding: 6px 8px;
  display: flex; align-items: center; justify-content: center;
  font-weight: 600; font-size: 11px;
  border-right: 1px solid #2a2a2e;
}
.pb-src-adsr { color: #ff8f4a; }
.pb-src-lfo  { color: #6fb3ff; }

.pb-cell {
  position: relative;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.04);
  border-radius: 4px;
  padding: 4px 4px 2px;
  display: grid; grid-template-columns: 18px 1fr;
  grid-template-rows: auto auto;
  gap: 2px 4px; align-items: center;
  min-height: 40px;
}
.pb-cell.muted { opacity: 0.55; }
.pb-mute {
  grid-row: 1 / span 2; grid-column: 1;
  width: 18px; height: 18px; border-radius: 3px; padding: 0;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  color: #888; font-size: 10px; font-weight: 700; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.pb-mute.on { background: #ff6a00; color: #fff; border-color: #ff6a00; }
.pb-slider {
  grid-row: 1; grid-column: 2;
  width: 100%; margin: 0;
}
.pb-slider:disabled { opacity: 0.4; }
.pb-value {
  grid-row: 2; grid-column: 2;
  font-size: 10px; color: #aaa; text-align: right;
  font-variant-numeric: tabular-nums;
}
.pb-live {
  position: absolute; bottom: 1px; height: 2px;
  left: 50%; width: 0; background: transparent;
  transition: width 80ms linear, background 80ms linear, left 80ms linear;
  pointer-events: none;
}
.pb-footer {
  display: flex; gap: 12px; padding: 6px 16px;
  border-top: 1px solid #2a2a2e; background: #1a1a1d;
  font-size: 10px; color: #888;
}
.pb-legend-r { margin-left: auto; }

.pb-cell-menu {
  position: fixed; z-index: 9999;
  background: #1c1c1f; border: 1px solid #3a3a3e; border-radius: 6px;
  padding: 4px; display: flex; flex-direction: column; min-width: 180px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.6);
}
.pb-cell-menu button {
  background: transparent; color: #eee; border: 0; padding: 6px 8px;
  text-align: left; cursor: pointer; border-radius: 4px; font: inherit; font-size: 12px;
}
.pb-cell-menu button:hover { background: #2a2a30; }

@media (max-width: 480px) {
  .pb-modal { inset: 0; border-radius: 0; }
  .pb-cell { min-height: 36px; }
  .pb-scroll { padding: 4px; }
  .pb-grid { font-size: 10px; }
  /* Horizontal scroll remains (grid already overflows); row headers stay sticky. */
}
`;
  document.head.appendChild(s);
}
