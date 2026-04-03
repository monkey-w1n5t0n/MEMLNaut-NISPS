// eoc-module.js — Base class for a single End-of-Chain effect module.
//
// All EOC effect modules extend this class. The contract mirrors the SynthEngine
// interface pattern (engine-interface.js) so both layers feel consistent.
//
// Subclasses MUST override:
//   get id()          — stable machine ID
//   get displayName() — human label
//   get paramMeta()   — [{id, name, min, max, init, curve, group}]
//   async init(audioCtx) — create AudioNodes, call super.init() first
//
// Subclasses MAY override:
//   setParam(index, normalizedValue)
//   dispose()
//
// Usage:
//   class ReverbModule extends EOCModule {
//     get id() { return 'reverb'; }
//     get displayName() { return 'Reverb'; }
//     get paramMeta() { return [...]; }
//     async init(audioCtx) {
//       await super.init(audioCtx);
//       // create effect nodes, wire between this._bypassIn → effect → this._bypassOut
//     }
//   }

export class EOCModule {
  constructor() {
    this._enabled    = true;
    this._audioCtx   = null;
    // Bypass graph nodes — allocated in init(), used by _applyBypass()
    this._bypassIn   = null;  // GainNode: input entry point
    this._bypassOut  = null;  // GainNode: output exit point
    this._bypassDry  = null;  // GainNode: direct input→output path when bypassed
    this._initialized = false;
    // Stored normalized param values — set via setParam(), read by getCurrentParamValue()
    this._paramValues = [];
  }

  // ---------------------------------------------------------------------------
  // Identity (override in subclass)
  // ---------------------------------------------------------------------------

  /**
   * Stable machine ID.
   * One of: 'eq' | 'compressor' | 'reverb' | 'delay' | 'saturation' | 'master'
   * @returns {string}
   */
  get id() {
    throw new Error(`${this.constructor.name}: id not implemented`);
  }

  /**
   * Human-readable label shown in the UI.
   * @returns {string}
   */
  get displayName() {
    throw new Error(`${this.constructor.name}: displayName not implemented`);
  }

  // ---------------------------------------------------------------------------
  // Enable / bypass
  // ---------------------------------------------------------------------------

  /**
   * Whether this module is active in the signal chain.
   * When false, audio passes directly from input to output (true bypass).
   * @returns {boolean}
   */
  get enabled() {
    return this._enabled;
  }

  /**
   * Toggle bypass. Reconnects the internal audio graph immediately.
   * @param {boolean} v
   */
  set enabled(v) {
    const changed = this._enabled !== !!v;
    this._enabled = !!v;
    if (changed && this._initialized) {
      this._applyBypass();
    }
  }

  // ---------------------------------------------------------------------------
  // Parameter schema (override in subclass)
  // ---------------------------------------------------------------------------

  /**
   * Number of continuous parameters this module exposes.
   * Derived automatically from paramMeta — override paramMeta, not this.
   * @returns {number}
   */
  get paramCount() {
    return this.paramMeta.length;
  }

