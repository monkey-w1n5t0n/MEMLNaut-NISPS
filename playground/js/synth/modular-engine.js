/**
 * modular-engine.js — Phase B of the "Modular" audio mode.
 *
 * ModularEngine wraps one or more Faust sub-engines (subtractive, additive,
 * fm — additive/fm are Phase D) that share a common mod pool (16 ADSRs,
 * 32 LFOs) routed through a 48 × 10 modulation matrix. It presents a
 * unified SynthEngine interface to the rest of the playground.
 *
 * Phase B implements the `modular-subtractive` sub-engine only. The other
 * two slots are declared as stubs so Phase D can drop them in without
 * touching ModularEngine or a-app.js.
 *
 * Differences from other Faust engines:
 *   - Does NOT extend FaustEngineBase — it has its own worklet lifecycle
 *     because the modular processors need `uiJson` threaded through the
 *     init message (Faust 2.79 wasm builds don't export getJSON), and
 *     because sub-engine swapping requires disposing and re-initialising
 *     the worklet node.
 *   - paramMeta is NOT built with `faustJsonToParamMeta()`. Instead we
 *     walk the JSON ourselves, collect non-hidden leaf params in the
 *     SAME order the worklet's `_buildZoneIndexFromJson` walks them
 *     (that walk order defines the "NISPS index" = position in the
 *     worklet's `_paramZones` array), then assemble paramMeta in a
 *     curated order: mod-source params first, matrix cells second,
 *     engine sound params last (hidden from MLP by default, exposable
 *     via Phase C UI).
 *
 * Each paramMeta entry carries a `faustIndex` field that is the worklet's
 * NISPS index (position in `_paramZones`), not the raw memory-offset
 * `index` field from the Faust JSON. `setParam(i, normValue)` sends
 * `{ type:'setParam', index: faustIndex, value: raw }` to the worklet,
 * and the processor's `_onSetParam` does the zone lookup.
 */

import { SynthEngine } from './engine-interface.js';

// -----------------------------------------------------------------------------
// Sub-engine registry
// -----------------------------------------------------------------------------
//
// Each entry describes one Faust sub-engine that can back ModularEngine.
// Only `subtractive` is active in Phase B; `additive` and `fm` are stubs
// reserved for Phase D.
//
// destNames is the ordered list of modulation destinations, matching
// Matrix/s<src>_d<dst>_<name> labels in the Faust JSON. Index into this
// array == the `d<NN>` suffix in the matrix labels.

const SUB_ENGINES = {
  subtractive: {
    id:            'modular-subtractive',
    displayName:   'Subtractive (3-osc)',
    wasmUrl:       'faust/modular-subtractive.wasm',
    jsonUrl:       'faust/modular-subtractive.json',
    workletUrl:    'faust/modular-subtractive-processor.js',
    processorName: 'modular-subtractive-processor',
    destCount:     10,
    destNames: [
      'pitch', 'osc2_detune', 'osc3_detune', 'osc_mix_bal', 'noise_level',
      'cutoff', 'resonance', 'filter_env_amt', 'amp', 'pan',
    ],
    // Top-level group labels that hold the engine's sound params (the
    // pieces that aren't mod pool / matrix / hidden). These map into
    // paramMeta when setEngineParamExposed() opts them in.
    soundGroupPrefixes: ['1_Oscillators', '2_Mixer', '3_Filter', '4_Master'],
  },
  additive: {
    id:            'modular-additive',
    displayName:   'Additive (64-partial)',
    wasmUrl:       'faust/modular-additive.wasm',
    jsonUrl:       'faust/modular-additive.json',
    workletUrl:    'faust/modular-additive-processor.js',
    processorName: 'modular-additive-processor',
    destCount:     10,
    destNames: [
      'pitch', 'bright', 'tilt', 'inharmonicity', 'odd_even',
      'formant_ctr', 'formant_depth', 'noise_mix', 'amp', 'pan',
    ],
    soundGroupPrefixes: ['1_Spectral', '2_Formants', '3_Master'],
  },
  fm: {
    id:            'modular-fm',
    displayName:   'FM (4-op matrix)',
    wasmUrl:       'faust/modular-fm.wasm',
    jsonUrl:       'faust/modular-fm.json',
    workletUrl:    'faust/modular-fm-processor.js',
    processorName: 'modular-fm-processor',
    destCount:     10,
    destNames: [
      'pitch', 'op1_level', 'op2_level', 'op3_level', 'op4_level',
      'cross_mod_global', 'feedback_global', 'global_ratio', 'amp', 'pan',
    ],
    soundGroupPrefixes: ['1_Operators', '2_CrossMod', '3_Feedback', '4_Master'],
  },
};

