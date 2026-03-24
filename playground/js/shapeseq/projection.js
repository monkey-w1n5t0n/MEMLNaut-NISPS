/**
 * ShapeSeq Projection Layer
 *
 * Composable chain of post-chain transforms that convert raw [0,1] values
 * in a pattern description into final musical values.
 *
 * Note: pitch quantization is NOT here — that's the Interval Lock primitive.
 *
 * Port-ready: pure functions, no closures, explicit state.
 *
 * @module shapeseq/projection
 */

import { clonePattern } from './pattern.js';

// ---------------------------------------------------------------------------
// Transform definitions
// ---------------------------------------------------------------------------

/**
 * Velocity Curve — reshapes [0,1] velocity values.
 *
 * @param {number} value - Input value in [0,1]
 * @param {{ shape: 'linear'|'exponential'|'sCurve' }} params
 * @returns {number} Transformed value in [0,1]
 */
function velocityCurveApply(value, params) {
  const v = value < 0 ? 0 : value > 1 ? 1 : value;
  switch (params.shape) {
    case 'exponential':
      return v * v;
    case 'sCurve':
      return (3 - 2 * v) * v * v; // smoothstep: 3v² - 2v³
    case 'linear':
    default:
      return v;
  }
}

/** @type {import('./projection.js').Transform} */
export const VelocityCurve = {
  name: 'Velocity Curve',
  inputType: 'continuous',
  outputType: 'continuous',
  apply: velocityCurveApply,
};

/**
 * Gate Threshold — converts continuous [0,1] to boolean.
 *
 * @param {number} value - Input value in [0,1]
 * @param {{ threshold: number }} params - threshold in [0,1]
 * @returns {boolean}
 */
function gateThresholdApply(value, params) {
  return value > params.threshold;
}

/** @type {import('./projection.js').Transform} */
export const GateThreshold = {
  name: 'Gate Threshold',
  inputType: 'continuous',
  outputType: 'boolean',
  apply: gateThresholdApply,
};

/**
 * Range Map — scales [0,1] into [min, max].
 *
 * @param {number} value - Input value in [0,1]
 * @param {{ min: number, max: number }} params
 * @returns {number} Value in [min, max]
 */
function rangeMapApply(value, params) {
  const v = value < 0 ? 0 : value > 1 ? 1 : value;
  return params.min + v * (params.max - params.min);
}

/** @type {import('./projection.js').Transform} */
export const RangeMap = {
  name: 'Range Map',
  inputType: 'continuous',
  outputType: 'continuous',
  apply: rangeMapApply,
};

/**
 * Octave Folder — folds MIDI note numbers into a target range.
 *
 * @param {number} value - MIDI note number
 * @param {{ lowNote: number, highNote: number }} params
 * @returns {number} MIDI note number within [lowNote, highNote]
 */
function octaveFolderApply(value, params) {
  const low = params.lowNote | 0;
  const high = params.highNote | 0;
  if (high <= low) return low;
  let note = value | 0;
  // Fold into range by shifting octaves (12 semitones)
  while (note < low) note += 12;
  while (note > high) note -= 12;
  // If 12-step folding overshoots, clamp (range < 12)
  if (note < low) note = low;
  if (note > high) note = high;
  return note;
}

/** @type {import('./projection.js').Transform} */
export const OctaveFolder = {
  name: 'Octave Folder',
  inputType: 'midi',
  outputType: 'midi',
  apply: octaveFolderApply,
};

/**
 * Stutter Map — maps [0,1] to integer repeat count [1, maxRepeats].
 *
 * @param {number} value - Input value in [0,1]
 * @param {{ maxRepeats: number }} params
 * @returns {number} Integer repeat count in [1, maxRepeats]
 */
function stutterMapApply(value, params) {
  const v = value < 0 ? 0 : value > 1 ? 1 : value;
  const max = (params.maxRepeats | 0) < 1 ? 1 : params.maxRepeats | 0;
  // Map [0,1] to [1, maxRepeats] — 0 → 1, 1 → maxRepeats
  return Math.min(max, 1 + ((v * (max - 1)) | 0));
}

/** @type {import('./projection.js').Transform} */
export const StutterMap = {
  name: 'Stutter Map',
  inputType: 'continuous',
  outputType: 'continuous',
  apply: stutterMapApply,
};

// ---------------------------------------------------------------------------
// Projection chain
// ---------------------------------------------------------------------------

/**
 * Create and validate a projection chain.
 *
 * Validates that the output type of each transform matches the input type
 * of the next transform in the chain.
 *
 * @param {Array<{ transform: Transform, params: Object, field: string }>} transforms
 *   Each entry specifies:
 *     - transform: one of the transform objects above
 *     - params: parameter object for that transform
 *     - field: which pattern step field this applies to ('velocity'|'pitch'|'trigger'|'subdivisions')
 * @returns {{ transforms: Array, valid: boolean, error: string|null }}
 */