  /**
   * Array of parameter descriptors, one per controllable parameter.
   *
   * Each entry must have:
   *   id     {string}  — stable machine ID (used for presets / NISPS routing)
   *   name   {string}  — short display name
   *   min    {number}  — raw minimum value (units depend on param)
   *   max    {number}  — raw maximum value
   *   init   {number}  — default normalized value [0, 1]
   *   curve  {number}  — power-curve bias: 0.5 = linear, <0.5 = log, >0.5 = exp
   *   group  {string}  — section label (for group drawer / colour coding)
   *
   * @returns {Array<{id:string, name:string, min:number, max:number, init:number, curve:number, group:string}>}
   */
  get paramMeta() {
    throw new Error(`${this.constructor.name}: paramMeta not implemented`);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Allocate AudioNodes and connect the internal graph.
   * Subclasses MUST call super.init(audioCtx) first, then wire their effect
   * nodes between this._bypassIn and this._bypassOut.
   *
   * @param {AudioContext} audioCtx
   * @returns {Promise<void>}
   */
  async init(audioCtx) {
    if (this._initialized) return;
    this._audioCtx = audioCtx;

    // Two GainNodes bracket the effect processing path.
    // A third (dry) provides a direct signal route for bypass.
    this._bypassIn  = audioCtx.createGain();
    this._bypassOut = audioCtx.createGain();
    this._bypassDry = audioCtx.createGain();

    // Wire the dry path (always present; gain toggled by _applyBypass)
    this._bypassIn.connect(this._bypassDry);
    this._bypassDry.connect(this._bypassOut);

    this._initialized = true;
    // Note: subclass connects its effect nodes, then calls _applyBypass()
    // via _finishInit() to set initial gain values correctly.
  }

  /**
   * Call from the end of a subclass init() once effect nodes are wired, to
   * apply the correct initial bypass state.
   *
   * Subclass pattern:
   *   async init(audioCtx) {
   *     await super.init(audioCtx);
   *     // ... wire effect nodes ...
   *     this._finishInit();
   *   }
   */
  _finishInit() {
    this._applyBypass();
  }

  /**
   * Disconnect all AudioNodes and release resources.
   * Override in subclasses to clean up effect-specific nodes.
   */
  dispose() {
    if (!this._initialized) return;
    try {
      this._bypassIn.disconnect();
      this._bypassOut.disconnect();
      this._bypassDry.disconnect();
    } catch (_) { /* already disconnected */ }
    this._initialized = false;
    this._audioCtx = null;
  }

  // ---------------------------------------------------------------------------
  // Real-time control
  // ---------------------------------------------------------------------------

  /**
   * Set a single parameter by index.
   *
   * @param {number} index           — 0-based index into paramMeta
   * @param {number} normalizedValue — [0, 1]
   */
  setParam(index, normalizedValue) { // eslint-disable-line no-unused-vars
    // Store the value so getCurrentParamValue() can read it back
    this._paramValues[index] = normalizedValue;
    // default no-op — override in subclass for actual audio effect
  }

  /**
   * Get the last normalized value set for a parameter.
   * Returns the param's init value (from paramMeta) if never explicitly set.
   *
   * @param {number} index — 0-based index into paramMeta
   * @returns {number} normalized value [0, 1]
   */
  getCurrentParamValue(index) {
    if (this._paramValues[index] !== undefined) {
      return this._paramValues[index];
    }
    const meta = this.paramMeta[index];
    return meta ? (meta.init ?? 0) : 0;
  }

  // ---------------------------------------------------------------------------
  // Audio graph
  // ---------------------------------------------------------------------------

  /**
   * The AudioNode that upstream sources should connect to.
   * Everything flows into this node.
   * @returns {AudioNode}
   */
  getInputNode() {
    return this._bypassIn;
  }

  /**
   * The AudioNode to connect downstream (to next module or destination).
   * Everything exits through this node.
   * @returns {AudioNode}
   */
  getOutputNode() {
    return this._bypassOut;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Apply bypass state to the internal audio graph.
   *
   * When enabled:
   *   - dry path (bypassIn → bypassOut) gain = 0
   *   - effect path is live (subclass manages its own nodes)
   *
   * When bypassed:
   *   - dry path gain = 1 (signal passes straight through)
   *   - effect processing gains are muted (subclass handles via _onBypassChange)
   *
   * Both _bypassIn and _bypassOut remain in the graph at all times so the
   * EOCChain's wiring never needs to change when bypass is toggled.
   */
  _applyBypass() {
    if (!this._bypassDry) return;
    const t = this._audioCtx.currentTime;
    if (this._enabled) {
      // Effect active: cut the dry path
      this._bypassDry.gain.setTargetAtTime(0, t, 0.005);
    } else {
      // Bypassed: open dry path
      this._bypassDry.gain.setTargetAtTime(1, t, 0.005);
    }
    // Let subclass mute/unmute its own effect nodes
    this._onBypassChange(this._enabled);
  }

  /**
   * Called by _applyBypass() after the dry-path gain is updated.
   * Subclasses should override to mute/unmute effect processing nodes.
   *
   * @param {boolean} enabled — true = effect active, false = bypassed
   */
  _onBypassChange(enabled) { // eslint-disable-line no-unused-vars
    // default no-op — override in subclass if effect has its own gain to manage
  }

  // ---------------------------------------------------------------------------
  // Utility: normalize a [0,1] value to the raw param range
  // ---------------------------------------------------------------------------

  /**
   * Convert a normalized [0,1] value to the raw range defined by paramMeta[index].
   * Applies the curve bias: value^(1/curve) gives log-like feel for small curve,
   * value^curve gives exp-like feel for large curve.
   *
   * @param {number} index
   * @param {number} normalizedValue [0, 1]
   * @returns {number} raw value in [min, max]
   */
  _denormalize(index, normalizedValue) {
    const meta = this.paramMeta[index];
    if (!meta) return 0;
    const { min, max, curve = 0.5 } = meta;
    // Apply power curve: curve=0.5 is linear, <0.5 pulls toward min, >0.5 toward max
    const shaped = Math.pow(Math.max(0, Math.min(1, normalizedValue)), curve === 0.5 ? 1 : 1 / (curve * 2));
    return min + shaped * (max - min);
  }
}
