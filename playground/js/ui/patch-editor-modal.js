/**
 * patch-editor-modal.js — Full-viewport Patch Editor (card-per-group)
 *
 * meml-n3uh. Three semantic columns (Sound | Modulation | Routing) each
 * independently scrollable. Every paramMeta group becomes a card with:
 *   - humanName + `X / Y exposed` count (non-bypassed / total)
 *   - group mute toggle (mutes all params in the group)
 *   - group curve slider (binds to preset's `groupCurves[groupName]`)
 *   - expand caret for per-param rows (bypass, mute, min/max range,
 *     curve, fixedValue)
 *
 * Routing column special case: on the modular engine, the matrix group
 * (`Matrix` / `Matrix/<dest>`) is rendered as a single synthetic "Open
 * Patch Bay" card that launches the existing full-viewport Patch Bay
 * modal (`patch-bay-modal.js`). Per-destination cards are suppressed so
 * we don't overwhelm the Routing column with 48×10 cells. On the C15
 * engine, Feedback Mixer renders as a normal group card.
 *
 * API (singleton pattern, mirrors patch-bay-modal.js):
 *
 *   createPatchEditor({ engine, preset, sectionView, onChange })
 *     → { open, close, isOpen, refresh, setContext, teardown }
 *   openPatchEditor()  — opens the singleton (after createPatchEditor has run)
 *   closePatchEditor() — closes the singleton
 *
 * `sectionView` is a function: (sectionIndex) → view-shape (see
 * a-app.js:getSectionView). The modal calls it once per section and
 * writes back via the view's mutators + the engine's setters. `onChange`
 * is called after every mutation so the host can re-route outputs and
 * persist state.
 *
 * Mobile (<480px): columns collapse to a single vertically-scrolling
 * stack (per docs/unified-preset-schema.md § Mobile layout).
 *
 * @module patch-editor-modal
 */

import { openPatchBay } from './patch-bay-modal.js';

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _singleton = null;

export function openPatchEditor()  { _singleton?.open();  }
export function closePatchEditor() { _singleton?.close(); }

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @param {object}   opts
 * @param {object}  [opts.engine]        active SynthEngine (has paramMeta, id, setParam)
 * @param {object}  [opts.preset]        active unified-schema preset (groupCurves)
 * @param {Function}[opts.sectionView]   (sectionIndex) → section view (a-app.js:getSectionView)
 * @param {Function}[opts.sectionCount]  () → number of sections
 * @param {Function}[opts.onChange]      called after any mutation: () => void
 */
