// C15Adapter — wraps C15Bridge to satisfy the SynthEngine interface.
//
// All C15-specific internals (SharedArrayBuffer, ring buffer, AudioWorklet)
// remain inside C15Bridge. This adapter is the only file outside the synth/
// directory that needs to know about C15Bridge.

import { SynthEngine, type ParamMeta } from './engine-interface';
import { C15Bridge } from './c15-bridge';
import { SYNTH_PARAM_MAP } from './param-map';

// ---------------------------------------------------------------------------
// Derive paramMeta from SYNTH_PARAM_MAP
// ---------------------------------------------------------------------------

/**
 * Infer a human-readable group name from the parameter's machine name.
 * e.g. 'Env_A_Att' → 'Envelope A', 'SV_Flt_Cut' → 'SVF', 'Cabinet_Drive' → 'Cabinet'
 */
function _inferGroup(name: string): string {
  if (name.startsWith('Env_A'))    return 'Envelope A';
  if (name.startsWith('Env_B'))    return 'Envelope B';
  if (name.startsWith('Env_C'))    return 'Envelope C';
  if (name.startsWith('Osc_A'))    return 'Oscillator A';
  if (name.startsWith('Osc_B'))    return 'Oscillator B';
  if (name.startsWith('Shp_A'))    return 'Shaper A';
  if (name.startsWith('Shp_B'))    return 'Shaper B';
  if (name.startsWith('Comb_Flt')) return 'Comb Filter';
  if (name.startsWith('SV_Flt'))   return 'SVF';
  if (name.startsWith('Gap_Flt'))  return 'Gap Filter';
  if (name.startsWith('FB_Mix'))   return 'Feedback Mixer';
  if (name.startsWith('Out_Mix'))  return 'Output Mixer';
  if (name.startsWith('Cabinet'))  return 'Cabinet';
  if (name.startsWith('Flanger'))  return 'Flanger';
  if (name.startsWith('Echo'))     return 'Echo';
  if (name.startsWith('Reverb'))   return 'Reverb';
  if (name.startsWith('Unison'))   return 'Unison';
  if (name.startsWith('Mono'))     return 'Mono';
  return 'Other';
}

/** Build paramMeta once at module load time — no per-call allocation. */
const C15_PARAM_META: ParamMeta[] = SYNTH_PARAM_MAP.map(p => ({
  id:    p.name,                                        // stable machine ID (e.g. 'Env_A_Att')
  name:  p.label,                                       // short display label (e.g. 'EnvA Att')
  min:   p.safeMin  !== undefined ? p.safeMin  : 0,
  max:   p.safeMax  !== undefined ? p.safeMax  : 1,
  init:  p.defaultValue,
  curve: 0.5,                                           // linear by default; presets can override
  group: _inferGroup(p.name),
}));

// ---------------------------------------------------------------------------
// C15Adapter
// ---------------------------------------------------------------------------

export class C15Adapter extends SynthEngine {
  private readonly _bridge: C15Bridge;
  private _onStatusChangeCb: ((msg: string) => void) | undefined;

  constructor() {
    super();
    this._bridge = new C15Bridge();
  }

  // --- Identity ---

  get id(): string          { return 'shaper-feedback'; }
  get displayName(): string { return 'C15 Shaper-Feedback'; }

  // --- Parameter schema ---

  get paramMeta(): ParamMeta[] { return C15_PARAM_META; }
  // paramCount is derived from paramMeta.length via the base class

  // --- Status callback (optional, assigned by caller) ---

  set onStatusChange(fn: (msg: string) => void) {
    this._onStatusChangeCb = fn;
  }

  // --- Lifecycle ---

  /**
   * Initialise the C15 engine.
   * The AudioContext is created internally by C15Bridge.start(), so the
   * audioCtx parameter is accepted for interface compatibility but not used.
   *
   * @param _audioCtx — ignored; C15Bridge creates its own AudioContext
   */
  async init(_audioCtx: AudioContext): Promise<void> {
    // Forward status callbacks before starting so callers can observe progress
    this._bridge.onStatusChange = (msg: string) => {
      this._onStatusChangeCb?.(msg);
      // Mirror the running flag — C15Bridge sets this.running internally
      this._running = this._bridge.running;
    };

    await this._bridge.loadParams();
    await this._bridge.start();
    this._running = this._bridge.running;
  }

  /** Stop audio and suspend the AudioContext. */
  async stop(): Promise<void> {
    await this._bridge.stop();
    this._running = this._bridge.running;
  }

  override dispose(): void {
    this._bridge.panic();
    // C15Bridge has no explicit destroy; AudioContext will be GC'd
    this._running = false;
  }

  // --- running passthrough ---

  override get running(): boolean { return this._running; }

  // --- Real-time control ---

  /**
   * Set a parameter by MLP output index (0-based position in SYNTH_PARAM_MAP).
   * Converts the index to the C15 hardware param ID before writing.
   *
   * @param index           MLP output index [0, paramCount)
   * @param normalizedValue [0, 1]
   */
  override setParam(index: number, normalizedValue: number): void {
    const entry = SYNTH_PARAM_MAP[index];
    if (!entry) return;
    this._bridge.setParameter(entry.id, normalizedValue);
  }

  /**
   * Trigger a note.
   * @param note     MIDI note number 0–127
   * @param velocity [0, 1]
   */
  override noteOn(note: number, velocity = 0.7): void {
    this._bridge.noteOn(note, velocity);
  }

  /**
   * Release a note.
   * @param note MIDI note number 0–127
   */
  override noteOff(note: number): void {
    this._bridge.noteOff(note);
  }

  // --- Audio graph ---

  /**
   * Return the limiter node — the last AudioNode before destination.
   * This is the correct insertion point for post-processing (e.g. EOCChain).
   * Falls back to masterGain before start() is called.
   * Only useful after init() completes.
   */
  getOutputNode(): AudioNode {
    // Cast through unknown to satisfy TypeScript — both are valid AudioNodes
    return (this._bridge.limiterNode ?? this._bridge.masterGain) as AudioNode;
  }

  // --- C15-specific passthrough (for MIDIInput and volume controls) ---

  /** Pass-through for MIDIInput which was constructed with the bridge. */
  get bridge(): C15Bridge { return this._bridge; }

  setMasterVolume(value: number): void { this._bridge.setMasterVolume(value); }

  panic(): void { this._bridge.panic(); }

  /**
   * The SharedArrayBuffer from the ring buffer. Exposed so the Arpeggiator
   * can hand it off to its worker.
   *
   * After the engine-interface migration is complete the arpeggiator no longer
   * needs direct SAB access — this getter exists only for backward
   * compatibility during the transition.
   */
  get sharedBuffer(): SharedArrayBuffer | null {
    return this._bridge.sharedBuffer;
  }
}
