// Rhythm voice engine for uSEQ-Celium browser mode.
//
// JS port of RatioSeqEngine.hpp. Browser owns the clock: caller feeds wall-time
// dt (ms) via tick(), we advance a bar-phasor, run N independent voices through
// the ratioSeq() gate/amp logic, and return {gates, velocities} per voice for
// downstream snapshot emission.
//
// Intentionally stateless w.r.t. the serial protocol — this module only
// produces gate booleans and velocity floats in [0,1]. The state-producer
// (Round 3) composes us with MLP-derived CVs into a StateSnapshot.

import { ratioSeq, sumRatios } from './ratio-seq.js';

// Per-voice param layout, matching the order RatioSeqEngine::updateParams()
// consumes from its flat params buffer:
//   [0..2]  3 ratios  (each → int {1,2,3,4})
//   [3]     phasorMul (→ {1,2,4,8})
//   [4]     phaseOffset (quantized to beats-in-bar)
//   [5..6]  2 ampRatios (same integer scheme as ratios)
export const PARAMS_PER_VOICE = 7;

// Fixed gate pulse width in the MEMLCelium firmware. Exposed as a static on
// VoiceEngine so future-us can wire it up as a per-voice param without hunting.
const DEFAULT_PULSE_WIDTH = 0.5;

// Amp-beat pulse width used by the "high/low amp" subdivision. The firmware
// hardcodes 0.5 — half the amp-beats are "high", half "low".
const AMP_PULSE_WIDTH = 0.5;

const MAX_VOICES = 4;

/**
 * Decode a single float ∈ [0,1] into the ratio integer set {1,2,3,4}, matching
 * the C++ `(int)(v * 3.f) + 1`. Values v ≥ 1 quantize to 4 (guard clamp).
 *
 * @param {number} v
 * @returns {number}
 */
function decodeRatio(v) {
  if (!Number.isFinite(v) || v <= 0) return 1;
  if (v >= 1) return 4;
  return Math.floor(v * 3) + 1;
}

/**
 * Decode phasorMul. C++ is `muls[(int)(v * 3.999999f)]` → index 0..3 over
 * {1,2,4,8}.
 *
 * @param {number} v
 * @returns {number}
 */
function decodePhasorMul(v) {
  const table = [1, 2, 4, 8];
  if (!Number.isFinite(v) || v <= 0) return 1;
  const idx = Math.min(3, Math.floor(v * 3.999999));
  return table[idx];
}

/**
 * Decode phase offset. C++: `((int)(v * timeSigBeats)) * (1 / timeSigBeats)`.
 * Quantized to `timeSigBeats` buckets within the bar: 0, 1/B, 2/B, ..., (B-1)/B.
 *
 * @param {number} v
 * @param {number} timeSigBeats  positive integer beats-per-bar
 * @returns {number}
 */
function decodePhaseOffset(v, timeSigBeats) {
  if (!Number.isFinite(v) || v <= 0) return 0;
  const bucket = Math.min(timeSigBeats - 1, Math.floor(v * timeSigBeats));
  return bucket / timeSigBeats;
}

/**
 * Per-voice derived-params + edge-tracking state. Kept plain so we can cheaply
 * reset / resize.
 */
class VoiceState {
  constructor() {
    this.ratios = [1, 1, 1];
    this.ratioSum = 3;
    this.phasorMul = 1;
    this.phaseOffset = 0;
    this.ampRatios = [1, 1];
    this.ampRatioSum = 2;
    this.lastTrig = false;
    this.lastVelocity = 0;
  }

  reset() {
    this.lastTrig = false;
    this.lastVelocity = 0;
  }
}

/**
 * Rhythm engine. One master bar-phasor, N per-voice sub-sequencers.
 *
 * Events:
 *   - 'voiceCountChange' CustomEvent with detail { voiceCount, expectedParamLen }
 *     fires when setVoiceCount() changes the voice count. Downstream listeners
 *     should re-shape their param buffer to match.
 */
export class VoiceEngine extends EventTarget {
  /**
   * @param {object} opts
   * @param {number} [opts.bpm=120]
   * @param {number} [opts.voiceCount=4]    clamped to [1, 4]
   * @param {number} [opts.timeSigBeats=4]  beats per bar
   */
  constructor({ bpm = 120, voiceCount = 4, timeSigBeats = 4 } = {}) {
    super();
    if (!Number.isFinite(timeSigBeats) || timeSigBeats < 1) {
      throw new Error(`VoiceEngine: timeSigBeats must be >= 1, got ${timeSigBeats}`);
    }
    this._timeSigBeats = timeSigBeats;
    this._bpm = 120;
    this._masterPhase = 0;
    this._phaseInc = 0; // phase advanced per millisecond, computed from bpm

    // Pre-allocate max voices so we avoid re-alloc on setVoiceCount().
    this._voices = [];
    for (let i = 0; i < MAX_VOICES; i++) this._voices.push(new VoiceState());

    this._voiceCount = 0;
    this.setVoiceCount(voiceCount); // fires event, but no listeners yet — fine
    this.setBPM(bpm);
  }

  static get PARAMS_PER_VOICE() { return PARAMS_PER_VOICE; }
  static get DEFAULT_PULSE_WIDTH() { return DEFAULT_PULSE_WIDTH; }

  /**
   * Update tempo. Recomputes the per-ms phase increment.
   *
   * `masterPhase += dt_s * (bpm/60) / timeSigBeats`. bar = timeSigBeats beats.
   *
   * @param {number} bpm
   */
  setBPM(bpm) {
    if (!Number.isFinite(bpm) || bpm <= 0) {
      throw new Error(`VoiceEngine.setBPM: bpm must be > 0, got ${bpm}`);
    }
    this._bpm = bpm;
    // per-ms increment: (bpm / 60) / timeSigBeats * (1 / 1000)
    this._phaseInc = (bpm / 60) / this._timeSigBeats / 1000;
  }

