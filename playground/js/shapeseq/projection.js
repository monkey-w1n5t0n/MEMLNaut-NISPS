/**
 * ShapeSeq Projection — 3 global post-chain knobs
 *
 * Applied after the primitive chain produces a pattern, before the clock plays it.
 *
 * Knobs:
 *   1. velocityCurve: 'linear' | 'exponential' | 'sCurve'
 *   2. gateThreshold: [0, 1] — global density filter (steps with velocity below threshold are muted)
 *   3. pitchRange: { low: midiNote, high: midiNote } — clamp midiNote to range
 *
 * @module shapeseq/projection
 */

import { clonePattern } from './pattern.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VELOCITY_CURVES = ['linear', 'exponential', 'sCurve'];

// ---------------------------------------------------------------------------
// Velocity curve math
// ---------------------------------------------------------------------------

/**
 * Apply a velocity curve to a [0,1] value.
 *
 * @param {number} value - Input value in [0,1]
 * @param {'linear'|'exponential'|'sCurve'} curve
 * @returns {number} Transformed value in [0,1]
 */
function velocityCurveApply(value, curve) {
  const v = value < 0 ? 0 : value > 1 ? 1 : value;
  switch (curve) {
    case 'exponential':
      return v * v;
    case 'sCurve':
      return (3 - 2 * v) * v * v; // smoothstep: 3v² - 2v³
    case 'linear':
    default:
      return v;
  }
}

/**
 * Fold a MIDI note number into a target range by shifting octaves.
 *
 * @param {number} note - MIDI note number
 * @param {number} low  - Low bound (inclusive)
 * @param {number} high - High bound (inclusive)
 * @returns {number} MIDI note within [low, high]
 */
function octaveFold(note, low, high) {
  if (high <= low) return low;
  let n = note | 0;
  while (n < low) n += 12;
  while (n > high) n -= 12;
  // If 12-step folding overshoots (range < 12), clamp
  if (n < low) n = low;
  if (n > high) n = high;
  return n;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a projection config with defaults.
 *
 * @param {Object} [opts]
 * @param {'linear'|'exponential'|'sCurve'} [opts.velocityCurve='linear']
 * @param {number} [opts.gateThreshold=0]
 * @param {{ low?: number, high?: number }} [opts.pitchRange]
 * @returns {{ velocityCurve: string, gateThreshold: number, pitchRange: { low: number, high: number } }}
 */
export function createProjection(opts = {}) {
  return {
    velocityCurve: opts.velocityCurve || 'linear',
    gateThreshold: opts.gateThreshold ?? 0,
    pitchRange: {
      low: opts.pitchRange?.low ?? 0,
      high: opts.pitchRange?.high ?? 127,
    },
  };
}

/**
 * Apply projection to a pattern. Returns a new pattern (no mutation).
 *
 * For each step:
 *   1. Apply velocity curve to step.velocity
 *   2. If step.velocity < gateThreshold, set step.trigger = false
 *   3. If step.midiNote != null, fold into [pitchRange.low, pitchRange.high] by octave
 *
 * @param {{ velocityCurve: string, gateThreshold: number, pitchRange: { low: number, high: number } }} config
 * @param {{ steps: Array, stepCount: number, metadata: Object }} patternDesc
 * @returns {{ steps: Array, stepCount: number, metadata: Object }}
 */
export function applyProjection(config, patternDesc) {
  const result = clonePattern(patternDesc);
  const steps = result.steps;
  const count = result.stepCount;

  for (let s = 0; s < count; s++) {
    const step = steps[s];

    // 1. Velocity curve
    step.velocity = velocityCurveApply(step.velocity, config.velocityCurve);

    // 2. Gate threshold (uses post-curve velocity)
    if (step.velocity < config.gateThreshold) {
      step.trigger = false;
    }

    // 3. Pitch range (octave fold)
    if (step.midiNote != null) {
      step.midiNote = octaveFold(step.midiNote, config.pitchRange.low, config.pitchRange.high);
    }
  }

  return result;
}