export function createPatchEditor({ engine, preset, sectionView, sectionCount, onChange } = {}) {
  injectStyles();

  let _engine    = engine || null;
  let _preset    = preset || null;
  let _viewFn    = typeof sectionView  === 'function' ? sectionView  : () => null;
  let _countFn   = typeof sectionCount === 'function' ? sectionCount : () => 0;
  let _onChange  = typeof onChange     === 'function' ? onChange     : () => {};

  // Track expand-state per group name so re-renders preserve it.
  const _expanded = new Set();

  // DOM
  const root = document.createElement('div');
  root.className = 'pe-root hidden';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="pe-backdrop"></div>
    <div class="pe-modal" role="dialog" aria-label="Patch Editor">
      <div class="pe-header">
        <div class="pe-title">Patch Editor</div>
        <div class="pe-subtitle" data-pe-subtitle></div>
        <div class="pe-spacer"></div>
        <button class="pe-btn pe-close" title="Close (Esc)" aria-label="Close">×</button>
      </div>
      <div class="pe-columns">
        <div class="pe-col" data-col="Sound">
          <div class="pe-col-header">Sound</div>
          <div class="pe-col-body" data-col-body="Sound"></div>
        </div>
        <div class="pe-col" data-col="Modulation">
          <div class="pe-col-header">Modulation</div>
          <div class="pe-col-body" data-col-body="Modulation"></div>
        </div>
        <div class="pe-col" data-col="Routing">
          <div class="pe-col-header">Routing</div>
          <div class="pe-col-body" data-col-body="Routing"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const subtitleEl = root.querySelector('[data-pe-subtitle]');
  const closeBtn   = root.querySelector('.pe-close');
  const backdrop   = root.querySelector('.pe-backdrop');
  const colBodies  = {
    Sound:      root.querySelector('[data-col-body="Sound"]'),
    Modulation: root.querySelector('[data-col-body="Modulation"]'),
    Routing:    root.querySelector('[data-col-body="Routing"]'),
  };

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);

  const onKey = (e) => {
    if (root.classList.contains('hidden')) return;
    if (e.key === 'Escape') { close(); e.stopPropagation(); }
  };
  document.addEventListener('keydown', onKey);

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  function build() {
    Object.values(colBodies).forEach(el => { el.innerHTML = ''; });

    if (!_engine) {
      for (const col of Object.values(colBodies)) {
        col.innerHTML = '<div class="pe-empty">No engine active.</div>';
      }
      subtitleEl.textContent = '';
      return;
    }

    subtitleEl.textContent = `${_engine.displayName || _engine.id || 'engine'}`;

    const n = _countFn() | 0;
    const isModular = _engine.id === 'modular';
    let matrixSeen = false; // collapse all Matrix/* groups into one Patch Bay card

    for (let si = 0; si < n; si++) {
      const view = _viewFn(si);
      if (!view) continue;
      const col = colBodies[view.column] || colBodies.Sound;

      // Modular Matrix special case: render a single "Open Patch Bay"
      // card in Routing, regardless of how many Matrix/<dest> sections
      // the paramMeta exposes.
      if (isModular && view.name && view.name.startsWith('Matrix')) {
        if (matrixSeen) continue;
        matrixSeen = true;
        colBodies.Routing.appendChild(buildPatchBayCard());
        continue;
      }

      col.appendChild(buildGroupCard(si, view));
    }

    // Empty-column placeholders
    for (const [colName, el] of Object.entries(colBodies)) {
      if (!el.children.length) {
        el.innerHTML = `<div class="pe-empty">No ${colName.toLowerCase()} groups.</div>`;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Synthetic "Open Patch Bay" card (modular / Routing only)
  // ---------------------------------------------------------------------------

  function buildPatchBayCard() {
    const card = document.createElement('div');
    card.className = 'pe-card pe-card-patchbay';
    card.innerHTML = `
      <div class="pe-card-header">
        <div class="pe-card-title">Modulation Matrix</div>
        <div class="pe-card-sub">48 sources × per-sub-engine destinations</div>
      </div>
      <button class="pe-btn pe-btn-primary pe-patchbay-open">Open Patch Bay</button>
      <div class="pe-card-foot">Full-viewport editor with live MLP feedback.</div>
    `;
    card.querySelector('.pe-patchbay-open').addEventListener('click', () => {
      // Close the editor first so the Patch Bay isn't stacked underneath.
      close();
      openPatchBay();
    });
    return card;
  }

  // ---------------------------------------------------------------------------
  // Group card
  // ---------------------------------------------------------------------------

  function buildGroupCard(si, view) {
    const card = document.createElement('div');
    card.className = 'pe-card';
    card.dataset.group = view.name;

    // Count exposed (non-bypassed) params
    let exposed = 0;
    const total = view.count | 0;
    for (let li = 0; li < total; li++) {
      const pov = view.getParamOverride(li);
      if (!pov) continue;
      if (!pov.bypassed) exposed++;
    }

    const isExpanded = _expanded.has(view.name);

    const header = document.createElement('div');
    header.className = 'pe-card-header';
    header.innerHTML = `
      <div class="pe-card-title" style="color:${view.color || '#eee'}">${escapeHtml(view.name)}</div>
      <div class="pe-card-sub">${exposed} / ${total} exposed</div>
      <button class="pe-caret ${isExpanded ? 'open' : ''}" aria-label="Expand group">▸</button>
    `;

    // Group controls row: mute-all + group curve
    const controls = document.createElement('div');
    controls.className = 'pe-card-controls';

    // Mute-all toggle
    const muteAllBtn = document.createElement('button');
    muteAllBtn.type = 'button';
    muteAllBtn.className = 'pe-btn pe-btn-small pe-mute-all';
    const allMuted = () => {
      for (let li = 0; li < total; li++) {
        const pov = view.getParamOverride(li);
        if (pov && !pov.bypassed && !pov.muted) return false;
      }
      return true;
    };
    const paintMuteAll = () => {
      const on = allMuted();
      muteAllBtn.textContent = on ? 'Unmute group' : 'Mute group';
      muteAllBtn.classList.toggle('on', on);
    };
    muteAllBtn.addEventListener('click', () => {
      const target = !allMuted(); // if all muted → unmute; else → mute all
      for (let li = 0; li < total; li++) {
        const pov = view.getParamOverride(li);
        if (!pov || pov.bypassed) continue;
        pov.muted = target;
      }
      paintMuteAll();
      // Repaint per-param rows if expanded
      const body = card.querySelector('.pe-card-body');
      if (body) renderParamRows(body, view);
      emitChange();
    });
    paintMuteAll();

    // Group curve slider (binds to preset.groupCurves[name] if a preset is
    // present; otherwise goes through view.setCurve).
    const curveWrap = document.createElement('label');
    curveWrap.className = 'pe-group-curve';
    curveWrap.innerHTML = `
      <span>Curve</span>
      <input type="range" min="0" max="1" step="0.01" />
      <span class="pe-val" data-pe-curve-val></span>
    `;
    const curveSlider = curveWrap.querySelector('input');
    const curveValEl  = curveWrap.querySelector('[data-pe-curve-val]');
    const readGroupCurve = () => {
      // Preset binding takes priority so this stays in sync with exports.
      if (_preset && _preset.groupCurves && typeof _preset.groupCurves[view.name] === 'number') {
        return _preset.groupCurves[view.name];
      }
      return typeof view.getCurve === 'function' ? view.getCurve() : 0.5;
    };
    const writeGroupCurve = (v) => {
      if (typeof view.setCurve === 'function') view.setCurve(v);
      if (_preset) {
        if (!_preset.groupCurves) _preset.groupCurves = {};
        _preset.groupCurves[view.name] = v;
      }
    };
    curveSlider.value = String(readGroupCurve());
    curveValEl.textContent = Number(curveSlider.value).toFixed(2);
    curveSlider.addEventListener('input', () => {
      const v = parseFloat(curveSlider.value);
      if (!Number.isFinite(v)) return;
      writeGroupCurve(v);
      curveValEl.textContent = v.toFixed(2);
      emitChange();
    });

    controls.appendChild(muteAllBtn);
    controls.appendChild(curveWrap);

    // Body (per-param rows) — lazy-rendered on first expand
    const body = document.createElement('div');
    body.className = 'pe-card-body';
    if (!isExpanded) body.classList.add('hidden');

    if (isExpanded) renderParamRows(body, view);

    const caret = header.querySelector('.pe-caret');
    caret.addEventListener('click', () => {
      const open = caret.classList.toggle('open');
      body.classList.toggle('hidden', !open);
      if (open) {
        _expanded.add(view.name);
        if (!body.children.length) renderParamRows(body, view);
      } else {
        _expanded.delete(view.name);
      }
    });

    card.appendChild(header);
    card.appendChild(controls);
    card.appendChild(body);
    return card;
  }

  // ---------------------------------------------------------------------------
  // Per-param rows
  //
  // NOTE: the group-drawer in a-app.js (showGroupDrawer) and modular-ui.js
  // both render similar rows with slightly different conventions (C15
  // uses dual-range sliders + curve canvas; modular-ui uses numeric
  // inputs). Extracting a shared `param-row.js` is tempting but the
  // existing renderers are deeply entangled with their drawers' layout
  // + event flows. We duplicate the row markup here with a TODO to unify
  // once all three sites stabilise.
  // ---------------------------------------------------------------------------

  function renderParamRows(body, view) {
    body.innerHTML = '';
    const total = view.count | 0;
    for (let li = 0; li < total; li++) {
      const pov = view.getParamOverride(li);
      if (!pov) continue;
      body.appendChild(buildParamRow(view, li, pov));
    }
  }

  function buildParamRow(view, li, pov) {
    const row = document.createElement('div');
    row.className = 'pe-param-row';
    if (pov.muted)    row.classList.add('muted');
    if (pov.bypassed) row.classList.add('bypassed');

    const nameText = view.getParamName(li) || `p${li}`;

    // Fetch paramMeta for label/humanName (engine-dependent)
    const meta = _engine?.paramMeta?.[view.startIndex + li] || null;
    const humanName = meta?.name || nameText;
    const labelId   = meta?.id || meta?.label || humanName;

    row.innerHTML = `
      <div class="pe-param-name" title="${escapeHtml(labelId)}">${escapeHtml(humanName)}</div>
      <div class="pe-param-flags">
        <button class="pe-flag pe-flag-bypass" title="Bypass (structural — not in MLP)">B</button>
        <button class="pe-flag pe-flag-mute"   title="Mute (runtime — pin at fixedValue)">M</button>
      </div>
      <div class="pe-param-ranges">
        <label class="pe-mini"><span>min</span><input type="range" min="0" max="1" step="0.01" data-pe="min"></label>
        <label class="pe-mini"><span>max</span><input type="range" min="0" max="1" step="0.01" data-pe="max"></label>
        <label class="pe-mini"><span>curve</span><input type="range" min="0" max="1" step="0.01" data-pe="curve"></label>
        <label class="pe-mini"><span>fixed</span><input type="range" min="0" max="1" step="0.01" data-pe="fixed"></label>
      </div>
    `;

    const bBtn  = row.querySelector('.pe-flag-bypass');
    const mBtn  = row.querySelector('.pe-flag-mute');
    const $min   = row.querySelector('[data-pe="min"]');
    const $max   = row.querySelector('[data-pe="max"]');
    const $curve = row.querySelector('[data-pe="curve"]');
    const $fixed = row.querySelector('[data-pe="fixed"]');

    $min.value   = String(pov.min   ?? 0);
    $max.value   = String(pov.max   ?? 1);
    $curve.value = String(pov.curve ?? 0.5);
    $fixed.value = String(pov.fixedValue ?? 0.5);

    const paintFlags = () => {
      bBtn.classList.toggle('on', !!pov.bypassed);
      mBtn.classList.toggle('on', !!pov.muted);
      row.classList.toggle('muted',    !!pov.muted);
      row.classList.toggle('bypassed', !!pov.bypassed);
    };
    paintFlags();

    bBtn.addEventListener('click', () => {
      pov.bypassed = !pov.bypassed;
      paintFlags();
      emitChange();
    });
    mBtn.addEventListener('click', () => {
      pov.muted = !pov.muted;
      paintFlags();
      emitChange();
    });
    $min.addEventListener('input', () => {
      const v = clamp01(parseFloat($min.value));
      pov.min = v;
      if (pov.min > pov.max) { pov.max = v; $max.value = String(v); }
      emitChange();
    });
    $max.addEventListener('input', () => {
      const v = clamp01(parseFloat($max.value));
      pov.max = v;
      if (pov.max < pov.min) { pov.min = v; $min.value = String(v); }
      emitChange();
    });
    $curve.addEventListener('input', () => {
      pov.curve = clamp01(parseFloat($curve.value));
      emitChange();
    });
    $fixed.addEventListener('input', () => {
      pov.fixedValue = clamp01(parseFloat($fixed.value));
      // Live-push fixed value if muted/bypassed so the user hears it
      if ((pov.muted || pov.bypassed) && _engine && typeof _engine.setParam === 'function') {
        try { _engine.setParam(view.startIndex + li, pov.fixedValue); }
        catch (err) { /* non-fatal */ }
      }
      emitChange();
    });

    return row;
  }

  // ---------------------------------------------------------------------------
  // Change notifications
  // ---------------------------------------------------------------------------

  function emitChange() {
    try { _onChange(); } catch (e) { console.warn('[patch-editor] onChange threw', e); }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  function open() {
    build();
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
  }
  function close() {
    root.classList.add('hidden');
    root.setAttribute('aria-hidden', 'true');
  }
  function isOpen() { return !root.classList.contains('hidden'); }
  function refresh() { if (isOpen()) build(); }
  function setContext({ engine, preset, sectionView, sectionCount } = {}) {
    if (engine    !== undefined) _engine  = engine;
    if (preset    !== undefined) _preset  = preset;
    if (sectionView  !== undefined && typeof sectionView  === 'function') _viewFn  = sectionView;
    if (sectionCount !== undefined && typeof sectionCount === 'function') _countFn = sectionCount;
    if (isOpen()) build();
  }
  function teardown() {
    document.removeEventListener('keydown', onKey);
    root.remove();
    if (_singleton && _singleton.root === root) _singleton = null;
  }

  const api = { open, close, isOpen, refresh, setContext, teardown, root };
  _singleton = api;
  return api;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Styles (injected once; same pattern as patch-bay-modal / session-restore)
// ---------------------------------------------------------------------------

function injectStyles() {
  if (document.getElementById('patch-editor-styles')) return;
  const s = document.createElement('style');
  s.id = 'patch-editor-styles';
  s.textContent = `
.pe-root { position: fixed; inset: 0; z-index: 9600; font-family: inherit; color: #f3f3f3; }
.pe-root.hidden { display: none; }
.pe-backdrop { position: absolute; inset: 0; background: rgba(8,8,10,0.78); backdrop-filter: blur(4px); }
.pe-modal {
  position: absolute; inset: 24px; background: #161618;
  border: 1px solid #2a2a2e; border-radius: 10px;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 10px 40px rgba(0,0,0,0.6);
}
.pe-header {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; border-bottom: 1px solid #2a2a2e; background: #1c1c1f;
}
.pe-title { font-size: 14px; font-weight: 600; letter-spacing: 0.02em; }
.pe-subtitle { font-size: 12px; color: #9aa; }
.pe-spacer { flex: 1; }
.pe-btn {
  background: #2a2a2e; border: 1px solid #3a3a3e; color: #eee;
  border-radius: 6px; padding: 4px 12px; cursor: pointer; font: inherit; font-size: 12px;
}
.pe-btn:hover { background: #34343a; }
.pe-btn.on { background: #ff6a00; color: #fff; border-color: #ff6a00; }
.pe-btn-primary { background: #ff6a00; color: #fff; border-color: #ff6a00; font-weight: 600; }
.pe-btn-primary:hover { background: #ff8a2a; }
.pe-btn-small { padding: 3px 8px; font-size: 11px; }
.pe-close { padding: 2px 10px; font-size: 18px; line-height: 1; }

.pe-columns {
  flex: 1; display: grid; grid-template-columns: 1fr 1fr 1fr;
  gap: 1px; background: #2a2a2e; overflow: hidden;
}
.pe-col { display: flex; flex-direction: column; background: #121214; overflow: hidden; }
.pe-col-header {
  padding: 8px 12px; font-size: 11px; text-transform: uppercase;
  letter-spacing: 0.08em; color: #9aa; background: #1a1a1d;
  border-bottom: 1px solid #2a2a2e;
}
.pe-col-body { flex: 1; overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.pe-empty { color: #555; font-size: 12px; padding: 12px; text-align: center; }

.pe-card {
  background: #1a1a1d; border: 1px solid #2a2a2e; border-radius: 8px;
  padding: 10px; display: flex; flex-direction: column; gap: 8px;
}
.pe-card-patchbay { border-color: #ff6a00; }
.pe-card-header { display: flex; align-items: center; gap: 8px; }
.pe-card-title { flex: 1; font-size: 13px; font-weight: 600; }
.pe-card-sub { font-size: 11px; color: #888; }
.pe-caret {
  background: transparent; border: 0; color: #888; cursor: pointer;
  padding: 2px 6px; font-size: 12px; transition: transform 120ms;
}
.pe-caret.open { transform: rotate(90deg); color: #eee; }
.pe-card-foot { font-size: 10px; color: #666; }

.pe-card-controls {
  display: flex; align-items: center; gap: 12px;
}
.pe-mute-all { flex: 0 0 auto; }
.pe-group-curve {
  flex: 1; display: flex; align-items: center; gap: 6px; font-size: 11px; color: #aaa;
}
.pe-group-curve input { flex: 1; }
.pe-val { font-variant-numeric: tabular-nums; color: #ccc; min-width: 32px; text-align: right; }

.pe-card-body { display: flex; flex-direction: column; gap: 6px; }
.pe-card-body.hidden { display: none; }

.pe-param-row {
  display: grid;
  grid-template-columns: minmax(80px, 1fr) auto 2fr;
  gap: 6px; align-items: center;
  padding: 4px 6px; border-radius: 4px;
  background: rgba(255,255,255,0.02);
}
.pe-param-row.muted    { opacity: 0.6; }
.pe-param-row.bypassed { opacity: 0.35; }
.pe-param-name { font-size: 11px; color: #ddd; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.pe-param-flags { display: flex; gap: 3px; }
.pe-flag {
  width: 20px; height: 20px; border-radius: 3px; padding: 0;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  color: #888; font-size: 10px; font-weight: 700; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.pe-flag.on { background: #ff6a00; color: #fff; border-color: #ff6a00; }
.pe-flag-bypass.on { background: #6b2cff; border-color: #6b2cff; }

.pe-param-ranges {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px;
}
.pe-mini { display: flex; flex-direction: column; gap: 1px; font-size: 9px; color: #888; }
.pe-mini input { width: 100%; margin: 0; }

@media (max-width: 480px) {
  .pe-modal { inset: 0; border-radius: 0; }
  .pe-columns { grid-template-columns: 1fr; grid-auto-rows: min-content; overflow: auto; }
  .pe-col { border-bottom: 1px solid #2a2a2e; }
  .pe-col-body { max-height: none; }
  .pe-param-row { grid-template-columns: 1fr; gap: 4px; }
}
`;
  document.head.appendChild(s);
}
