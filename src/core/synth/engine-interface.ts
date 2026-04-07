// SynthEngine — abstract base class that all synth engines implement.
//
// Concrete engines extend SynthEngine and override the abstract members.
// Non-abstract methods provide sensible no-op defaults so subclasses only
// need to override what they actually use.
//
// Usage:
//   import { SynthEngine } from './engine-interface.js';
//   class MyEngine extends SynthEngine { ... }

/** Descriptor for a single parameter exposed by a SynthEngine */
export interface ParamMeta {
  /** Stable machine ID (used for preset persistence) */
  id: string;
  /** Short display name */
  name: string;
  /** Normalised lower bound [0, 1] */
  min: number;
  /** Normalised upper bound [0, 1] */
  max: number;
  /** Default normalised value [0, 1] */
  init: number;
  /** Power-curve bias: 0.5 = linear, <0.5 = logarithmic, >0.5 = exponential */
  curve: number;
  /** Section label for group drawer / colour coding */
  group: string;
}

export abstract class SynthEngine {
  // ---------------------------------------------------------------------------
  // Identity (must be overridden in subclass)
  // ---------------------------------------------------------------------------

  /**
   * Stable machine ID, e.g. 'shaper-feedback' | 'additive' | 'fm'.
   * Used for persistence keys and engine-switcher logic.
   */
  abstract get id(): string;

  /**
   * Human-readable label shown in the engine-switcher UI.
   */
  abstract get displayName(): string;

  // ---------------------------------------------------------------------------
  // Parameter schema (must be overridden in subclass)
  // ---------------------------------------------------------------------------

  /**
   * Array of parameter descriptors, one per MLP output index.
   * The length of this array equals paramCount.
   */
  abstract get paramMeta(): ParamMeta[];

  /**
   * Number of continuous parameters this engine exposes (= MLP output count).
   * Derived from paramMeta.length by default.
   */
  get paramCount(): number {
    return this.paramMeta.length;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Load WASM / worklet, connect the output node to audioCtx.destination.
   * Must be idempotent — calling init() twice should be safe.
   */
  abstract init(audioCtx: AudioContext): Promise<void>;

  /**
   * Release all AudioNodes, Workers, and WASM memory.
   * The engine should be unusable after dispose().
   * Default is a no-op; override when cleanup is needed.
   */
  dispose(): void {
    // default no-op
  }

  // ---------------------------------------------------------------------------
  // Real-time control
  // ---------------------------------------------------------------------------

  /**
   * Set a single parameter by MLP output index.
   *
   * @param index           0-based index into paramMeta
   * @param normalizedValue [0, 1]
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setParam(index: number, normalizedValue: number): void {
    // default no-op
  }

  /**
   * Set all parameters in one call.
   * Default implementation calls setParam() for each value.
   *
   * @param values Array of normalized values [0, 1], length must equal paramCount
   */
  setParams(values: number[]): void {
    for (let i = 0; i < values.length; i++) {
      this.setParam(i, values[i]);
    }
  }

  /**
   * Get the current normalized value of a single parameter.
   * Default returns undefined; engines may override.
   *
   * @param index 0-based index into paramMeta
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getParam(index: number): number | undefined {
    return undefined;
  }

  /**
   * Get all current parameter values as a normalized array.
   * Default builds the array from getParam(); engines may override for efficiency.
   */
  getParams(): (number | undefined)[] {
    return Array.from({ length: this.paramCount }, (_, i) => this.getParam(i));
  }

  /**
   * Trigger a note.
   *
   * @param note     MIDI note number 0–127
   * @param velocity [0, 1]
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  noteOn(note: number, velocity = 0.7): void {
    // default no-op
  }

  /**
   * Release a note.
   *
   * @param note MIDI note number 0–127
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  noteOff(note: number): void {
    // default no-op
  }

  // ---------------------------------------------------------------------------
  // Preset methods
  // ---------------------------------------------------------------------------

  /**
   * Apply a preset by id. The engine may use this to reconfigure itself
   * (e.g. pin certain params, adjust internal defaults).
   * Default is a no-op.
   *
   * @param presetId Preset machine ID (from SynthPreset.id)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  applyPreset(presetId: string): void {
    // default no-op
  }

  /**
   * Return a list of preset IDs this engine knows about.
   * Default returns an empty array.
   */
  getAvailablePresets(): string[] {
    return [];
  }

  // ---------------------------------------------------------------------------
  // Audio graph
  // ---------------------------------------------------------------------------

  /**
   * Return the AudioNode that should be connected downstream (e.g. to a
   * compressor or the AudioContext destination).
   */
  abstract getOutputNode(): AudioNode;

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  /** @internal */
  protected _running = false;

  /**
   * True once init() has completed successfully and the engine is producing
   * audio. Engines should set this._running = true after init().
   */
  get running(): boolean {
    return this._running;
  }
}