// Number of ADSR / LFO slots exposed to the MLP by default. The Faust DSP
// always compiles 16 ADSR + 32 LFO slots; the first N of each are what the
// MLP can drive, the rest are user-set-only (enable=0 by default).
const DEFAULT_ADSR_COUNT = 4;
const DEFAULT_LFO_COUNT  = 8;

// Per-source params driven by the MLP (enable is excluded — it's a
// discrete flag, poor target for continuous output).
const ADSR_MLP_PARAMS = ['attack', 'decay', 'sustain', 'release'];
const LFO_MLP_PARAMS  = ['rate', 'morph'];

// -----------------------------------------------------------------------------

export class ModularEngine extends SynthEngine {
  // Processor names we've already registered via _registerCombinedWorklet.
  // Shared across all ModularEngine instances since AudioWorklet deduplicates
  // processor names per AudioContext; double-registering throws.
  static _registeredProcessors = new Set();

  constructor() {
    super();

    this._activeSubId  = 'subtractive';  // keyword into SUB_ENGINES
    this._subCfg       = SUB_ENGINES[this._activeSubId];

    // How many ADSR / LFO slots the MLP-facing paramMeta will contain.
    // Can be changed at runtime via setModSourceCount().
    this._adsrCount    = DEFAULT_ADSR_COUNT;
    this._lfoCount     = DEFAULT_LFO_COUNT;

    this._audioCtx     = null;
    this._workletNode  = null;
    this._masterGain   = null;
    this._outputNode   = null;
    this._running      = false;
    this._onReady      = null;

    // Parsed Faust JSON of the active sub-engine.
    this._faustJson    = null;

    // Walk-order index maps. _walkEntries[i] is the ith non-hidden leaf
    // param in the UI-tree walk — the same i that the worklet uses as
    // its zone index.
    this._walkEntries  = [];               // [{ label, path, min, max, init, nispsIndex }]
    this._labelToWalk  = new Map();        // label -> walk entry

    // MLP-facing paramMeta (ordered: ADSR → LFO → Matrix → optional sound).
    this._paramMeta    = [];

    // Exposure toggles (Phase C hooks).
    this._exposedEngineParams = new Set(); // label strings

    // Matrix cell exposure: keys are "sXX_dYY" strings. Default-empty —
    // matrix routing is a "patch" setting (user-configured once) rather
    // than a "performance" surface (wiggled by the MLP). Users can opt in
    // individual cells via the modular UI; each opt-in triggers a
    // paramMeta:change event and an MLP resize.
    this._exposedMatrixCells = new Set();

    // Most-recent raw value written to each DSP label (by _setRawByLabel
    // or setParam). Used by getState() to snapshot current DSP values
    // without round-tripping through the worklet. Cleared on sub-engine
    // swap since labels are sub-engine-specific.
    this._lastRawByLabel = new Map();      // label -> rawValue

    // Event listeners.
    this._listeners    = new Map();        // type -> Set<fn>
  }

  // ---------------------------------------------------------------------------
  // SynthEngine identity
  // ---------------------------------------------------------------------------

  get id()          { return 'modular'; }
  get displayName() { return 'Modular'; }
  get paramMeta()   { return this._paramMeta; }

  /** Id of the currently active Faust sub-engine (e.g. 'subtractive'). */
  get activeSubEngineId() { return this._activeSubId; }

  /** List of sub-engine ids that are currently implemented. */
  get availableSubEngines() {
    return Object.keys(SUB_ENGINES);
  }

  /** Destination names for the active sub-engine (matrix column headers). */
  get destNames() {
    return this._subCfg?.destNames?.slice() ?? [];
  }

  /**
   * List of Faust labels for the active sub-engine's sound params — i.e.
   * leaf params under any of `soundGroupPrefixes`. Used by the modular UI
   * to populate the "expose to MLP" checkbox list.
   */
  getEngineSoundParamLabels() {
    const prefixes = this._subCfg?.soundGroupPrefixes ?? [];
    if (prefixes.length === 0) return [];
    const out = [];
    for (const entry of this._walkEntries) {
      const label = entry.label;
      if (!label) continue;
      if (prefixes.some(p => label.startsWith(p + '/'))) {
        out.push({
          label,
          min:  entry.min,
          max:  entry.max,
          init: entry.init,
        });
      }
    }
    return out;
  }