  getBPM() { return this._bpm; }

  getVoiceCount() { return this._voiceCount; }

  getPhase() { return this._masterPhase; }

  /**
   * Resize the active voice set. Fires 'voiceCountChange'.
   *
   * @param {number} n  clamped to [1, MAX_VOICES]
   */
  setVoiceCount(n) {
    if (!Number.isFinite(n)) throw new Error(`VoiceEngine.setVoiceCount: n not finite`);
    const clamped = Math.max(1, Math.min(MAX_VOICES, Math.floor(n)));
    if (clamped === this._voiceCount) return;
    this._voiceCount = clamped;
    // Reset edge-trackers on deactivated voices so they don't hold stale state
    // if re-enabled later.
    for (let i = clamped; i < MAX_VOICES; i++) this._voices[i].reset();
    this.dispatchEvent(new CustomEvent('voiceCountChange', {
      detail: {
        voiceCount: clamped,
        expectedParamLen: clamped * PARAMS_PER_VOICE,
      },
    }));
  }

  /**
   * Set per-voice params from a flat buffer. Length must be
   * `voiceCount * PARAMS_PER_VOICE`. Values interpreted as floats in [0,1].
   *
   * Decode layout per voice (matches RatioSeqEngine::updateParams):
   *   [0..2]  → 3 ratios      {1,2,3,4}
   *   [3]     → phasorMul     {1,2,4,8}
   *   [4]     → phaseOffset   k/timeSigBeats, k ∈ [0, timeSigBeats-1]
   *   [5..6]  → 2 ampRatios   {1,2,3,4}
   *
   * @param {Float32Array|number[]} params
   */
  updateParams(params) {
    const expected = this._voiceCount * PARAMS_PER_VOICE;
    if (!params || params.length !== expected) {
      throw new Error(
        `VoiceEngine.updateParams: expected length ${expected} ` +
        `(${this._voiceCount} voices * ${PARAMS_PER_VOICE}), ` +
        `got ${params ? params.length : 'null'}`,
      );
    }
    let p = 0;
    for (let vi = 0; vi < this._voiceCount; vi++) {
      const v = this._voices[vi];
      v.ratios[0] = decodeRatio(params[p++]);
      v.ratios[1] = decodeRatio(params[p++]);
      v.ratios[2] = decodeRatio(params[p++]);
      v.ratioSum = sumRatios(v.ratios);
      v.phasorMul = decodePhasorMul(params[p++]);
      v.phaseOffset = decodePhaseOffset(params[p++], this._timeSigBeats);
      v.ampRatios[0] = decodeRatio(params[p++]);
      v.ampRatios[1] = decodeRatio(params[p++]);
      v.ampRatioSum = sumRatios(v.ampRatios);
    }
  }

  /**
   * Advance the master phasor by `dtMs` and evaluate all voices.
   *
   * @param {number} dtMs  elapsed milliseconds since last tick
   * @returns {{gates: boolean[], velocities: number[]}}
   *   gates      length = voiceCount, true during the on-portion of a beat
   *   velocities length = voiceCount, 0 when off, 0.5 or 1.0 during rising/held
   */
  tick(dtMs) {
    if (!Number.isFinite(dtMs) || dtMs < 0) dtMs = 0;
    this._masterPhase += dtMs * this._phaseInc;
    if (this._masterPhase >= 1) {
      // Use mod rather than repeated subtract in case of very large dtMs
      // (e.g. tab-throttle catch-up). Firmware never sees that case; we might.
      this._masterPhase = this._masterPhase - Math.floor(this._masterPhase);
    }

    const n = this._voiceCount;
    const gates = new Array(n);
    const velocities = new Array(n);
    for (let i = 0; i < n; i++) {
      const v = this._voices[i];
      // Bug-for-bug parity with MEMLCelium firmware: phaseOffset is folded
      // into voicePhase here (RatioSeqEngine.hpp:79-81), AND ratioSeq() then
      // adds it again internally (RatioSeq.hpp:26). The double-application is
      // intentional — see ALIGNMENT.md / docs/useq-celium/README.md. With
      // phaseOffset=0 (the most common case) this collapses to the single-
      // application form and existing tests still pass.
      let voicePhase = this._masterPhase * v.phasorMul + v.phaseOffset;
      voicePhase = voicePhase - Math.floor(voicePhase); // wrap to [0,1)
      const gateNow = ratioSeq(
        voicePhase, v.phaseOffset, v.ratioSum, v.ratios, DEFAULT_PULSE_WIDTH,
      );
      let velocity;
      if (gateNow && !v.lastTrig) {
        // Rising edge: sample the amp-divider to pick 1.0 or 0.5.
        const highAmp = ratioSeq(
          voicePhase, v.phaseOffset, v.ampRatioSum, v.ampRatios, AMP_PULSE_WIDTH,
        );
        velocity = highAmp ? 1.0 : 0.5;
        v.lastVelocity = velocity;
      } else if (gateNow && v.lastTrig) {
        // Hold: keep the velocity we picked on the rising edge.
        velocity = v.lastVelocity;
      } else {
        velocity = 0;
        v.lastVelocity = 0;
      }
      gates[i] = gateNow;
      velocities[i] = velocity;
      v.lastTrig = gateNow;
    }
    return { gates, velocities };
  }

  /**
   * Rewind master phasor and clear all edge-tracking / held-velocity state.
   * Params and BPM are unchanged.
   */
  reset() {
    this._masterPhase = 0;
    for (let i = 0; i < MAX_VOICES; i++) this._voices[i].reset();
  }
}
