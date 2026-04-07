/**
 * eoc-module.ts — Base class for a single End-of-Chain effect module.
 *
 * All EOC effect modules extend this class. The interface mirrors the SynthEngine
 * pattern so both layers feel consistent throughout the codebase.
 *
 * Subclasses MUST override:
 *   get id()          — stable machine ID
 *   get displayName() — human label
 *   get paramMeta()   — array of ParamMeta descriptors
 *   async init(audioCtx) — create AudioNodes, call super.init() first
 *
 * Subclasses MAY override:
 *   setParam(index, normalizedValue)
 *   dispose()
 *   _onBypassChange(enabled)
 *
 * Usage:
 *   class ReverbModule extends EOCModule {
 *     get id() { return 'reverb'; }
 *     get displayName() { return 'Reverb'; }
 *     get paramMeta() { return [...]; }
 *     async init(audioCtx: AudioContext) {
 *       await super.init(audioCtx);
 *       // create effect nodes, wire between this._bypassIn → effect → this._bypassOut
 *       this._finishInit();
 *     }
 *   }
 */

import type { ParamMeta } from '../synth/engine-interface.js';

export type { ParamMeta };

// ---------------------------------------------------------------------------
// EOCModule
// ---------------------------------------------------------------------------

export abstract class EOCModule {
  protected _enabled: boolean = true;
  protected _audioCtx: AudioContext | null = null;

  /** Input entry point — upstream sources connect here. */
  protected _bypassIn: GainNode | null = null;
  /** Output exit point — downstream sinks connect here. */
  protected _bypassOut: GainNode | null = null;
  /** Direct input→output path: gain=1 when bypassed, gain=0 when active. */
  protected _bypassDry: GainNode | null = null;

  protected _initialized: boolean = false;

  /** Stored normalized param values indexed by param position. */
  protected _paramValues: number[] = [];

  // ---------------------------------------------------------------------------
  // Identity (must be overridden in subclass)
  // ---------------------------------------------------------------------------

  /**
   * Stable machine ID.
   * One of: 'eq' | 'compressor' | 'reverb' | 'delay' | 'saturation' | 'master'
   */
  abstract get id(): string;

  /** Human-readable label shown in the UI. */
  abstract get displayName(): string;

  // ---------------------------------------------------------------------------
  // Enable / bypass
  // ---------------------------------------------------------------------------

  /**
   * Whether this module is active in the signal chain.
   * When false, audio passes directly from input to output (true bypass).
   */
  get enabled(): boolean {
    return this._enabled;
  }

  /**
   * Toggle bypass. Reconnects the internal audio graph immediately.
   */
  set enabled(v: boolean) {
    const changed = this._enabled !== !!v;
    this._enabled = !!v;
    if (changed && this._initialized) {
      this._applyBypass();
    }
  }

  // ---------------------------------------------------------------------------
  // Parameter schema (must be overridden in subclass)
  // ---------------------------------------------------------------------------

  /**
   * Array of parameter descriptors, one per controllable parameter.
   *
   * Each entry must have:
   *   id     — stable machine ID (used for presets / NISPS routing)
   *   name   — short display name
   *   min    — raw minimum value (units depend on param)
   *   max    — raw maximum value
   *   init   — default normalized value [0, 1]
   *   curve  — power-curve bias: 0.5 = linear, <0.5 = log, >0.5 = exp
   *   group  — section label (for group drawer / colour coding)
   */
  abstract get paramMeta(): ParamMeta[];

  /**
   * Number of continuous parameters this module exposes.
   * Derived automatically from paramMeta — override paramMeta, not this.
   */
  get paramCount(): number {
    return this.paramMeta.length;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Allocate AudioNodes and connect the internal graph.
   * Subclasses MUST call await super.init(audioCtx) first, then wire their
   * effect nodes between this._bypassIn and this._bypassOut, then call
   * this._finishInit().
   */
  async init(audioCtx: AudioContext): Promise<void> {
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
    // Note: subclass connects its effect nodes, then calls _finishInit()
    // to set initial gain values correctly.
  }

  /**
   * Call from the end of a subclass init() once effect nodes are wired, to
   * apply the correct initial bypass state.
   *
   * Subclass pattern:
   *   async init(audioCtx: AudioContext) {
   *     await super.init(audioCtx);
   *     // ... wire effect nodes ...
   *     this._finishInit();
   *   }
   */
  protected _finishInit(): void {
    this._applyBypass();
  }

  /**
   * Disconnect all AudioNodes and release resources.
   * Override in subclasses to clean up effect-specific nodes, calling
   * super.dispose() at the end.
   */
  dispose(): void {
    if (!this._initialized) return;
    try { this._bypassIn?.disconnect(); }  catch (_) { /* already disconnected */ }
    try { this._bypassOut?.disconnect(); } catch (_) { /* already disconnected */ }
    try { this._bypassDry?.disconnect(); } catch (_) { /* already disconnected */ }
    this._initialized = false;
    this._audioCtx = null;
  }

  // ---------------------------------------------------------------------------
  // Real-time control
  // ---------------------------------------------------------------------------

  /**
   * Set a single parameter by index.
   *
   * @param index           0-based index into paramMeta
   * @param normalizedValue [0, 1]
   */
  setParam(index: number, normalizedValue: number): void {
    // Store the value so getCurrentParamValue() can read it back
    this._paramValues[index] = normalizedValue;
    // default no-op — override in subclass for actual audio effect
  }

  /**
   * Get the last normalized value set for a parameter.
   * Returns the param's init value (from paramMeta) if never explicitly set.
   *
   * @param index 0-based index into paramMeta
   * @returns normalized value [0, 1]
   */
  getCurrentParamValue(index: number): number {
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
   */
  getInputNode(): AudioNode {
    if (!this._bypassIn) {
      throw new Error(`[EOCModule:${this.id}] Not initialised — call init() first`);
    }
    return this._bypassIn;
  }

  /**
   * The AudioNode to connect downstream (to next module or destination).
   * Everything exits through this node.
   */
  getOutputNode(): AudioNode {
    if (!this._bypassOut) {
      throw new Error(`[EOCModule:${this.id}] Not initialised — call init() first`);
    }
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
  protected _applyBypass(): void {
    if (!this._bypassDry || !this._audioCtx) return;
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
   * @param enabled true = effect active, false = bypassed
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected _onBypassChange(_enabled: boolean): void {
    // default no-op — override in subclass if effect has its own gain to manage
  }

  // ---------------------------------------------------------------------------
  // Utility: denormalize a [0,1] value to the raw param range
  // ---------------------------------------------------------------------------

  /**
   * Convert a normalized [0,1] value to the raw range defined by paramMeta[index].
   * Applies the curve bias: value^(1/curve) gives log-like feel for small curve,
   * value^curve gives exp-like feel for large curve.
   *
   * @param index           0-based index into paramMeta
   * @param normalizedValue [0, 1]
   * @returns raw value in [min, max]
   */
  protected _denormalize(index: number, normalizedValue: number): number {
    const meta = this.paramMeta[index];
    if (!meta) return 0;
    const { min, max, curve = 0.5 } = meta;
    // Apply power curve: curve=0.5 is linear, <0.5 pulls toward min, >0.5 toward max
    const shaped = Math.pow(
      Math.max(0, Math.min(1, normalizedValue)),
      curve === 0.5 ? 1 : 1 / (curve * 2),
    );
    return min + shaped * (max - min);
  }
}