export function createProjectionChain(transforms) {
  if (!Array.isArray(transforms) || transforms.length === 0) {
    return { transforms: [], valid: true, error: null };
  }

  // Group by field to validate type compatibility within each field's sub-chain
  const byField = {};
  for (let i = 0; i < transforms.length; i++) {
    const entry = transforms[i];
    const field = entry.field || 'velocity';
    if (!byField[field]) byField[field] = [];
    byField[field].push({ index: i, entry: entry });
  }

  // Validate type compatibility within each field's sub-chain
  const fields = Object.keys(byField);
  for (let f = 0; f < fields.length; f++) {
    const group = byField[fields[f]];
    for (let i = 1; i < group.length; i++) {
      const prev = group[i - 1].entry.transform;
      const curr = group[i].entry.transform;
      if (prev.outputType !== curr.inputType) {
        return {
          transforms: transforms,
          valid: false,
          error:
            'Type mismatch at index ' + group[i].index +
            ': ' + prev.name + ' outputs ' + prev.outputType +
            ' but ' + curr.name + ' expects ' + curr.inputType,
        };
      }
    }
  }

  return { transforms: transforms, valid: true, error: null };
}

/**
 * Apply a projection chain to a pattern description.
 *
 * Returns a new pattern description — does not mutate the input.
 *
 * Transform application rules:
 *   - velocity transforms apply to step.velocity
 *   - gate transforms (outputType === 'boolean') apply to step.trigger (post-chain override)
 *   - pitch transforms apply to step.pitch
 *
 * @param {{ transforms: Array, valid: boolean }} chain - from createProjectionChain
 * @param {{ steps: Array, stepCount: number, metadata: Object }} patternDesc
 * @returns {{ steps: Array, stepCount: number, metadata: Object }}
 */
export function applyProjection(chain, patternDesc) {
  if (!chain.valid) {
    throw new Error('Cannot apply invalid projection chain: ' + chain.error);
  }
  if (!chain.transforms || chain.transforms.length === 0) {
    return patternDesc;
  }

  const result = clonePattern(patternDesc);
  const steps = result.steps;
  const count = result.stepCount;

  // Group transforms by field, preserving order
  const velocityChain = [];
  const pitchChain = [];
  const triggerChain = [];
  const subdivisionsChain = [];

  for (let i = 0; i < chain.transforms.length; i++) {
    const entry = chain.transforms[i];
    const field = entry.field || 'velocity';
    switch (field) {
      case 'velocity':
        velocityChain.push(entry);
        break;
      case 'pitch':
        pitchChain.push(entry);
        break;
      case 'trigger':
        triggerChain.push(entry);
        break;
      case 'subdivisions':
        subdivisionsChain.push(entry);
        break;
    }
  }

  for (let s = 0; s < count; s++) {
    const step = steps[s];
    const rawVelocity = step.velocity; // capture before velocity transforms

    // Apply velocity transforms
    let vel = step.velocity;
    for (let t = 0; t < velocityChain.length; t++) {
      vel = velocityChain[t].transform.apply(vel, velocityChain[t].params);
    }
    step.velocity = vel;

    // Apply pitch transforms
    let pitch = step.pitch;
    for (let t = 0; t < pitchChain.length; t++) {
      pitch = pitchChain[t].transform.apply(pitch, pitchChain[t].params);
    }
    step.pitch = pitch;

    // Apply trigger transforms (gate threshold overrides trigger)
    let trig = rawVelocity; // gate threshold uses raw velocity as input
    for (let t = 0; t < triggerChain.length; t++) {
      trig = triggerChain[t].transform.apply(trig, triggerChain[t].params);
    }
    if (triggerChain.length > 0) {
      step.trigger = !!trig;
    }

    // Apply subdivisions transforms (stutter)
    let subs = step.subdivisions;
    // Normalize subdivisions to [0,1] for continuous input transforms
    // subdivisions range is [1,4], map to [0,1]
    let subsNorm = (subs - 1) / 3;
    for (let t = 0; t < subdivisionsChain.length; t++) {
      subsNorm = subdivisionsChain[t].transform.apply(subsNorm, subdivisionsChain[t].params);
    }
    if (subdivisionsChain.length > 0) {
      step.subdivisions = Math.max(1, Math.min(4, Math.round(subsNorm)));
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Projection presets
// ---------------------------------------------------------------------------

/**
 * Pre-built projection chain configurations.
 *
 * Each preset is a plain array of { transform, params, field } entries
 * ready to pass to createProjectionChain().
 */
export const PRESETS = {
  /**
   * Exponential velocity shaping.
   * Pitch is handled by IntervalLock primitive (outputs MIDI note / 127).
   * No pitch RangeMap needed — the sequencer converts pitch * 127 to MIDI note.
   */
  expressive: [
    { transform: VelocityCurve, params: { shape: 'exponential' }, field: 'velocity' },
  ],

  /** Gate threshold at 0.5 + exponential velocity curve */
  percussive: [
    { transform: GateThreshold, params: { threshold: 0.5 }, field: 'trigger' },
    { transform: VelocityCurve, params: { shape: 'exponential' }, field: 'velocity' },
  ],

  /** S-curve velocity for more dynamic contrast */
  fullRange: [
    { transform: VelocityCurve, params: { shape: 'sCurve' }, field: 'velocity' },
  ],
};
