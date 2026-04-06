/**
 * Session Preset Manager — bundles control surface state + synth preset into
 * a single loadable configuration.
 *
 * Presets are stored in localStorage under a dedicated key, separate from the
 * main app state.
 *
 * @module session-presets
 */

const STORAGE_KEY = 'nisps-session-presets';

// ---------------------------------------------------------------------------
// URL encoding helpers
// ---------------------------------------------------------------------------

/**
 * Encode a compact session state into URL search params.
 * Only encodes the most important state for sharing.
 */
function encodeToURL(preset) {
  const params = new URLSearchParams();

  // Synth preset
  if (preset.synthPresetId) {
    params.set('sp', preset.synthPresetId);
  }

  // Compound axes (3 values, comma-separated)
  if (preset.controlSurface?.axes) {
    const a = preset.controlSurface.axes;
    params.set('cs', [
      (a.boldness ?? 0.5).toFixed(2),
      (a.memory ?? 0.5).toFixed(2),
      (a.precision ?? 0.3).toFixed(2),
    ].join(','));
  }

  // Output pipeline (only non-default values)
  if (preset.outputPipeline) {
    const op = preset.outputPipeline;
    const parts = [];
    if (op.globalCurve != null && op.globalCurve !== 1.0) parts.push(`gc=${op.globalCurve.toFixed(2)}`);
    if (op.smoothing != null && op.smoothing !== 0) parts.push(`sm=${op.smoothing.toFixed(2)}`);
    if (op.slewRate != null && op.slewRate !== 1.0) parts.push(`sl=${op.slewRate.toFixed(3)}`);
    if (parts.length > 0) params.set('op', parts.join(','));
  }

  // Key control surface overrides (compact: name=value pairs)
  if (preset.controlSurface?.offsets) {
    const offsets = preset.controlSurface.offsets;
    const keys = Object.keys(offsets);
    if (keys.length > 0 && keys.length <= 10) {
      // Only encode up to 10 overrides to keep URL reasonable
      const pairs = keys.slice(0, 10).map(k => {
        const v = offsets[k];
        return `${k}:${typeof v === 'number' ? v.toFixed(3) : v}`;
      });
      params.set('co', pairs.join(','));
    }
  }

  return params.toString();
}

/**
 * Decode session state from URL search params.
 * Returns a partial preset object.
 */
function decodeFromURL(urlParams) {
  const preset = {};

  // Synth preset
  const sp = urlParams.get('sp');
  if (sp) preset.synthPresetId = sp;

  // Compound axes
  const cs = urlParams.get('cs');
  if (cs) {
    const [b, m, p] = cs.split(',').map(Number);
    preset.controlSurface = {
      axes: {
        boldness: isNaN(b) ? 0.5 : b,
        memory: isNaN(m) ? 0.5 : m,
        precision: isNaN(p) ? 0.3 : p,
      },
      offsets: {},
    };
  }

  // Control surface overrides
  const co = urlParams.get('co');
  if (co && preset.controlSurface) {
    for (const pair of co.split(',')) {
      const colonIdx = pair.indexOf(':');
      if (colonIdx > 0) {
        const key = pair.substring(0, colonIdx);
        const valStr = pair.substring(colonIdx + 1);
        const num = Number(valStr);
        preset.controlSurface.offsets[key] = isNaN(num) ? valStr : num;
      }
    }
  }

  // Output pipeline
  const op = urlParams.get('op');
  if (op) {
    const pipeline = {};
    for (const part of op.split(',')) {
      const [k, v] = part.split('=');
      const num = Number(v);
      if (!isNaN(num)) {
        if (k === 'gc') pipeline.globalCurve = num;
        else if (k === 'sm') pipeline.smoothing = num;
        else if (k === 'sl') pipeline.slewRate = num;
      }
    }
    preset.outputPipeline = pipeline;
  }

  return preset;
}

// ---------------------------------------------------------------------------
// SessionPresetManager
// ---------------------------------------------------------------------------