  /** True if a given engine sound param is currently exposed to the MLP. */
  isEngineParamExposed(label) {
    return this._exposedEngineParams.has(label);
  }

  /** Snapshot of the currently exposed engine sound param labels. */
  getExposedEngineParams() {
    return [...this._exposedEngineParams];
  }

  // ---------------------------------------------------------------------------
  // Phase E — full state snapshot / restore
  // ---------------------------------------------------------------------------

  /**
   * Capture a full raw-DSP snapshot suitable for `setState()`. Walks every
   * non-hidden leaf param discovered by `_walkFaustJson()` and records its
   * current value either from the live worklet (by label lookup) or from
   * `_pendingByLabel` / init defaults if the worklet isn't running yet.
   *
   * Shape:
   *   {
   *     version: 1,
   *     subEngine:           'subtractive',
   *     adsrCount, lfoCount,
   *     exposedEngineParams: ['3_Filter/00_cutoff', ...],
   *     dsp: { [label]: rawValue, ... },
   *   }
   */
  getState() {
    const dsp = {};
    for (const entry of this._walkEntries) {
      const label = entry.label;
      if (!label) continue;
      let v;
      if (this._lastRawByLabel.has(label)) {
        v = this._lastRawByLabel.get(label);
      } else {
        v = entry.init;
      }
      dsp[label] = v;
    }
    return {
      version: 1,
      subEngine:           this._activeSubId,
      adsrCount:           this._adsrCount,
      lfoCount:            this._lfoCount,
      exposedEngineParams: [...this._exposedEngineParams],
      dsp,
    };
  }

  /**
   * Restore a snapshot produced by `getState()`.
   *
   * Steps:
   *   1. Validates `version` (currently only 1 is supported).
   *   2. Swaps sub-engine if different (awaits the worklet swap; the swap
   *      reapplies the default patch first, which we then overwrite).
   *   3. Sets adsrCount / lfoCount via `setModSourceCount`.
   *   4. Restores `_exposedEngineParams`.
   *   5. Writes every `dsp[label]` to the worklet via `_setRawByLabel`.
   *      Unknown labels (e.g. from a sub-engine snapshot that's been re-saved
   *      against a different sub-engine) are silently skipped.
   *   6. Rebuilds paramMeta and emits `paramMeta:change` exactly once.
   *
   * Emits `paramMeta:change` at the end.
   */
  async setState(state) {
    if (!state || typeof state !== 'object') return;
    if (state.version != null && state.version !== 1) {
      console.warn(`[ModularEngine] setState: unknown version ${state.version}, skipping`);
      return;
    }

    // 1. Sub-engine swap (async — reloads JSON, reinstantiates worklet if running)
    if (typeof state.subEngine === 'string' &&
        state.subEngine !== this._activeSubId &&
        SUB_ENGINES[state.subEngine]) {
      try {
        await this.setSubEngine(state.subEngine);
      } catch (err) {
        console.warn('[ModularEngine] setState: setSubEngine failed', err);
      }
    }

    // 2. Mod source counts. Don't call setModSourceCount() directly because
    //    it rebuilds paramMeta and fires paramMeta:change — we want exactly
    //    one rebuild at the very end.
    if (typeof state.adsrCount === 'number') {
      this._adsrCount = Math.max(1, Math.min(16, state.adsrCount | 0));
    }
    if (typeof state.lfoCount === 'number') {
      this._lfoCount = Math.max(1, Math.min(32, state.lfoCount | 0));
    }

    // 3. Exposed engine sound params
    if (Array.isArray(state.exposedEngineParams)) {
      this._exposedEngineParams = new Set(
        state.exposedEngineParams.filter(l => typeof l === 'string' && this._labelToWalk.has(l))
      );
    }

    // 4. Raw DSP values. Only write labels the active sub-engine knows about.
    //    If the engine isn't running yet, _setRawByLabel is a no-op — but
    //    we still record the value in _lastRawByLabel so a later getState()
    //    sees it, and so that once init() runs _applyDefaultPatch we can
    //    replay through the pending path.
    if (state.dsp && typeof state.dsp === 'object') {
      for (const [label, rawVal] of Object.entries(state.dsp)) {
        if (typeof rawVal !== 'number') continue;
        if (!this._labelToWalk.has(label)) continue;
        this._setRawByLabel(label, rawVal);
      }
    }

    // 5. Single paramMeta rebuild + event emission.
    this._rebuildParamMeta();
    this._emit('paramMeta:change', { engine: this });
  }

