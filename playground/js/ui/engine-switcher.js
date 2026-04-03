/**
 * EngineSwitcher — engine selection UI for the Engine drawer.
 *
 * Usage:
 *   EngineSwitcher.init(containerEl, engines, onSwitch);
 *
 * @param {HTMLElement} containerEl — element to prepend the switcher into
 * @param {Array<{id, displayName, paramCount, description, comingSoon?}>} engines
 * @param {(engineId: string) => void} onSwitch — called when user confirms a switch
 */
export const EngineSwitcher = {
  _containerEl: null,
  _engines: [],
  _activeId: null,
  _onSwitch: null,
  _hasTrainingData: null, // () => boolean

  /**
   * @param {HTMLElement} containerEl
   * @param {Array<{id:string, displayName:string, paramCount:number, description:string, comingSoon?:boolean}>} engines
   * @param {(engineId:string) => void} onSwitch
   * @param {{ hasTrainingData?: () => boolean }} [opts]
   */
  init(containerEl, engines, onSwitch, opts = {}) {
    this._containerEl = containerEl;
    this._engines = engines;
    this._onSwitch = onSwitch;
    this._hasTrainingData = opts.hasTrainingData || (() => false);

    this._activeId = engines[0]?.id ?? null;
    this._render();
  },

  /** Update which card appears active (call after engine swap completes). */
  setActive(engineId) {
    this._activeId = engineId;
    const section = this._containerEl?.querySelector('.engine-switcher-section');
    if (!section) return;
    section.querySelectorAll('.engine-card').forEach(card => {
      card.classList.toggle('active', card.dataset.engineId === engineId);
    });
  },

  /** Show/hide the loading spinner on a card. */
  setLoading(engineId, loading) {
    const section = this._containerEl?.querySelector('.engine-switcher-section');
    if (!section) return;
    const card = section.querySelector(`[data-engine-id="${engineId}"]`);
    if (card) card.classList.toggle('loading', loading);
  },

  _render() {
    const container = this._containerEl;
    if (!container) return;

    // Remove any previous section if re-initialised
    const existing = container.querySelector('.engine-switcher-section');
    if (existing) existing.remove();

    const section = document.createElement('div');
    section.className = 'engine-switcher-section';

    const heading = document.createElement('div');
    heading.className = 'engine-switcher-heading';
    heading.textContent = 'Synthesis Engine';
    section.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'engine-card-grid';

    for (const eng of this._engines) {
      const card = document.createElement('div');
      card.className = 'engine-card';
      card.dataset.engineId = eng.id;
      if (eng.id === this._activeId) card.classList.add('active');
      if (eng.comingSoon) card.classList.add('coming-soon');

      const nameRow = document.createElement('div');
      nameRow.className = 'engine-card-name-row';

      const name = document.createElement('span');
      name.className = 'engine-card-name';
      name.textContent = eng.displayName;

      const badge = document.createElement('span');
      badge.className = 'engine-card-params';
      badge.textContent = eng.comingSoon ? 'soon' : `${eng.paramCount} params`;

      nameRow.appendChild(name);
      nameRow.appendChild(badge);

      const desc = document.createElement('span');
      desc.className = 'engine-card-desc';
      desc.textContent = eng.description;

      card.appendChild(nameRow);
      card.appendChild(desc);
      grid.appendChild(card);

      if (!eng.comingSoon) {
        card.addEventListener('click', () => this._handleClick(eng));
      }
    }

    section.appendChild(grid);

    const divider = document.createElement('div');
    divider.className = 'engine-switcher-divider';
    section.appendChild(divider);

    // Prepend before any existing drawer content (e.g. engine-tuning sliders)
    container.insertBefore(section, container.firstChild);
  },

  _handleClick(eng) {
    if (eng.id === this._activeId) return;

    const proceed = () => {
      this.setLoading(eng.id, true);
      try {
        this._onSwitch(eng.id);
      } finally {
        // Loading state cleared by caller via setLoading/setActive
      }
    };

    if (this._hasTrainingData()) {
      const msg = 'Switching engines will reset training examples. Network weights will be partially preserved. Continue?';
      if (window.confirm(msg)) proceed();
    } else {
      proceed();
    }
  },
};
