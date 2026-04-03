// eoc-chain-ui.js — Drawer UI for the End-of-Chain effects rack.
//
// Usage:
//   import { EOCChainUI, moduleFactory } from './ui/eoc-chain-ui.js';
//   EOCChainUI.init(chain, document.getElementById('eoc-drawer-body'));
//
// The drawer renders:
//   1. NISPS mode selector (Bypass / Shared / Linked / Independent)
//   2. Ordered, draggable list of active modules (bypass toggle, remove, param count)
//   3. Add-module bar (one button per available but absent module)
//
// Reacts to 'eoc:change' events on window to stay in sync with external mutations.

import { EOCModule }         from '../eoc/eoc-module.js';
import { EQModule }          from '../eoc/modules/eq-module.js';
import { CompressorModule }  from '../eoc/modules/compressor-module.js';
import { ReverbModule }      from '../eoc/modules/reverb-module.js';
import { DelayModule }       from '../eoc/modules/delay-module.js';
import { SaturationModule }  from '../eoc/modules/saturation-module.js';
import { MasterModule }      from '../eoc/modules/master-module.js';

// ---------------------------------------------------------------------------
// Stub module factory
// ---------------------------------------------------------------------------

const STUB_DEFS = {
  saturation: { displayName: 'Saturation', paramMeta: [] },
  eq:         { displayName: 'EQ',         paramMeta: [] },
  compressor: { displayName: 'Compressor', paramMeta: [] },
  reverb:     { displayName: 'Reverb',     paramMeta: [] },
  delay:      { displayName: 'Delay',      paramMeta: [] },
  master:     { displayName: 'Master Bus', paramMeta: [] },
};

// Canonical slot order (matches EOCChain's DEFAULT_ORDER)
const MODULE_ORDER = ['saturation', 'eq', 'compressor', 'reverb', 'delay', 'master'];

/**
 * Build a minimal EOCModule stub for the given id.
 * Exported so a-app.js can replace it with real implementations later.
 *
 * @param {string} id — one of saturation | eq | compressor | reverb | delay | master
 * @returns {EOCModule}
 */
export function moduleFactory(id) {
  // Real Faust WASM implementations
  switch (id) {
    case 'eq':          return new EQModule();
    case 'compressor':  return new CompressorModule();
    case 'reverb':      return new ReverbModule();
    case 'delay':       return new DelayModule();
    case 'saturation':  return new SaturationModule();
    case 'master':      return new MasterModule();
    default: break;
  }

  const def = STUB_DEFS[id];
  if (!def) throw new Error(`moduleFactory: unknown module id '${id}'`);

  // Build stub class inline, scoped to the specific id/def
  class StubModule extends EOCModule {
    get id()          { return id; }
    get displayName() { return def.displayName; }
    get paramMeta()   { return def.paramMeta; }

    async init(audioCtx) {
      // Minimal super call to satisfy the base class contract without
      // requiring a real AudioContext in stub/test scenarios
      if (audioCtx && typeof audioCtx.createGain === 'function') {
        await super.init(audioCtx);
        this._finishInit();
      } else {
        this._initialized = true;
      }
    }
  }

  return new StubModule();
}

// ---------------------------------------------------------------------------
// EOCChainUI
// ---------------------------------------------------------------------------