  /**
   * Re-apply the Phase B default patch. Exposed so preset code can reset
   * to a known baseline before layering a preset on top. Safe to call
   * before or after init() — pre-init it just updates the _lastRawByLabel
   * bookkeeping.
   */
  resetToDefaults() {
    this._applyDefaultPatch();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Load the default sub-engine's JSON so paramCount is known before init().
   * Safe to call multiple times.
   *
   * Also seeds `_lastRawByLabel` with the Phase B default patch values so
   * that `getState()` returns a meaningful snapshot before audio has been
   * started. Without this the snapshot reports raw DSP init values (0 for
   * most matrix cells), which is technically correct pre-init but is
   * surprising — the default patch is a property of the engine, not of
   * the worklet lifecycle.
   */
  async loadParamMeta() {
    if (this._paramMeta.length > 0) return;
    await this._loadSubEngineJson(this._activeSubId);
    this._rebuildParamMeta();
    this._applyDefaultPatch();
  }

  /**
   * Initialise the engine: load the active sub-engine, register the worklet,
   * create the node, apply the default patch.
   */
  async init(audioCtx) {
    if (this._running) return;
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    this._audioCtx = audioCtx;

    if (!this._faustJson) {
      await this._loadSubEngineJson(this._activeSubId);
      this._rebuildParamMeta();
    }

    await this._instantiateWorklet();
    this._applyDefaultPatch();
    this._running = true;
  }

  /** Release all resources. */
  dispose() {
    this._teardownWorklet();
    this._running = false;
    this._audioCtx = null;
  }

  getOutputNode() { return this._outputNode; }

  /** Convenience: set master gain (wired to the volume slider in a-app.js). */
  setMasterVolume(value) {
    if (this._masterGain && this._audioCtx) {
      this._masterGain.gain.setTargetAtTime(value, this._audioCtx.currentTime, 0.01);
    }
  }

  /** Mirror FaustEngineBase.stop()/start() for hot-pause on the audio button. */
  async stop() {
    if (this._masterGain && this._audioCtx) {
      this._masterGain.gain.setTargetAtTime(0, this._audioCtx.currentTime, 0.01);
    }
    this._running = false;
  }
  async start() {
    if (this._masterGain && this._audioCtx) {
      this._masterGain.gain.setTargetAtTime(0.7, this._audioCtx.currentTime, 0.01);
    }
    this._running = true;
  }

  // ---------------------------------------------------------------------------
  // Real-time control
  // ---------------------------------------------------------------------------

  setParam(index, normalizedValue) {
    const meta = this._paramMeta[index];
    if (!meta) return;
    const raw = meta.min + normalizedValue * (meta.max - meta.min);
    // Record the write so getState() can see it even if no worklet yet.
    if (meta.label) this._lastRawByLabel.set(meta.label, raw);
    if (!this._workletNode) return;
    this._workletNode.port.postMessage({
      type:  'setParam',
      index: meta.faustIndex,
      value: raw,
    });
  }

  noteOn(note, vel = 0.7) {
    if (!this._workletNode) return;
    const freq = 440 * Math.pow(2, (note - 69) / 12);
    this._workletNode.port.postMessage({ type: 'noteOn', freq, vel });
  }

  noteOff(note) {
    if (!this._workletNode) return;
    const freq = 440 * Math.pow(2, (note - 69) / 12);
    this._workletNode.port.postMessage({ type: 'noteOff', freq });
  }

  // ---------------------------------------------------------------------------
  // Phase C hooks (public API the modular UI will call)
  // ---------------------------------------------------------------------------

  /**
   * Swap the active Faust sub-engine. Rebuilds paramMeta and emits
   * 'paramMeta:change' so a-app.js can resize the MLP.
   *
   * @param {string} id  Key into SUB_ENGINES (e.g. 'subtractive').
   */
  async setSubEngine(id) {
    if (!SUB_ENGINES[id]) {
      throw new Error(`[ModularEngine] Unknown sub-engine: ${id}`);
    }
    if (id === this._activeSubId && this._running) return;

    const wasRunning = this._running;
    this._teardownWorklet();
    this._running = false;

    this._activeSubId = id;
    this._subCfg = SUB_ENGINES[id];
    this._faustJson = null;
    this._exposedEngineParams.clear();
    this._exposedMatrixCells.clear();
    this._lastRawByLabel.clear();

    await this._loadSubEngineJson(id);
    this._rebuildParamMeta();
    // Seed default-patch values even if the worklet isn't running — keeps
    // getState() consistent with loadParamMeta()'s post-condition.
    this._applyDefaultPatch();

    if (wasRunning && this._audioCtx) {
      await this._instantiateWorklet();
      this._applyDefaultPatch();
      this._running = true;
    }
    this._emit('paramMeta:change', { engine: this });
  }

  /**
   * Opt a specific engine sound param into the MLP-controllable set.
   * Rebuilds paramMeta and fires 'paramMeta:change'.
   *
   * @param {string}  label    Full Faust label, e.g. '3_Filter/00_cutoff'.
   * @param {boolean} exposed  true to expose, false to hide.
   */
  setExposeEngineParam(label, exposed) {
    if (!this._labelToWalk.has(label)) return;
    const had = this._exposedEngineParams.has(label);
    if (exposed && !had) this._exposedEngineParams.add(label);
    else if (!exposed && had) this._exposedEngineParams.delete(label);
    else return;
    this._rebuildParamMeta();
    this._emit('paramMeta:change', { engine: this });
  }

  /**
   * Opt a single matrix cell into (or out of) the MLP-driven paramMeta.
   * When `exposed` is true, the cell joins the MLP output vector and its
   * value is driven by inference every tick. When false, it stays at
   * whatever raw value the worklet currently holds (e.g. from the default
   * patch or the user's direct edits).
   *
   * @param {number} s   0..47 source index
   * @param {number} d   0..9 destination index
   * @param {boolean} exposed
   */
  setExposeMatrixCell(s, d, exposed) {
    const key = `s${String(s).padStart(2, '0')}_d${String(d).padStart(2, '0')}`;
    const had = this._exposedMatrixCells.has(key);
    if (exposed && !had) this._exposedMatrixCells.add(key);
    else if (!exposed && had) this._exposedMatrixCells.delete(key);
    else return;
    this._rebuildParamMeta();
    this._emit('paramMeta:change', { engine: this });
  }

  /** Snapshot of currently-exposed matrix cell keys (e.g. "s00_d08"). */
  getExposedMatrixCells() {
    return [...this._exposedMatrixCells];
  }

  /**
   * Return a Float32Array of length paramCount holding the normalised
   * [0,1] default value for each paramMeta entry — reading from
   * _lastRawByLabel if the user has set a value, otherwise from the
   * walk-entry init. Used by the app's cold-start bias shift so an
   * untrained MLP output of 0.5 still reproduces the default patch.
   */
  getDefaultNormalizedOutputs() {
    const out = new Float32Array(this._paramMeta.length);
    for (let i = 0; i < this._paramMeta.length; i++) {
      const m = this._paramMeta[i];
      const range = (m.max - m.min) || 1;
      const raw = this._lastRawByLabel.has(m.label)
        ? this._lastRawByLabel.get(m.label)
        : (this._labelToWalk.get(m.label)?.init ?? m.min);
      out[i] = Math.max(0, Math.min(1, (raw - m.min) / range));
    }
    return out;
  }

  /**
   * Change how many ADSR / LFO slots appear in paramMeta. Rebuilds paramMeta
   * and emits 'paramMeta:change' so a-app.js resizes the MLP. Slots past the
   * new counts remain alive in the Faust DSP (always 16 + 32 exist) but are
   * no longer MLP-driven; the UI is expected to disable those slots via the
   * per-slot enable flag if it wants them silent.
   *
   * @param {number} adsrCount  1..16
   * @param {number} lfoCount   1..32
   */
  setModSourceCount(adsrCount, lfoCount) {
    adsrCount = Math.max(1, Math.min(16, adsrCount | 0));
    lfoCount  = Math.max(1, Math.min(32, lfoCount  | 0));
    if (adsrCount === this._adsrCount && lfoCount === this._lfoCount) return;
    this._adsrCount = adsrCount;
    this._lfoCount  = lfoCount;
    this._rebuildParamMeta();
    this._emit('paramMeta:change', { engine: this });
  }

  /** Current MLP-facing ADSR slot count. */
  get adsrCount() { return this._adsrCount; }

  /** Current MLP-facing LFO slot count. */
  get lfoCount()  { return this._lfoCount; }

  /** Subscribe to a custom event ('paramMeta:change'). Returns unsubscribe fn. */
  on(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(handler);
    return () => this.off(type, handler);
  }

  off(type, handler) {
    this._listeners.get(type)?.delete(handler);
  }

  _emit(type, detail) {
    const set = this._listeners.get(type);
    if (!set) return;
    for (const fn of set) {
      try { fn(detail); } catch (err) { console.error(`[ModularEngine:${type}]`, err); }
    }
  }

  // ---------------------------------------------------------------------------
  // Internals — JSON walking + paramMeta construction
  // ---------------------------------------------------------------------------

  async _loadSubEngineJson(subId) {
    const cfg = SUB_ENGINES[subId];
    if (!cfg) throw new Error(`[ModularEngine] Unknown sub-engine: ${subId}`);

    const resp = await fetch(cfg.jsonUrl);
    if (!resp.ok) {
      throw new Error(`[ModularEngine] Failed to fetch ${cfg.jsonUrl}: ${resp.status}`);
    }
    this._faustJson = await resp.json();
    this._walkFaustJson();
  }

  /**
   * Walk the Faust UI tree in the SAME order the worklet's
   * _buildZoneIndexFromJson walks it, skipping hidden params. The position
   * in the resulting list is the NISPS index = the zone argument the
   * worklet passes to setParamValue.
   */
  _walkFaustJson() {
    const HIDDEN_TAIL = new Set(['freq', 'gate', '_vel']);
    const entries = [];
    const byLabel = new Map();

    const walk = (items, path) => {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        const type = item?.type;
        if (type === 'hslider' || type === 'vslider' ||
            type === 'nentry'  || type === 'button' ||
            type === 'checkbox') {
          const label = item.label ?? '';
          const idx = item.index;
          if (typeof idx !== 'number') continue;

          const hasHiddenMeta = Array.isArray(item.meta) &&
            item.meta.some(m => m.hidden === '1' || m.hidden === 1);
          const tail = label.includes('/') ? label.split('/').pop() : label;
          if (hasHiddenMeta || HIDDEN_TAIL.has(tail)) continue;

          const entry = {
            label,
            path: path + '/' + label,
            min:  typeof item.min  === 'number' ? item.min  : 0,
            max:  typeof item.max  === 'number' ? item.max  : 1,
            init: typeof item.init === 'number' ? item.init : 0,
            nispsIndex: entries.length,  // walk-order index
          };
          entries.push(entry);
          byLabel.set(label, entry);
        } else if (item?.items) {
          walk(item.items, path + '/' + (item.label ?? ''));
        }
      }
    };

    walk(this._faustJson?.ui ?? [], '');
    this._walkEntries = entries;
    this._labelToWalk = byLabel;
  }

