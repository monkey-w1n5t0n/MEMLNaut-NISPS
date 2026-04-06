/**
 * ShapeSeq Chain Builder UI — full-screen slide-up drawer with signal-based updates
 *
 * Pedalboard-style chain editor: expandable cards with param sliders,
 * drag-to-reorder, delete, add-primitive palette, generator combine toggle.
 * Mobile-first, dark glass theme matching the immersive playground.
 *
 * Uses vanilla signals for reactive slider updates at 60fps — O(changed params)
 * instead of O(all sliders) via querySelectorAll.
 *
 * All styles are inline (no external CSS dependency).
 *
 * @module shapeseq/chain-ui
 */

import { PRIMITIVE_REGISTRY } from './primitives.js';
import { createArraySignal } from './signal.js';

// ── Category colors ──────────────────────────────────────────────────

const CATEGORY_COLORS = {
  generator: '#ff6a00',
  processor: '#00ccff',
  timing:    '#ffcc00',
  converter: '#88ff00',
};

// ── Inject styles once ───────────────────────────────────────────────

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;

  const css = `
/* ── Chain drawer overlay + slide-up drawer ────────────────────── */

.chain-drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 9998;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}

.chain-drawer-overlay.open {
  opacity: 1;
  pointer-events: auto;
}

.chain-drawer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  max-height: 85vh;
  z-index: 9999;
  transform: translateY(100%);
  transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
  background: rgba(13, 13, 13, 0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px 16px 0 0;
  display: flex;
  flex-direction: column;
  font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 13px;
  color: #e0e0e0;
}

.chain-drawer.open {
  transform: translateY(0);
}

.chain-drawer-handle {
  display: flex;
  justify-content: center;
  padding: 10px 0 4px;
  cursor: grab;
}

.chain-drawer-handle::after {
  content: '';
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.2);
}

.chain-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 16px 8px;
  font-size: 11px;
  font-weight: 700;
  color: #ff6a00;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.chain-drawer-close {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  color: #888;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  line-height: 1;
  transition: all 0.15s;
}

.chain-drawer-close:hover {
  border-color: #ff6a00;
  color: #ff6a00;
}

/* ── Chain Builder container ─────────────────────────────────── */

.chain-builder {
  --cb-glass-bg: rgba(13, 13, 13, 0.72);
  --cb-glass-border: rgba(255, 255, 255, 0.08);
  --cb-glass-blur: 16px;
  --cb-text: #e0e0e0;
  --cb-text-dim: #888;
  --cb-radius: 12px;
  --cb-radius-sm: 8px;
  --cb-accent: #ff6a00;

  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  flex: 1;
  min-height: 0;
}

/* ── Primitive card ──────────────────────────────────────────── */

.chain-card {
  position: relative;
  background: var(--cb-glass-bg);
  backdrop-filter: blur(var(--cb-glass-blur));
  -webkit-backdrop-filter: blur(var(--cb-glass-blur));
  border: 1px solid var(--cb-glass-border);
  border-radius: var(--cb-radius);
  overflow: hidden;
  transition: box-shadow 0.2s, transform 0.15s;
}

.chain-card.dragging {
  opacity: 0.7;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  transform: scale(1.03);
  z-index: 100;
}

.chain-card-left-border {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  border-radius: var(--cb-radius) 0 0 var(--cb-radius);
}

/* ── Card header ─────────────────────────────────────────────── */

.chain-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 10px 14px;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}

.chain-card-drag {
  display: flex;
  flex-direction: column;
  gap: 2px;
  cursor: grab;
  touch-action: none;
  padding: 4px 2px;
  opacity: 0.4;
  transition: opacity 0.15s;
}

.chain-card-drag:hover,
.chain-card-drag:active {
  opacity: 0.8;
}

.chain-card-drag span {
  display: block;
  width: 14px;
  height: 2px;
  background: var(--cb-text);
  border-radius: 1px;
}

.chain-card-name {
  flex: 1;
  font-weight: 600;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chain-card-badge {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--cb-text-dim);
  white-space: nowrap;
}

.chain-card-summary {
  font-size: 11px;
  color: var(--cb-text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}

.chain-card-delete {
  background: none;
  border: none;
  color: var(--cb-text-dim);
  font-size: 16px;
  padding: 4px 6px;
  cursor: pointer;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
  line-height: 1;
}

.chain-card-delete:hover,
.chain-card-delete:active {
  color: #ff4466;
  background: rgba(255, 68, 102, 0.12);
}

.chain-card-expand-icon {
  font-size: 10px;
  color: var(--cb-text-dim);
  transition: transform 0.2s;
}

.chain-card.expanded .chain-card-expand-icon {
  transform: rotate(90deg);
}

/* ── Card body (params) ──────────────────────────────────────── */

.chain-card-body {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.25s ease;
}

.chain-card.expanded .chain-card-body {
  max-height: 600px;
}

.chain-card-params {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 14px 12px 14px;
}

/* ── Param slider row ────────────────────────────────────────── */

.chain-param-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chain-param-label {
  font-size: 11px;
  color: var(--cb-text-dim);
  min-width: 80px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chain-param-slider {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  outline: none;
  cursor: pointer;
}

.chain-param-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--cb-text);
  border: 2px solid rgba(0, 0, 0, 0.3);
  cursor: pointer;
}

.chain-param-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--cb-text);
  border: 2px solid rgba(0, 0, 0, 0.3);
  cursor: pointer;
}

.chain-param-value {
  font-size: 11px;
  color: var(--cb-text-dim);
  min-width: 32px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* ── NISPS live indicator ────────────────────────────────────── */

.chain-param-row.nisps-live .chain-param-slider {
  box-shadow: 0 0 0 2px rgba(0, 140, 255, 0.5);
  animation: nisps-pulse 1.5s ease-in-out infinite;
}

@keyframes nisps-pulse {
  0%, 100% { box-shadow: 0 0 0 2px rgba(0, 140, 255, 0.3); }
  50% { box-shadow: 0 0 0 3px rgba(0, 140, 255, 0.7); }
}

/* ── Add button ──────────────────────────────────────────────── */

.chain-add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px;
  border: 2px dashed rgba(255, 255, 255, 0.12);
  border-radius: var(--cb-radius);
  background: transparent;
  color: var(--cb-text-dim);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.chain-add-btn:hover,
.chain-add-btn:active {
  border-color: var(--cb-accent);
  color: var(--cb-accent);
}

/* ── Generator combine mode toggle ───────────────────────────── */

.chain-combine-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 0 4px;
}

.chain-combine-label {
  font-size: 11px;
  color: var(--cb-text-dim);
}

.chain-combine-btn {
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--cb-text);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  min-width: 60px;
  text-align: center;
}

.chain-combine-btn:hover,
.chain-combine-btn:active {
  border-color: var(--cb-accent);
  background: rgba(255, 106, 0, 0.1);
}

/* ── Palette modal ───────────────────────────────────────────── */

.chain-palette-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  animation: palette-fade-in 0.15s ease;
}

@keyframes palette-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.chain-palette {
  width: 100%;
  max-width: 420px;
  max-height: 80vh;
  overflow-y: auto;
  background: rgba(20, 20, 20, 0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px 16px 0 0;
  padding: 16px 12px 24px;
  animation: palette-slide-up 0.2s ease;
}

@keyframes palette-slide-up {
  from { transform: translateY(40px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.chain-palette-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--cb-text, #e0e0e0);
  text-align: center;
  margin-bottom: 12px;
}

.chain-palette-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.12s;
  border: none;
  background: none;
  width: 100%;
  text-align: left;
  font-family: inherit;
  color: #e0e0e0;
}

.chain-palette-item:hover,
.chain-palette-item:active {
  background: rgba(255, 255, 255, 0.06);
}

.chain-palette-item-color {
  width: 4px;
  height: 36px;
  border-radius: 2px;
  flex-shrink: 0;
}

.chain-palette-item-info {
  flex: 1;
  min-width: 0;
}

.chain-palette-item-name {
  font-size: 13px;
  font-weight: 600;
}

.chain-palette-item-meta {
  font-size: 11px;
  color: #888;
  margin-top: 2px;
}

/* ── Drop indicator ──────────────────────────────────────────── */

.chain-drop-indicator {
  height: 3px;
  background: var(--cb-accent, #ff6a00);
  border-radius: 2px;
  margin: -2px 8px;
  opacity: 0;
  transition: opacity 0.1s;
}

.chain-drop-indicator.active {
  opacity: 1;
}
`;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

