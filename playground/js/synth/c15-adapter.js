// C15Adapter — wraps C15Bridge to satisfy the SynthEngine interface.
//
// All C15-specific internals (SharedArrayBuffer, ring buffer, AudioWorklet)
// remain inside C15Bridge. This adapter is the only file outside the synth/
// directory that needs to know about C15Bridge.

import { SynthEngine } from './engine-interface.js';
import { C15Bridge } from './c15-bridge.js';
import { SYNTH_PARAM_MAP } from './param-map.js';

// ---------------------------------------------------------------------------
// Derive paramMeta from SYNTH_PARAM_MAP
// ---------------------------------------------------------------------------

// Infer a human-readable group name from the parameter's machine name.
// e.g. 'Env_A_Att' → 'Envelope A', 'SV_Flt_Cut' → 'SVF', 'Cabinet_Drive' → 'Cabinet'
function _inferGroup(name) {
  if (name.startsWith('Env_A'))     return 'Envelope A';
  if (name.startsWith('Env_B'))     return 'Envelope B';
  if (name.startsWith('Env_C'))     return 'Envelope C';
  if (name.startsWith('Osc_A'))     return 'Oscillator A';
  if (name.startsWith('Osc_B'))     return 'Oscillator B';
  if (name.startsWith('Shp_A'))     return 'Shaper A';
  if (name.startsWith('Shp_B'))     return 'Shaper B';
  if (name.startsWith('Comb_Flt'))  return 'Comb Filter';
  if (name.startsWith('SV_Flt'))    return 'SVF';
  if (name.startsWith('Gap_Flt'))   return 'Gap Filter';
  if (name.startsWith('FB_Mix'))    return 'Feedback Mixer';
  if (name.startsWith('Out_Mix'))   return 'Output Mixer';
  if (name.startsWith('Cabinet'))   return 'Cabinet';
  if (name.startsWith('Flanger'))   return 'Flanger';
  if (name.startsWith('Echo'))      return 'Echo';
  if (name.startsWith('Reverb'))    return 'Reverb';
  if (name.startsWith('Unison'))    return 'Unison';
  if (name.startsWith('Mono'))      return 'Mono';
  return 'Other';
}

// Build paramMeta once at module load time — no per-call allocation.
const C15_PARAM_META = SYNTH_PARAM_MAP.map(p => ({
  id:    p.name,                          // stable machine ID (e.g. 'Env_A_Att')
  name:  p.label,                         // short display label (e.g. 'EnvA Att')
  min:   p.safeMin  !== undefined ? p.safeMin  : 0,
  max:   p.safeMax  !== undefined ? p.safeMax  : 1,
  init:  p.defaultValue,
  curve: 0.5,                             // linear by default; presets can override
  group: _inferGroup(p.name),
}));

// ---------------------------------------------------------------------------
// C15Adapter
// ---------------------------------------------------------------------------

export class C15Adapter extends SynthEngine {
  constructor() {
    super();
    this._bridge = new C15Bridge();
    this._running = false;
  }

  // --- Identity ---

  get id()          { return 'shaper-feedback'; }
  get displayName() { return 'C15 Shaper-Feedback'; }

  // --- Parameter schema ---

  get paramMeta()   { return C15_PARAM_META; }
  // paramCount is derived from paramMeta.length via the base class

  // --- Lifecycle ---

  /**
   * Initialise the C15 engine.
   * The AudioContext is created internally by C15Bridge.start(), so the
   * audioCtx parameter is accepted for interface compatibility but not used.
   *
   * @param {AudioContext|null} _audioCtx — ignored; C15Bridge creates its own
   */
  async init(_audioCtx) {
    // Forward status callbacks before starting so callers can observe progress
    this._bridge.onStatusChange = (msg) => {
      this._onStatusChange?.(msg);
      // Mirror the running flag — C15Bridge sets this.running internally
      this._running = this._bridge.running;
    };

    await this._bridge.loadParams();
    await this._bridge.start();
    this._running = this._bridge.running;
  }

  /** Stop audio and release the AudioContext. */
  async stop() {
    await this._bridge.stop();
    this._running = this._bridge.running;
  }

  dispose() {
    this._bridge.panic();
    // C15Bridge has no explicit destroy; AudioContext will be GC'd
    this._running = false;
  }

  // --- Status callback (optional, assigned by a-app.js) ---

  set onStatusChange(fn) { this._onStatusChange = fn; }

  // --- running passthrough ---
  get running() { return this._running; }

  // --- Real-time control ---

  /**
   * Set a parameter by MLP output index (0-based position in SYNTH_PARAM_MAP).
   * Converts the index to the C15 hardware param ID before writing.
   *
   * @param {number} index           — MLP output index [0, paramCount)
   * @param {number} normalizedValue — [0, 1]
   */
  setParam(index, normalizedValue) {
    const entry = SYNTH_PARAM_MAP[index];
    if (!entry) return;
    this._bridge.setParameter(entry.id, normalizedValue);
  }

  /**
   * Trigger a note.
   * @param {number} note     — MIDI note number 0–127
   * @param {number} velocity — [0, 1]
   */
  noteOn(note, velocity = 0.7) {
    this._bridge.noteOn(note, velocity);
  }

  /**
   * Release a note.
   * @param {number} note — MIDI note number 0–127
   */
  noteOff(note) {
    this._bridge.noteOff(note);
  }

  // --- Audio graph ---

  /**
   * Return the master gain node. Connect this to a compressor or destination.
   * Only available after init() completes.
   *
   * @returns {GainNode}
   */
  getOutputNode() {
    return this._bridge.masterGain;
  }

  // --- C15-specific passthrough (for MIDIInput and volume controls) ---

  /** Pass-through for MIDIInput which was constructed with the bridge */
  get bridge() { return this._bridge; }

  setMasterVolume(value) { this._bridge.setMasterVolume(value); }
  panic()                { this._bridge.panic(); }

  /**
   * The SharedArrayBuffer from the ring buffer. Exposed so Arpeggiator can
   * hand it off to its worker. After the engine-interface migration is complete
   * the arpeggiator no longer needs direct SAB access — this getter exists only
   * for backward compatibility during transition.
   *
   * @returns {SharedArrayBuffer|null}
   */
  get sharedBuffer() { return this._bridge.sharedBuffer; }
}