  /**
   * Build the MLP-facing paramMeta from the walk entries. Ordering:
   *   1. Mod source params  (ADSR A/D/S/R × DEFAULT_ADSR_COUNT,
   *                          LFO rate/morph × DEFAULT_LFO_COUNT)
   *   2. Matrix cells       (all 48 × destCount, dest-major,
   *                          source-major within each destination)
   *   3. Opted-in engine sound params (empty by default)
   */
  _rebuildParamMeta() {
    const cfg = this._subCfg;
    const meta = [];

    // ----- 1. Mod sources -----
    for (let i = 0; i < this._adsrCount; i++) {
      const prefix = `MM_ADSR/${String(i).padStart(2, '0')}_adsr${String(i + 1).padStart(2, '0')}`;
      for (const suffix of ADSR_MLP_PARAMS) {
        const label = `${prefix}_${suffix}`;
        const e = this._labelToWalk.get(label);
        if (!e) continue;
        meta.push(this._makeMetaEntry(e, {
          id:    `adsr${i + 1}_${suffix}`,
          name:  `${cap(suffix)}`,
          group: `ADSR ${i + 1}`,
        }));
      }
    }
    for (let i = 0; i < this._lfoCount; i++) {
      const prefix = `MM_LFO/${String(i).padStart(2, '0')}_lfo${String(i + 1).padStart(2, '0')}`;
      for (const suffix of LFO_MLP_PARAMS) {
        const label = `${prefix}_${suffix}`;
        const e = this._labelToWalk.get(label);
        if (!e) continue;
        meta.push(this._makeMetaEntry(e, {
          id:    `lfo${i + 1}_${suffix}`,
          name:  `${cap(suffix)}`,
          group: `LFO ${i + 1}`,
        }));
      }
    }

    // ----- 2. Matrix cells — always in paramMeta (dest-major, source-major) -----
    for (let d = 0; d < cfg.destCount; d++) {
      const destName = cfg.destNames[d];
      for (let s = 0; s < 48; s++) {
        const label = `MM_Matrix/s${String(s).padStart(2, '0')}_d${String(d).padStart(2, '0')}_${destName}`;
        const e = this._labelToWalk.get(label);
        if (!e) continue;
        meta.push(this._makeMetaEntry(e, {
          id:    `mm_s${s}_d${d}_${destName}`,
          name:  `s${String(s).padStart(2, '0')} \u2192 ${destName}`,
          group: `Matrix/${destName}`,
        }));
      }
    }

    // ----- 3. Opted-in engine sound params -----
    for (const label of this._exposedEngineParams) {
      const e = this._labelToWalk.get(label);
      if (!e) continue;
      const [group, leaf] = splitLabel(label);
      meta.push(this._makeMetaEntry(e, {
        id:    slugify(label),
        name:  stripIndexPrefix(leaf),
        group: group || 'Sound',
      }));
    }

    this._paramMeta = meta;
  }