export const EOCChainUI = {
  /**
   * @type {import('../eoc/eoc-chain.js').EOCChain|null}
   */
  _chain: null,
  /** @type {HTMLElement|null} */
  _container: null,
  /** Dragged module id during HTML5 DnD */
  _dragId: null,

  /**
   * Initialise the UI.
   *
   * @param {import('../eoc/eoc-chain.js').EOCChain} chain
   * @param {HTMLElement} containerEl
   */
  init(chain, containerEl) {
    this._chain     = chain;
    this._container = containerEl;

    // Listen for external chain changes
    window.addEventListener('eoc:change', () => this._render());

    this._render();
  },

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  _render() {
    if (!this._chain || !this._container) return;

    const c = this._container;
    c.innerHTML = '';

    c.appendChild(this._buildNispsBar());
    c.appendChild(this._buildModuleList());
    c.appendChild(this._buildAddBar());
  },

  // NISPS mode selector bar
  _buildNispsBar() {
    const modes = [
      { id: 'bypass',      label: 'Bypass' },
      { id: 'shared',      label: 'Shared' },
      { id: 'linked',      label: 'Linked' },
      { id: 'independent', label: 'Indep' },
    ];

    const bar = document.createElement('div');
    bar.className = 'eoc-nisps-bar';

    const label = document.createElement('span');
    label.className = 'eoc-section-label';
    label.textContent = 'NISPS';
    bar.appendChild(label);

    const toggle = document.createElement('div');
    toggle.className = 'pill-toggle pill-toggle-sm eoc-nisps-toggle';

    modes.forEach(({ id, label: lbl }) => {
      const btn = document.createElement('button');
      btn.className = 'pill-opt' + (this._chain.nispsMode === id ? ' active' : '');
      btn.textContent = lbl;
      btn.addEventListener('click', () => {
        this._chain.nispsMode = id;
        // re-render is triggered by eoc:change event from chain
      });
      toggle.appendChild(btn);
    });

    bar.appendChild(toggle);
    return bar;
  },

  // Ordered list of module rows
  _buildModuleList() {
    const list = document.createElement('div');
    list.className = 'eoc-module-list';

    const modules = this._chain.modules;

    if (modules.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'eoc-empty-hint';
      empty.textContent = 'No modules — add one below';
      list.appendChild(empty);
      return list;
    }

    modules.forEach((mod, idx) => {
      const row = this._buildModuleRow(mod, idx, modules.length, list);
      list.appendChild(row);
    });

    return list;
  },

  _buildModuleRow(mod, idx, totalCount, listEl) {
    const row = document.createElement('div');
    row.className = 'eoc-module-row';
    row.dataset.id = mod.id;
    row.draggable = true;

    // --- Drag handle ---
    const handle = document.createElement('span');
    handle.className = 'eoc-drag-handle';
    handle.title = 'Drag to reorder';
    handle.textContent = '⠿';
    row.appendChild(handle);

    // --- Module name ---
    const name = document.createElement('span');
    name.className = 'eoc-module-name';
    name.textContent = mod.displayName;
    row.appendChild(name);

    // --- Param count badge ---
    const badge = document.createElement('span');
    badge.className = 'eoc-param-badge';
    badge.textContent = mod.paramCount === 1
      ? '1 param'
      : `${mod.paramCount} params`;
    row.appendChild(badge);

    // --- Bypass toggle ---
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'eoc-bypass-toggle';
    toggleLabel.title = mod.enabled ? 'Active — click to bypass' : 'Bypassed — click to enable';

    const toggleInput = document.createElement('input');
    toggleInput.type    = 'checkbox';
    toggleInput.checked = mod.enabled;
    toggleInput.addEventListener('change', () => {
      mod.enabled = toggleInput.checked;
      // _applyBypass wires audio graph internally; dispatch change so UI refreshes
      window.dispatchEvent(new CustomEvent('eoc:change', {
        detail: { reason: 'bypass-toggled', chain: this._chain }
      }));
    });

    const toggleSlider = document.createElement('span');
    toggleSlider.className = 'eoc-bypass-slider';

    toggleLabel.appendChild(toggleInput);
    toggleLabel.appendChild(toggleSlider);
    row.appendChild(toggleLabel);

    // --- Remove button ---
    const removeBtn = document.createElement('button');
    removeBtn.className = 'eoc-remove-btn';
    removeBtn.title = `Remove ${mod.displayName}`;
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      this._chain.removeModule(mod.id);
    });
    row.appendChild(removeBtn);

    // --- Manual param sliders (shown in bypass mode, or when module has params) ---
    if (mod.paramCount > 0) {
      const paramsSection = this._buildParamSliders(mod);
      row.appendChild(paramsSection);
    }

    // --- HTML5 Drag-and-drop ---
    row.addEventListener('dragstart', (e) => {
      this._dragId = mod.id;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', mod.id);
    });

    row.addEventListener('dragend', () => {
      this._dragId = null;
      row.classList.remove('dragging');
      // Clean up all drop indicators
      listEl.querySelectorAll('.eoc-drop-indicator').forEach(el => el.remove());
    });

    row.addEventListener('dragover', (e) => {
      if (!this._dragId || this._dragId === mod.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // Show drop-indicator above or below based on cursor position
      const rect = row.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const insertBefore = e.clientY < midY;

      // Remove all existing indicators then place one
      listEl.querySelectorAll('.eoc-drop-indicator').forEach(el => el.remove());
      const indicator = document.createElement('div');
      indicator.className = 'eoc-drop-indicator';
      if (insertBefore) {
        listEl.insertBefore(indicator, row);
      } else {
        row.insertAdjacentElement('afterend', indicator);
      }
    });

    row.addEventListener('drop', (e) => {
      if (!this._dragId || this._dragId === mod.id) return;
      e.preventDefault();

      // Determine new position
      const rect     = row.getBoundingClientRect();
      const midY     = rect.top + rect.height / 2;
      const insertBefore = e.clientY < midY;

      const allRows  = [...listEl.querySelectorAll('.eoc-module-row')];
      const targetIdx = allRows.findIndex(r => r.dataset.id === mod.id);
      // After moving the dragged element out, the target index needs adjustment
      const dragIdx   = allRows.findIndex(r => r.dataset.id === this._dragId);
      let newPos      = insertBefore ? targetIdx : targetIdx + 1;
      if (dragIdx < targetIdx) newPos -= 1; // account for removal shifting indices

      this._chain.moveModule(this._dragId, Math.max(0, newPos));
      // eoc:change will re-render
    });

    return row;
  },

  // Per-module param sliders (collapsible, shown only when paramCount > 0)
  _buildParamSliders(mod) {
    const section = document.createElement('div');
    section.className = 'eoc-params-section';

    // Toggle button (chevron + label)
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'eoc-params-toggle';
    const isManual = this._chain.nispsMode === 'bypass';
    toggleBtn.textContent = isManual ? '▶ params (manual)' : '▶ params';
    toggleBtn.title = 'Expand to show parameter sliders';

    const sliderList = document.createElement('div');
    sliderList.className = 'eoc-params-list eoc-params-collapsed';

    toggleBtn.addEventListener('click', () => {
      const collapsed = sliderList.classList.toggle('eoc-params-collapsed');
      toggleBtn.textContent = collapsed
        ? (isManual ? '▶ params (manual)' : '▶ params')
        : (isManual ? '▼ params (manual)' : '▼ params');
    });

    // One slider per param
    mod.paramMeta.forEach((meta, i) => {
      const row = document.createElement('div');
      row.className = 'eoc-param-row';

      const label = document.createElement('label');
      label.className = 'eoc-param-label';
      label.textContent = meta.name ?? meta.id ?? `Param ${i}`;

      const slider = document.createElement('input');
      slider.type  = 'range';
      slider.min   = '0';
      slider.max   = '1';
      slider.step  = '0.001';
      slider.value = String(mod.getCurrentParamValue(i));
      slider.className = 'eoc-param-slider';

      slider.addEventListener('input', () => {
        mod.setParam(i, parseFloat(slider.value));
      });

      row.appendChild(label);
      row.appendChild(slider);
      sliderList.appendChild(row);
    });

    section.appendChild(toggleBtn);
    section.appendChild(sliderList);
    return section;
  },

  // Add-module bar
  _buildAddBar() {
    const bar = document.createElement('div');
    bar.className = 'eoc-add-bar';

    const activeIds = new Set(this._chain.modules.map(m => m.id));

    const available = MODULE_ORDER.filter(id => !activeIds.has(id));

    if (available.length === 0) {
      const hint = document.createElement('span');
      hint.className = 'eoc-add-hint';
      hint.textContent = 'All modules added';
      bar.appendChild(hint);
      return bar;
    }

    available.forEach(id => {
      const def = STUB_DEFS[id];
      if (!def) return;

      const btn = document.createElement('button');
      btn.className = 'action-btn eoc-add-btn';
      btn.textContent = `+ ${def.displayName}`;
      btn.title = `Add ${def.displayName} to chain`;
      btn.addEventListener('click', () => {
        this._chain.addModule(moduleFactory(id));
        // eoc:change re-renders
      });
      bar.appendChild(btn);
    });

    return bar;
  },
};