// ── ChainBuilderUI ───────────────────────────────────────────────────

export class ChainBuilderUI {
  /**
   * @param {{ container: HTMLElement, chain: import('./chain.js').Chain, eventBus: { emit: Function, on: Function } }} opts
   */
  constructor({ container, chain, eventBus }) {
    injectStyles();

    /** @type {HTMLElement} */
    this._container = container;
    /** @type {import('./chain.js').Chain} */
    this._chain = chain;
    /** @type {{ emit: Function, on: Function }} */
    this._bus = eventBus;

    /** @private @type {Set<number>} flat param indices controlled by NISPS */
    this._liveParams = new Set();

    /** @private @type {Function|null} */
    this._paramChangeCb = null;

    /** @private @type {Set<number>} indices of expanded cards */
    this._expandedCards = new Set();

    /** @private @type {Float32Array|null} current param values for display */
    this._currentParams = null;

    /** @private @type {import('./signal.js').ArraySignal|null} */
    this._paramSignal = null;

    /** @private @type {Function[]} signal unsubscribers for cleanup */
    this._signalUnsubs = [];

    /** @private @type {Map<number, HTMLElement>} chainIndex -> card element */
    this._cardMap = new Map();

    // ── Drag state ──
    /** @private */
    this._dragIndex = -1;
    /** @private */
    this._dragEl = null;
    /** @private */
    this._dragStartY = 0;
    /** @private */
    this._dragOffsetY = 0;
    /** @private @type {HTMLElement|null} */
    this._cardList = null;

    // ── Palette overlay ref ──
    /** @private @type {HTMLElement|null} */
    this._paletteOverlay = null;

    // ── Drawer elements ──
    /** @private @type {HTMLElement|null} */
    this._drawerOverlay = null;
    /** @private @type {HTMLElement|null} */
    this._drawer = null;
    /** @private @type {boolean} */
    this._isOpen = false;

    // ── Bound handlers for cleanup ──
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);