  _makeMetaEntry(walkEntry, over) {
    const range = (walkEntry.max - walkEntry.min) || 1;
    const initNorm = Math.max(0, Math.min(1,
      (walkEntry.init - walkEntry.min) / range));
    return {
      id:         over.id,
      name:       over.name,
      min:        walkEntry.min,   // raw units (FaustEngineBase convention)
      max:        walkEntry.max,
      init:       initNorm,        // normalised 0..1
      curve:      0.5,
      group:      over.group,
      faustIndex: walkEntry.nispsIndex,
      label:      walkEntry.label, // kept for debugging and Phase C wiring
    };
  }

  // ---------------------------------------------------------------------------
  // Worklet lifecycle
  // ---------------------------------------------------------------------------

  async _instantiateWorklet() {
    const cfg = this._subCfg;
    const audioCtx = this._audioCtx;

    // Fetch WASM binary.
    const wasmResp = await fetch(cfg.wasmUrl);
    if (!wasmResp.ok) {
      throw new Error(`[ModularEngine] Failed to fetch ${cfg.wasmUrl}: ${wasmResp.status}`);
    }
    const wasmBytes = await wasmResp.arrayBuffer();

    // Register the worklet. In practice Chrome's AudioWorkletGlobalScope
    // isolates classes declared at the top of separate addModule() scripts
    // (contrary to the spec's "shared global" phrasing), so a base class
    // defined in faust-worklet-processor.js is not visible when a subclass
    // script is loaded via a second addModule() call. To sidestep this we
    // fetch both files, concatenate them, and addModule() a single blob URL
    // — the base class and subclass end up in one script evaluation.
    await this._registerCombinedWorklet(audioCtx, cfg.workletUrl);

    this._workletNode = new AudioWorkletNode(audioCtx, cfg.processorName, {
      numberOfInputs:    0,
      numberOfOutputs:   1,
      outputChannelCount: [2],
    });
    this._workletNode.port.onmessage = (e) => this._handleWorkletMsg(e.data);

    // Build the audio graph.
    this._masterGain = audioCtx.createGain();
    this._masterGain.gain.value = 0.7;
    this._workletNode.connect(this._masterGain);
    this._masterGain.connect(audioCtx.destination);
    this._outputNode = this._masterGain;

    // Send the init message — uiJson is passed as a parsed object.
    this._workletNode.port.postMessage({
      type:       'init',
      wasmBytes,
      sampleRate: audioCtx.sampleRate,
      uiJson:     this._faustJson,
    }, [wasmBytes]);

    await this._waitForReady(10_000);
  }