export class SessionPresetManager {
  constructor() {
    this._presets = this._loadFromStorage();

    /**
     * Optional reference to an active ShapeSeq engine.
     * When set, save/load will include ShapeSeq state.
     * @private @type {import('../shapeseq/sequencer.js').ShapeSeqEngine|null}
     */
    this._shapeSeqEngine = null;

    /**
     * Lazy-loaded ShapeSeq session helpers.
     * @private @type {{ serializeShapeSeqState: Function, restoreShapeSeqState: Function }|null}
     */
    this._shapeSeqSession = null;
  }

  /**
   * Register a ShapeSeq engine so that save/load includes its state.
   * Call with null to unregister.
   *
   * @param {import('../shapeseq/sequencer.js').ShapeSeqEngine|null} engine
   */
  setShapeSeqEngine(engine) {
    this._shapeSeqEngine = engine;
    if (engine && !this._shapeSeqSession) {
      // Lazy-load the session helpers to avoid hard dependency
      import('../shapeseq/session.js').then(mod => {
        this._shapeSeqSession = mod;
      }).catch(() => {
        // ShapeSeq module not available — ignore silently
        this._shapeSeqSession = null;
      });
    }
  }

  /**
   * Capture a snapshot of the current full session state.
   *
   * @param {string} name — user-facing name for this preset
   * @param {object} state — current state from various subsystems
   * @param {object} state.controlSurface — result of ControlSurface.getState()
   * @param {string} state.synthPresetId — active synth preset ID
   * @param {Array}  state.groupOverrides — current group overrides
   * @param {object} state.inputPipeline — result of InputPipeline.getConfig()
   * @param {object} state.outputPipeline — result of OutputPipeline.getConfig()
   * @returns {object} the captured preset
   */
  capture(name, state) {
    const preset = {
      name,
      controlSurface: state.controlSurface || null,
      synthPresetId: state.synthPresetId || null,
      groupOverrides: state.groupOverrides || null,
      inputPipeline: state.inputPipeline || null,
      outputPipeline: state.outputPipeline || null,
      timestamp: Date.now(),
    };

    // Include ShapeSeq state when engine is registered
    if (this._shapeSeqEngine && this._shapeSeqSession) {
      preset.shapeseq = this._shapeSeqSession.serializeShapeSeqState(this._shapeSeqEngine);
    }

    return preset;
  }

  /**
   * Save current state as a named session preset to localStorage.
   *
   * @param {string} name
   * @param {object} state — same as capture() state param
   */
  save(name, state) {
    const preset = this.capture(name, state);
    this._presets[name] = preset;
    this._saveToStorage();
    return preset;
  }

  /**
   * Load a named session preset.
   *
   * If the preset contains a `shapeseq` key and a ShapeSeq engine is
   * registered, the ShapeSeq state is automatically restored. Presets
   * without a `shapeseq` key load fine (backward compatible).
   *
   * @param {string} name
   * @returns {object|null}
   */
  load(name) {
    const preset = this._presets[name] || null;
    if (preset && preset.shapeseq && this._shapeSeqEngine && this._shapeSeqSession) {
      this._shapeSeqSession.restoreShapeSeqState(this._shapeSeqEngine, preset.shapeseq);
    }
    return preset;
  }

  /**
   * List all saved session presets.
   * @returns {Array<{name: string, timestamp: number}>}
   */
  list() {
    return Object.values(this._presets)
      .map(p => ({ name: p.name, timestamp: p.timestamp }))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Delete a named session preset.
   * @param {string} name
   * @returns {boolean} true if deleted
   */
  delete(name) {
    if (name in this._presets) {
      delete this._presets[name];
      this._saveToStorage();
      return true;
    }
    return false;
  }

  /**
   * Encode a preset into URL search params for sharing.
   * @param {object} preset
   * @returns {string} URL search string (without leading ?)
   */
  toURL(preset) {
    return encodeToURL(preset);
  }

  /**
   * Decode a preset from URL search params.
   * @param {URLSearchParams} urlParams
   * @returns {object} partial preset
   */
  fromURL(urlParams) {
    return decodeFromURL(urlParams);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  _loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[SessionPresets] Failed to load:', e);
      return {};
    }
  }

  _saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._presets));
    } catch (e) {
      console.warn('[SessionPresets] Failed to save:', e);
    }
  }
}