    this._buildDrawer();
    this.render();
  }

  // ── Public API ─────────────────────────────────────────────────────

  /**
   * Open the drawer.
   */
  open() {
    if (this._isOpen) return;
    this._isOpen = true;
    if (this._drawerOverlay) this._drawerOverlay.classList.add('open');
    if (this._drawer) this._drawer.classList.add('open');
  }

  /**
   * Close the drawer.
   */
  close() {
    if (!this._isOpen) return;
    this._isOpen = false;
    if (this._drawerOverlay) this._drawerOverlay.classList.remove('open');
    if (this._drawer) this._drawer.classList.remove('open');
  }

  /**
   * Rebuild the card list from current chain state.
   * Uses keyed reconciliation: only adds/removes/moves the cards that changed.
   */
  render() {
    const primitives = this._chain.getPrimitives();
    const cardList = this._cardList;
    if (!cardList) return;

    // Clean up old signal subscriptions
    for (const unsub of this._signalUnsubs) unsub();
    this._signalUnsubs = [];

    // Compute total param count and create signal
    let totalParams = 0;
    for (const p of primitives) totalParams += p.paramCount;
    this._paramSignal = createArraySignal(totalParams);

    // Build desired order: chainIndex list
    const desiredKeys = primitives.map((_, i) => i);
    const existingKeys = [...this._cardMap.keys()];

    // Remove cards no longer present
    for (const key of existingKeys) {
      if (!desiredKeys.includes(key)) {
        const el = this._cardMap.get(key);
        if (el && el.parentElement) el.remove();
        this._cardMap.delete(key);
      }
    }

    // For a full reconciliation with reindexing, rebuild all cards
    // (primitive indices change on add/remove/reorder)
    const oldMap = this._cardMap;
    this._cardMap = new Map();

    // Remove all existing cards from DOM
    while (cardList.firstChild) cardList.removeChild(cardList.firstChild);

    let flatOffset = 0;
    for (let i = 0; i < primitives.length; i++) {
      const prim = primitives[i];
      const card = this._createCard(prim, i, flatOffset);
      this._cardMap.set(i, card);
      cardList.appendChild(card);
      flatOffset += prim.paramCount;
    }

    // Seed signal with current param values if available
    if (this._currentParams && this._currentParams.length >= totalParams) {
      this._paramSignal.update(this._currentParams);
    }
  }

  /**
   * Update which flat param indices are NISPS-controlled (pulsing indicator).
   * @param {Array<number>} paramIndices
   */
  setLiveParams(paramIndices) {
    this._liveParams = new Set(paramIndices);
    if (!this._cardList) return;
    const rows = this._cardList.querySelectorAll('.chain-param-row');
    rows.forEach((row) => {
      const idx = parseInt(row.dataset.flatIndex, 10);
      if (isNaN(idx)) return;
      if (this._liveParams.has(idx)) {
        row.classList.add('nisps-live');
      } else {
        row.classList.remove('nisps-live');
      }
    });
  }

  /**
   * Register a callback for manual slider changes.
   * @param {(flatParamIndex: number, value: number) => void} callback
   */
  onParamChange(callback) {
    this._paramChangeCb = callback;
  }

  /**
   * Update displayed param values without re-rendering.
   * Backed by signal — only subscribers for changed indices are notified.
   * @param {Float32Array|Array<number>} params - flat param array
   */
  updateParamValues(params) {
    this._currentParams = params;
    if (this._paramSignal) {
      this._paramSignal.update(params);
    }
  }

  /**
   * Cleanup all DOM and listeners.
   */
  destroy() {
    this._closePalette();
    this.close();
    document.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('pointerup', this._onPointerUp);

    // Clean up signal subscriptions
    for (const unsub of this._signalUnsubs) unsub();
    this._signalUnsubs = [];

    // Remove drawer from DOM
    if (this._drawerOverlay) {
      this._drawerOverlay.remove();
      this._drawerOverlay = null;
    }
    if (this._drawer) {
      this._drawer.remove();
      this._drawer = null;
    }

    this._container.innerHTML = '';
    this._container.classList.remove('chain-builder');
    this._paramChangeCb = null;
    this._cardMap.clear();
  }

  // ── Drawer construction ───────────────────────────────────────────

  /**
   * @private
   * Build the drawer shell (overlay + drawer container + header).
   * The card list and controls go inside the drawer body.
   */
  _buildDrawer() {
    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'chain-drawer-overlay';
    overlay.addEventListener('click', () => this.close());
    this._drawerOverlay = overlay;

    // Drawer
    const drawer = document.createElement('div');
    drawer.className = 'chain-drawer';
    this._drawer = drawer;

    // Drag handle
    const handle = document.createElement('div');
    handle.className = 'chain-drawer-handle';
    drawer.appendChild(handle);

    // Header
    const header = document.createElement('div');
    header.className = 'chain-drawer-header';

    const title = document.createElement('span');
    title.textContent = 'Chain Builder';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'chain-drawer-close';
    closeBtn.textContent = '\u00D7';
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(closeBtn);

    drawer.appendChild(header);

    // Body (scrollable card list + controls)
    const body = document.createElement('div');
    body.classList.add('chain-builder');

    const cardList = document.createElement('div');
    cardList.style.display = 'flex';
    cardList.style.flexDirection = 'column';
    cardList.style.gap = '6px';
    this._cardList = cardList;
    body.appendChild(cardList);

    // Add button
    const addBtn = document.createElement('button');
    addBtn.className = 'chain-add-btn';
    addBtn.innerHTML = '<span style="font-size:18px;line-height:1">+</span> Add Primitive';
    addBtn.addEventListener('click', () => this._openPalette());
    body.appendChild(addBtn);

    // Generator combine mode toggle
    this._combineToggle = this._createCombineToggle();
    body.appendChild(this._combineToggle);

    drawer.appendChild(body);

    // Mount to document body
    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
  }

  // ── Card creation ──────────────────────────────────────────────────

  /**
   * @private
   * @param {import('./primitive.js').Primitive} prim
   * @param {number} chainIndex
   * @param {number} flatOffset - flat param offset for this primitive
   * @returns {HTMLElement}
   */
  _createCard(prim, chainIndex, flatOffset) {
    const card = document.createElement('div');
    card.className = 'chain-card';
    card.dataset.chainIndex = chainIndex;
    if (this._expandedCards.has(chainIndex)) {
      card.classList.add('expanded');
    }

    const catColor = CATEGORY_COLORS[prim.category] || '#888';

    // Left color border
    const leftBorder = document.createElement('div');
    leftBorder.className = 'chain-card-left-border';
    leftBorder.style.background = catColor;
    card.appendChild(leftBorder);

    // Header
    const header = document.createElement('div');
    header.className = 'chain-card-header';

    // Drag handle
    const drag = document.createElement('div');
    drag.className = 'chain-card-drag';
    drag.innerHTML = '<span></span><span></span><span></span>';
    drag.addEventListener('pointerdown', (e) => this._handleDragStart(e, chainIndex, card));
    header.appendChild(drag);

    // Name
    const name = document.createElement('span');
    name.className = 'chain-card-name';
    name.textContent = prim.name;
    header.appendChild(name);

    // Category badge
    const badge = document.createElement('span');
    badge.className = 'chain-card-badge';
    badge.textContent = prim.category;
    badge.style.color = catColor;
    header.appendChild(badge);

    // Summary (collapsed key params)
    const summary = document.createElement('span');
    summary.className = 'chain-card-summary';
    summary.textContent = this._buildSummary(prim, flatOffset);
    header.appendChild(summary);

    // Expand chevron
    const chevron = document.createElement('span');
    chevron.className = 'chain-card-expand-icon';
    chevron.textContent = '\u25B6'; // right-pointing triangle
    header.appendChild(chevron);

    // Delete button
    const del = document.createElement('button');
    del.className = 'chain-card-delete';
    del.textContent = '\u00D7'; // multiplication sign as X
    del.title = 'Remove';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      this._removePrimitive(chainIndex);
    });
    header.appendChild(del);

    // Toggle expand on header click (but not on drag handle or delete)
    header.addEventListener('click', (e) => {
      if (e.target.closest('.chain-card-drag') || e.target.closest('.chain-card-delete')) return;
      this._toggleExpand(chainIndex, card);
    });

    card.appendChild(header);

    // Body (params)
    const body = document.createElement('div');
    body.className = 'chain-card-body';

    const paramsDiv = document.createElement('div');
    paramsDiv.className = 'chain-card-params';

    for (let pi = 0; pi < prim.paramSchema.length; pi++) {
      const schema = prim.paramSchema[pi];
      const flatIdx = flatOffset + pi;
      const row = this._createParamRow(schema, flatIdx, prim);
      paramsDiv.appendChild(row);
    }

    body.appendChild(paramsDiv);
    card.appendChild(body);

    // Subscribe summary to signal updates
    if (this._paramSignal) {
      const unsub = this._paramSignal.subscribe(() => {
        summary.textContent = this._buildSummary(prim, flatOffset);
      });
      this._signalUnsubs.push(unsub);
    }

    return card;
  }

  /**
   * @private
   */
  _buildSummary(prim, flatOffset) {
    const schema = prim.paramSchema;
    const maxShow = Math.min(3, schema.length);
    const parts = [];
    for (let i = 0; i < maxShow; i++) {
      const val = this._currentParams
        ? this._currentParams[flatOffset + i]
        : schema[i].default;
      parts.push(schema[i].name + ':' + (val !== undefined ? val.toFixed(2) : schema[i].default.toFixed(2)));
    }
    return parts.join('  ');
  }

  /**
   * @private
   * Creates a param row with a slider that subscribes to the param signal
   * for its specific flat index — O(1) updates per changed param.
   */
  _createParamRow(schema, flatIdx, prim) {
    const row = document.createElement('div');
    row.className = 'chain-param-row';
    row.dataset.flatIndex = flatIdx;
    if (this._liveParams.has(flatIdx)) {
      row.classList.add('nisps-live');
    }

    const label = document.createElement('span');
    label.className = 'chain-param-label';
    label.textContent = schema.name;
    row.appendChild(label);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'chain-param-slider';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.001';
    slider.dataset.flatIndex = flatIdx;

    const currentVal = this._currentParams
      ? this._currentParams[flatIdx]
      : schema.default;
    slider.value = currentVal !== undefined ? currentVal : schema.default;

    const valDisplay = document.createElement('span');
    valDisplay.className = 'chain-param-value';
    valDisplay.textContent = parseFloat(slider.value).toFixed(2);

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      valDisplay.textContent = v.toFixed(2);
      if (this._paramChangeCb) {
        this._paramChangeCb(flatIdx, v);
      }
    });

    row.appendChild(slider);
    row.appendChild(valDisplay);

    // Subscribe to signal for reactive updates (only this slider's index)
    if (this._paramSignal) {
      const unsub = this._paramSignal.subscribe((params) => {
        if (flatIdx < params.length) {
          const newVal = params[flatIdx];
          slider.value = newVal;
          valDisplay.textContent = newVal.toFixed(2);
        }
      });
      this._signalUnsubs.push(unsub);
    }

    return row;
  }

  // ── Expand / collapse ──────────────────────────────────────────────

  /**
   * @private
   */
  _toggleExpand(chainIndex, cardEl) {
    if (this._expandedCards.has(chainIndex)) {
      this._expandedCards.delete(chainIndex);
      cardEl.classList.remove('expanded');
    } else {
      this._expandedCards.add(chainIndex);
      cardEl.classList.add('expanded');
    }
  }

  // ── Add / remove primitives ────────────────────────────────────────

  /**
   * @private
   */
  _removePrimitive(chainIndex) {
    this._chain.removePrimitive(chainIndex);
    // Adjust expanded set
    const newExpanded = new Set();
    for (const idx of this._expandedCards) {
      if (idx < chainIndex) newExpanded.add(idx);
      else if (idx > chainIndex) newExpanded.add(idx - 1);
      // idx === chainIndex is removed
    }
    this._expandedCards = newExpanded;
    this.render();
    this._bus.emit('ui.chainEdit', { action: 'remove', index: chainIndex });
  }

  /**
   * @private
   */
  _addPrimitive(registryKey) {
    const Ctor = PRIMITIVE_REGISTRY[registryKey];
    if (!Ctor) return;
    const instance = new Ctor();
    this._chain.addPrimitive(instance);
    this.render();
    this._bus.emit('ui.chainEdit', { action: 'add', name: registryKey });
  }

  // ── Palette ────────────────────────────────────────────────────────

  /**
   * @private
   */
  _openPalette() {
    if (this._paletteOverlay) return;

    const overlay = document.createElement('div');
    overlay.className = 'chain-palette-overlay';

    const palette = document.createElement('div');
    palette.className = 'chain-palette';

    const title = document.createElement('div');
    title.className = 'chain-palette-title';
    title.textContent = 'Add Primitive';
    palette.appendChild(title);

    const keys = Object.keys(PRIMITIVE_REGISTRY);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const CtorRef = PRIMITIVE_REGISTRY[key];
      // Instantiate temporarily to read metadata
      const temp = new CtorRef();

      const item = document.createElement('button');
      item.className = 'chain-palette-item';

      const colorBar = document.createElement('div');
      colorBar.className = 'chain-palette-item-color';
      colorBar.style.background = CATEGORY_COLORS[temp.category] || '#888';
      item.appendChild(colorBar);

      const info = document.createElement('div');
      info.className = 'chain-palette-item-info';

      const nameEl = document.createElement('div');
      nameEl.className = 'chain-palette-item-name';
      nameEl.textContent = temp.name;
      info.appendChild(nameEl);

      const meta = document.createElement('div');
      meta.className = 'chain-palette-item-meta';
      meta.textContent = temp.category + '  \u00B7  ' + temp.paramCount + ' params';
      info.appendChild(meta);

      item.appendChild(info);

      item.addEventListener('click', () => {
        this._closePalette();
        this._addPrimitive(key);
      });

      palette.appendChild(item);
    }

    overlay.appendChild(palette);

    // Close on overlay click (outside palette)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this._closePalette();
      }
    });

    document.body.appendChild(overlay);
    this._paletteOverlay = overlay;
  }

  /**
   * @private
   */
  _closePalette() {
    if (this._paletteOverlay) {
      this._paletteOverlay.remove();
      this._paletteOverlay = null;
    }
  }

  // ── Generator combine mode toggle ──────────────────────────────────

  /**
   * @private
   */
  _createCombineToggle() {
    const wrapper = document.createElement('div');
    wrapper.className = 'chain-combine-toggle';

    const label = document.createElement('span');
    label.className = 'chain-combine-label';
    label.textContent = 'Gen combine:';
    wrapper.appendChild(label);

    const btn = document.createElement('button');
    btn.className = 'chain-combine-btn';
    btn.textContent = this._chain.generatorCombineMode === 'additive' ? 'Add' : 'Mul';

    btn.addEventListener('click', () => {
      if (this._chain.generatorCombineMode === 'additive') {
        this._chain.generatorCombineMode = 'multiplicative';
        btn.textContent = 'Mul';
      } else {
        this._chain.generatorCombineMode = 'additive';
        btn.textContent = 'Add';
      }
      this._bus.emit('ui.chainEdit', { action: 'combineMode', mode: this._chain.generatorCombineMode });
    });

    wrapper.appendChild(btn);
    return wrapper;
  }

  // ── Drag-to-reorder (pointer events) ───────────────────────────────

  /**
   * @private
   */
  _handleDragStart(e, chainIndex, cardEl) {
    e.preventDefault();
    e.stopPropagation();

    this._dragIndex = chainIndex;
    this._dragEl = cardEl;
    this._dragStartY = e.clientY;
    this._dragOffsetY = 0;

    cardEl.classList.add('dragging');
    cardEl.setPointerCapture(e.pointerId);

    document.addEventListener('pointermove', this._onPointerMove);
    document.addEventListener('pointerup', this._onPointerUp);
  }

  /**
   * @private
   */
  _handlePointerMove(e) {
    if (this._dragIndex < 0 || !this._dragEl || !this._cardList) return;

    const dy = e.clientY - this._dragStartY;
    this._dragOffsetY = dy;
    this._dragEl.style.transform = 'translateY(' + dy + 'px) scale(1.03)';

    // Determine drop target by checking which card we're over
    const cards = this._cardList.querySelectorAll('.chain-card');
    const dragRect = this._dragEl.getBoundingClientRect();
    const dragCenter = dragRect.top + dragRect.height / 2;

    let targetIndex = this._dragIndex;
    for (let i = 0; i < cards.length; i++) {
      if (i === this._dragIndex) continue;
      const rect = cards[i].getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      if (this._dragIndex < i && dragCenter > center) {
        targetIndex = i;
      } else if (this._dragIndex > i && dragCenter < center) {
        targetIndex = i;
      }
    }

    this._dragTargetIndex = targetIndex;
  }

  /**
   * @private
   */
  _handlePointerUp(e) {
    document.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('pointerup', this._onPointerUp);

    if (this._dragEl) {
      this._dragEl.classList.remove('dragging');
      this._dragEl.style.transform = '';
    }

    const from = this._dragIndex;
    const to = this._dragTargetIndex !== undefined ? this._dragTargetIndex : from;

    this._dragIndex = -1;
    this._dragEl = null;
    this._dragTargetIndex = undefined;

    if (from !== to && from >= 0) {
      // Adjust expanded set for the move
      const newExpanded = new Set();
      for (const idx of this._expandedCards) {
        if (idx === from) {
          newExpanded.add(to);
        } else {
          let adjusted = idx;
          if (from < to) {
            if (idx > from && idx <= to) adjusted = idx - 1;
          } else {
            if (idx >= to && idx < from) adjusted = idx + 1;
          }
          newExpanded.add(adjusted);
        }
      }
      this._expandedCards = newExpanded;

      this._chain.movePrimitive(from, to);
      this.render();
      this._bus.emit('ui.chainEdit', { action: 'reorder', from: from, to: to });
    }
  }
}