  /**
   * Fetch faust-worklet-processor.js (base class) and the sub-engine's
   * processor file, concatenate them, and addModule() the result as one
   * blob. Cached per processor name so repeated sub-engine swaps don't
   * re-register.
   *
   * Chrome has deduped addModule() by URL in the past, so a blob URL with
   * a fresh identity each call is safe but slightly wasteful; we memoise
   * on processorName to keep things tidy.
   */
  async _registerCombinedWorklet(audioCtx, workletUrl) {
    const name = this._subCfg.processorName;
    if (ModularEngine._registeredProcessors.has(name)) return;

    const [baseSrc, subSrc] = await Promise.all([
      fetch('faust/faust-worklet-processor.js').then(r => {
        if (!r.ok) throw new Error(`base worklet fetch failed: ${r.status}`);
        return r.text();
      }),
      fetch(workletUrl).then(r => {
        if (!r.ok) throw new Error(`sub worklet fetch failed: ${r.status}`);
        return r.text();
      }),
    ]);

    const combined = baseSrc + '\n' + subSrc;
    const blob = new Blob([combined], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      await audioCtx.audioWorklet.addModule(blobUrl);
      ModularEngine._registeredProcessors.add(name);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  _teardownWorklet() {
    if (this._masterGain) {
      try { this._masterGain.disconnect(); } catch (_) { /* ignore */ }
      this._masterGain = null;
    }
    if (this._workletNode) {
      try { this._workletNode.disconnect(); } catch (_) { /* ignore */ }
      this._workletNode.port.onmessage = null;
      this._workletNode = null;
    }
    this._outputNode = null;
  }

  _handleWorkletMsg(data) {
    if (!data) return;
    if (data.type === 'ready') {
      this._onReady?.();
    } else if (data.type === 'error') {
      console.error(`[ModularEngine:${this._activeSubId}] worklet error:`, data.message);
    }
  }

  _waitForReady(timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._onReady = null;
        reject(new Error(`[ModularEngine] Timed out waiting for worklet ready`));
      }, timeoutMs);
      this._onReady = () => {
        clearTimeout(timer);
        this._onReady = null;
        resolve();
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Default patch
  // ---------------------------------------------------------------------------

  /**
   * Write raw values directly to the worklet by Faust label, bypassing
   * paramMeta. Used for the default patch, which includes params NOT in
   * paramMeta (e.g. `enable` flags, engine sound defaults).
   */
  _setRawByLabel(label, rawValue) {
    // Always record the intent, even if the worklet isn't up yet — getState()
    // reads from this map. The value will be re-applied when the worklet
    // next runs _applyDefaultPatch() or when the caller explicitly replays
    // state after init().
    this._lastRawByLabel.set(label, rawValue);
    if (!this._workletNode) return;
    this._workletNode.port.postMessage({ type: 'setByLabel', label, value: rawValue });
  }

  /**
   * Apply the Phase B default patch so the first noteOn produces sound.
   *
   * Strategy: ADSR 1 → amp at full depth, reasonable ADSR 1 envelope,
   * osc1 up, osc2/3 silent, filter fully open, master level 0.7.
   * Everything else the .dsp file already has sane defaults for.
   */
  _applyDefaultPatch() {
    // ADSR 1 — amplifier envelope
    this._setRawByLabel('MM_ADSR/00_adsr01_enable',  1.0);
    this._setRawByLabel('MM_ADSR/00_adsr01_attack',  0.01);
    this._setRawByLabel('MM_ADSR/00_adsr01_decay',   0.2);
    this._setRawByLabel('MM_ADSR/00_adsr01_sustain', 0.7);
    this._setRawByLabel('MM_ADSR/00_adsr01_release', 0.3);

    // Matrix: s00 (adsr01) → d08 (amp), depth 1.0
    this._setRawByLabel('MM_Matrix/s00_d08_amp', 1.0);

    // Engine sound defaults (subtractive-specific)
    if (this._activeSubId === 'subtractive') {
      this._setRawByLabel('3_Filter/00_cutoff',         3000);
      this._setRawByLabel('3_Filter/01_resonance',      0.2);
      this._setRawByLabel('1_Oscillators/02_osc1_level', 0.8);
      this._setRawByLabel('1_Oscillators/06_osc2_level', 0.0);
      this._setRawByLabel('1_Oscillators/10_osc3_level', 0.0);
      this._setRawByLabel('4_Master/00_master_level',   0.7);
    }
  }
}

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function splitLabel(label) {
  const i = label.lastIndexOf('/');
  if (i < 0) return ['', label];
  return [label.slice(0, i), label.slice(i + 1)];
}

function stripIndexPrefix(leaf) {
  // Strip the leading "NN_" numeric prefix Faust uses to force UI ordering,
  // e.g. "00_osc1_wave" → "osc1_wave".
  return leaf.replace(/^\d+_/, '');
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
