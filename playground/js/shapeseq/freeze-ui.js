/**
 * Freeze UI — adds freeze/live toggle interaction to chain param rows.
 *
 * When frozen:
 * - Param rows are dimmed by default (frozen state)
 * - Tapping a param row toggles it to "live" (highlighted, receives ML deltas)
 * - Live params show a secondary indicator (delta range bar) on the slider
 *
 * When not frozen:
 * - All params show normally (no freeze indicators)
 *
 * @module shapeseq/freeze-ui
 */

// ── Inject styles once ───────────────────────────────────────────────

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;

  const css = `
/* ── Freeze UI states ───────────────────────────────────────── */

.param-frozen {
  cursor: pointer;
}

.param-frozen .chain-param-slider {
  pointer-events: none;
}

.param-live {
  cursor: pointer;
}

.param-live .chain-param-slider {
  box-shadow: 0 0 0 2px rgba(0, 200, 100, 0.5);
}
`;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

// ── FreezeUI ─────────────────────────────────────────────────────────

export class FreezeUI {
  /**
   * @param {{ container: HTMLElement, freezeManager: import('./freeze.js').FreezeManager, onToggle: (flatIndex: number) => void }} opts
   */
  constructor({ container, freezeManager, onToggle }) {
    injectStyles();

    this._container = container;
    this._fm = freezeManager;
    this._onToggle = onToggle;
    this._clickHandler = this._handleClick.bind(this);

    // Delegate click handling on param rows
    this._container.addEventListener('click', this._clickHandler);
  }

  /**
   * Update visual state of all param rows based on freeze state.
   * Call this after freeze/unfreeze/toggle.
   */
  update() {
    if (!this._fm.isFrozen) {
      // Remove all freeze styling
      this._container.querySelectorAll('.chain-param-row').forEach(row => {
        row.classList.remove('param-frozen', 'param-live');
        row.style.opacity = '';
      });
      return;
    }

    const liveFlags = this._fm.getLiveFlags();
    if (!liveFlags) return;

    this._container.querySelectorAll('.chain-param-row').forEach(row => {
      const idx = parseInt(row.dataset.flatIndex, 10);
      if (isNaN(idx) || idx >= liveFlags.length) return;

      if (liveFlags[idx]) {
        row.classList.add('param-live');
        row.classList.remove('param-frozen');
        row.style.opacity = '';
      } else {
        row.classList.add('param-frozen');
        row.classList.remove('param-live');
        row.style.opacity = '0.4';
      }
    });
  }

  /**
   * Show delta indicators on live param sliders.
   * @param {Float32Array} frozenParams
   * @param {Float32Array} effectiveParams
   */
  updateDeltaIndicators(frozenParams, effectiveParams) {
    if (!this._fm.isFrozen || !frozenParams || !effectiveParams) return;

    this._container.querySelectorAll('.chain-param-row.param-live').forEach(row => {
      const idx = parseInt(row.dataset.flatIndex, 10);
      if (isNaN(idx)) return;

      // Show delta as a secondary mark on the slider
      let indicator = row.querySelector('.delta-indicator');
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'delta-indicator';
        indicator.style.cssText = 'position:absolute;height:4px;background:rgba(0,140,255,0.6);border-radius:2px;bottom:0;pointer-events:none;transition:left 0.1s,width 0.1s;';
        const slider = row.querySelector('.chain-param-slider');
        if (slider) {
          slider.parentElement.style.position = 'relative';
          slider.parentElement.appendChild(indicator);
        }
      }

      // Position indicator between frozen value and effective value
      const frozen = frozenParams[idx];
      const effective = effectiveParams[idx];
      const left = Math.min(frozen, effective) * 100;
      const width = Math.abs(effective - frozen) * 100;
      indicator.style.left = left + '%';
      indicator.style.width = width + '%';
    });
  }

  /**
   * @private
   */
  _handleClick(e) {
    if (!this._fm.isFrozen) return;

    const row = e.target.closest('.chain-param-row');
    if (!row) return;

    // Don't toggle when interacting with the slider itself
    if (e.target.closest('.chain-param-slider')) return;

    const idx = parseInt(row.dataset.flatIndex, 10);
    if (isNaN(idx)) return;

    this._onToggle(idx);
    this.update();
  }

  /**
   * Cleanup all DOM listeners.
   */
  destroy() {
    this._container.removeEventListener('click', this._clickHandler);
  }
}
