/**
 * ShapeSeq Sequencing Primitives
 *
 * All 8 primitives for the ShapeSeq generative sequencing system.
 * Each extends Primitive and implements process(params, patternDesc, state, rng).
 *
 * Port-ready: explicit state, no closures, seeded PRNG, typed arrays.
 *
 * @module shapeseq/primitives
 */

import { Primitive } from './primitive.js';
import { createPattern, clonePattern, setStep } from './pattern.js';
import { next, nextInt } from './prng.js';

// ── Helper: map [0,1] float to integer range [lo, hi] ──────────────

function mapToInt(value, lo, hi) {
  const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
  return lo + Math.floor(clamped * (hi - lo + 1 - 1e-9));
}

// ── 1. EuclideanRhythm ──────────────────────────────────────────────

/**
 * Bjorklund algorithm: distribute `pulses` as evenly as possible
 * across `steps`, then apply rotation.
 */
function bjorklund(steps, pulses) {
  if (pulses >= steps) {
    const result = new Array(steps);
    for (let i = 0; i < steps; i++) result[i] = true;
    return result;
  }
  if (pulses <= 0) {
    const result = new Array(steps);
    for (let i = 0; i < steps; i++) result[i] = false;
    return result;
  }

  // Build pattern using Bjorklund's algorithm
  let groups = [];
  for (let i = 0; i < pulses; i++) groups.push([true]);
  for (let i = 0; i < steps - pulses; i++) groups.push([false]);

  while (true) {
    const remainder = groups.length - pulses;
    if (remainder <= 1) break;
    const minLen = Math.min(pulses, remainder);
    const newGroups = [];
    for (let i = 0; i < minLen; i++) {
      newGroups.push(groups[i].concat(groups[groups.length - 1 - i]));
    }
    // Keep any leftovers
    const leftStart = minLen;
    const leftEnd = groups.length - minLen;
    for (let i = leftStart; i < leftEnd; i++) {
      newGroups.push(groups[i]);
    }
    groups = newGroups;
    pulses = minLen;
    if (pulses <= 1) break;
  }

  // Flatten groups
  const result = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = 0; j < groups[i].length; j++) {
      result.push(groups[i][j]);
    }
  }
  return result;
}

export class EuclideanRhythm extends Primitive {
  constructor() {
    super('EuclideanRhythm', 'generator', [
      { name: 'steps', default: 0.5, boundary: 'clamp' },
      { name: 'pulses', default: 0.5, boundary: 'clamp' },
      { name: 'rotation', default: 0.0, boundary: 'wrap' },
    ]);
  }

  process(params, patternDesc, state, rng) {
    const stepCount = patternDesc.stepCount;
    const steps = mapToInt(params[0], 2, stepCount);
    const pulses = mapToInt(params[1], 0, steps);
    const rotation = mapToInt(params[2], 0, steps - 1);

    const rhythm = bjorklund(steps, pulses);
    const pattern = createPattern(stepCount);

    for (let i = 0; i < stepCount; i++) {
      if (i < steps) {
        const srcIdx = (i - rotation + steps) % steps;
        if (rhythm[srcIdx]) {
          setStep(pattern, i, { trigger: true });
        }
      }
      // Steps beyond `steps` remain untriggered (default)
    }

    return { patternDesc: pattern, nextState: {} };
  }
}

// ── 2. ProbabilityGate ──────────────────────────────────────────────

export class ProbabilityGate extends Primitive {
  constructor() {
    super('ProbabilityGate', 'processor', [
      { name: 'density', default: 0.7, boundary: 'clamp' },
      { name: 'accentProbability', default: 0.3, boundary: 'clamp' },
    ]);
  }

  process(params, patternDesc, state, rng) {
    const density = params[0];
    const accentProb = params[1];
    const pattern = clonePattern(patternDesc);
    let currentRng = rng;

    for (let i = 0; i < pattern.stepCount; i++) {
      const step = pattern.steps[i];
      if (step.trigger) {
        // Coin flip for survival
        const r1 = next(currentRng);
        currentRng = r1.nextState;

        if (r1.value >= density) {
          step.trigger = false;
          step.accent = false;
        } else {
          // Accent coin flip
          const r2 = next(currentRng);
          currentRng = r2.nextState;
          step.accent = r2.value < accentProb;
        }
      }
    }

    return { patternDesc: pattern, nextState: {} };
  }
}

// ── 3. PitchWalker ──────────────────────────────────────────────────

export class PitchWalker extends Primitive {
  constructor() {
    super('PitchWalker', 'generator', [
      { name: 'stepSize', default: 0.3, boundary: 'clamp' },
      { name: 'directionBias', default: 0.5, boundary: 'clamp' },
      { name: 'gravity', default: 0.3, boundary: 'clamp' },
      { name: 'range', default: 0.8, boundary: 'clamp' },
    ]);

    /** @private */
    this._position = 0.5;
  }

  getState() {
    return { position: this._position };
  }

  setState(savedState) {
    if (savedState && typeof savedState.position === 'number') {
      this._position = savedState.position;
    }
  }

  process(params, patternDesc, state, rng) {
    const stepSize = params[0];
    const directionBias = params[1];
    const gravity = params[2];
    const range = params[3];

    // Restore position from state if provided
    let position = (state && typeof state.position === 'number')
      ? state.position
      : this._position;

    const pattern = createPattern(patternDesc.stepCount);
    let currentRng = rng;

    // Use incoming pattern's triggers if available, otherwise all triggered
    const srcSteps = patternDesc.steps;

    for (let i = 0; i < patternDesc.stepCount; i++) {
      const triggered = srcSteps[i].trigger;

      if (triggered) {
        // Random walk step
        const r1 = next(currentRng);
        currentRng = r1.nextState;

        // Direction: bias + gravity toward center
        const gravityPull = (0.5 - position) * gravity;
        const biasOffset = (directionBias - 0.5) * 2; // [-1, 1]
        const direction = biasOffset + gravityPull;

        // Random component: [-1, 1] scaled by stepSize
        const randomComponent = (r1.value * 2 - 1) * stepSize * range;
        const delta = direction * stepSize * 0.5 + randomComponent;

        position = position + delta;
        // Clamp to [0, 1]
        if (position < 0) position = 0;
        if (position > 1) position = 1;

        setStep(pattern, i, { trigger: true, pitch: position });
      }
      // Untriggered steps keep default pitch, trigger=false
    }

    this._position = position;

    return {
      patternDesc: pattern,
      nextState: { position: position },
    };
  }
}

// ── 4. Ratchet ──────────────────────────────────────────────────────

export class Ratchet extends Primitive {
  constructor() {
    super('Ratchet', 'timing', [
      { name: 'maxDivision', default: 0.5, boundary: 'clamp' },
      { name: 'probability', default: 0.5, boundary: 'clamp' },
    ]);
  }

  process(params, patternDesc, state, rng) {
    const maxDiv = mapToInt(params[0], 1, 4);
    const probability = params[1];
    const pattern = clonePattern(patternDesc);
    let currentRng = rng;

    for (let i = 0; i < pattern.stepCount; i++) {
      const step = pattern.steps[i];
      if (step.trigger) {
        const r1 = next(currentRng);
        currentRng = r1.nextState;

        if (r1.value < probability && maxDiv > 1) {
          // Pick a subdivision count in [2, maxDiv]
          const r2 = nextInt(currentRng, 2, maxDiv);
          currentRng = r2.nextState;
          step.subdivisions = r2.value;
        }
      }
    }

    return { patternDesc: pattern, nextState: {} };
  }
}

// ── 5. SwingGroove ──────────────────────────────────────────────────

export class SwingGroove extends Primitive {
  constructor() {
    super('SwingGroove', 'timing', [
      { name: 'swingAmount', default: 0.0, boundary: 'clamp' },
      { name: 'swingGrid', default: 0.0, boundary: 'clamp' },
    ]);
  }

  process(params, patternDesc, state, rng) {
    const swingAmount = params[0];
    const pattern = clonePattern(patternDesc);

    // Max swing = 0.33 (triplet feel)
    const maxOffset = 0.33;
    const offset = swingAmount * maxOffset;

    // Apply swing to every other step (odd-indexed steps)
    for (let i = 1; i < pattern.stepCount; i += 2) {
      pattern.steps[i].timeOffset = offset;
    }

    return { patternDesc: pattern, nextState: {} };
  }
}

// ── 6. DensityMorph ─────────────────────────────────────────────────

export class DensityMorph extends Primitive {
  constructor() {
    super('DensityMorph', 'generator', [
      { name: 'density', default: 0.5, boundary: 'clamp' },
      { name: 'clustering', default: 0.0, boundary: 'clamp' },
    ]);
  }

  process(params, patternDesc, state, rng) {
    const density = params[0];
    const clustering = params[1];
    const stepCount = patternDesc.stepCount;
    const pattern = createPattern(stepCount);
    const numTriggers = Math.floor(density * stepCount);

    if (numTriggers <= 0) {
      return { patternDesc: pattern, nextState: {} };
    }
    if (numTriggers >= stepCount) {
      for (let i = 0; i < stepCount; i++) {
        setStep(pattern, i, { trigger: true });
      }
      return { patternDesc: pattern, nextState: {} };
    }

    let currentRng = rng;

    if (clustering < 0.01) {
      // Even spread: Euclidean-like placement
      for (let i = 0; i < numTriggers; i++) {
        const idx = Math.floor((i * stepCount) / numTriggers);
        setStep(pattern, idx, { trigger: true });
      }
    } else if (clustering > 0.99) {
      // Full clustering: contiguous burst
      const r1 = nextInt(currentRng, 0, stepCount - 1);
      currentRng = r1.nextState;
      const startPos = r1.value;
      for (let i = 0; i < numTriggers; i++) {
        const idx = (startPos + i) % stepCount;
        setStep(pattern, idx, { trigger: true });
      }
    } else {
      // Interpolate: place triggers with clustering-dependent spread
      // Use a "center of mass" approach:
      // Pick a random center, then distribute triggers around it
      // with spread inversely proportional to clustering
      const r1 = next(currentRng);
      currentRng = r1.nextState;
      const center = r1.value * stepCount;

      // Spread factor: low clustering = large spread, high = tight
      const spreadRadius = (1 - clustering) * stepCount * 0.5;

      // Score each step by distance from center (wrapping)
      const scores = new Float32Array(stepCount);
      for (let i = 0; i < stepCount; i++) {
        // Wrapped distance from center
        let dist = Math.abs(i - center);
        if (dist > stepCount * 0.5) dist = stepCount - dist;
        // Add small random jitter to break ties
        const r2 = next(currentRng);
        currentRng = r2.nextState;
        scores[i] = dist / (spreadRadius + 0.001) + r2.value * 0.01;
      }

      // Select the numTriggers steps with lowest scores
      const indices = new Array(stepCount);
      for (let i = 0; i < stepCount; i++) indices[i] = i;
      indices.sort(function (a, b) { return scores[a] - scores[b]; });

      for (let i = 0; i < numTriggers; i++) {
        setStep(pattern, indices[i], { trigger: true });
      }
    }

    return { patternDesc: pattern, nextState: {} };
  }
}

// ── 7. IntervalLock ─────────────────────────────────────────────────

const SCALES = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], // chromatic
  [0, 2, 4, 5, 7, 9, 11],                   // major
  [0, 2, 3, 5, 7, 8, 10],                   // natural minor
  [0, 2, 3, 5, 7, 8, 11],                   // harmonic minor
  [0, 2, 4, 7, 9],                           // pentatonic major
  [0, 3, 5, 7, 10],                          // pentatonic minor
  [0, 3, 5, 6, 7, 10],                       // blues
  [0, 2, 3, 5, 7, 9, 10],                   // dorian
  [0, 2, 4, 5, 7, 9, 10],                   // mixolydian
  [0, 2, 4, 6, 8, 10],                       // whole tone
  [0, 2, 3, 5, 6, 8, 9, 11],               // diminished
];

export class IntervalLock extends Primitive {
  constructor() {
    super('IntervalLock', 'converter', [
      { name: 'root', default: 0.0, boundary: 'clamp' },
      { name: 'mode', default: 0.0, boundary: 'clamp' },
      { name: 'octaveRange', default: 0.25, boundary: 'clamp' },
    ]);
  }

  process(params, patternDesc, state, rng) {
    const root = mapToInt(params[0], 0, 11);
    const scaleIdx = mapToInt(params[1], 0, SCALES.length - 1);
    const octaveRange = mapToInt(params[2], 1, 4);
    const scale = SCALES[scaleIdx];

    const pattern = clonePattern(patternDesc);

    // Build the full set of MIDI notes in this scale + root + range
    const notes = [];
    for (let oct = 0; oct < octaveRange; oct++) {
      for (let i = 0; i < scale.length; i++) {
        const midiNote = root + scale[i] + oct * 12;
        if (midiNote <= 127) {
          notes.push(midiNote);
        }
      }
    }

    if (notes.length === 0) {
      return { patternDesc: pattern, nextState: {} };
    }

    for (let i = 0; i < pattern.stepCount; i++) {
      const step = pattern.steps[i];
      // Quantize pitch [0,1] to nearest note in our scale
      const targetIdx = Math.round(step.pitch * (notes.length - 1));
      const clampedIdx = targetIdx < 0 ? 0 : targetIdx >= notes.length ? notes.length - 1 : targetIdx;
      // Store as MIDI note / 127 to stay in [0,1]
      step.pitch = notes[clampedIdx] / 127;
    }

    return { patternDesc: pattern, nextState: {} };
  }
}

// ── 8. VelocityShaper ───────────────────────────────────────────────

export class VelocityShaper extends Primitive {
  constructor() {
    super('VelocityShaper', 'processor', [
      { name: 'curveType', default: 0.0, boundary: 'clamp' },
      { name: 'depth', default: 0.5, boundary: 'clamp' },
      { name: 'phase', default: 0.0, boundary: 'wrap' },
    ]);
  }

  process(params, patternDesc, state, rng) {
    const curveIdx = mapToInt(params[0], 0, 4);
    const depth = params[1];
    const phase = params[2];
    const pattern = clonePattern(patternDesc);
    const stepCount = pattern.stepCount;
    let currentRng = rng;

    for (let i = 0; i < stepCount; i++) {
      const step = pattern.steps[i];
      if (!step.trigger) continue;

      // Phase-shifted position
      const pos = ((i / stepCount) + phase) % 1;
      let shapeValue;

      switch (curveIdx) {
        case 0: // flat
          shapeValue = 1.0;
          break;
        case 1: // accent-every-N (accent every 4th step)
          shapeValue = ((i + Math.floor(phase * stepCount)) % 4 === 0) ? 1.0 : 0.5;
          break;
        case 2: // crescendo
          shapeValue = pos;
          break;
        case 3: // decrescendo
          shapeValue = 1.0 - pos;
          break;
        case 4: { // random
          const r1 = next(currentRng);
          currentRng = r1.nextState;
          shapeValue = r1.value;
          break;
        }
        default:
          shapeValue = 1.0;
      }

      // Apply depth: interpolate between uniform (1.0) and shaped
      // depth=0 means all same velocity (base), depth=1 means full shape
      const baseVelocity = 0.7;
      const shaped = shapeValue;
      step.velocity = baseVelocity * (1 - depth) + shaped * depth;

      // Clamp
      if (step.velocity < 0) step.velocity = 0;
      if (step.velocity > 1) step.velocity = 1;
    }

    return { patternDesc: pattern, nextState: {} };
  }
}

// ── Registry ────────────────────────────────────────────────────────

export const PRIMITIVE_REGISTRY = {
  EuclideanRhythm: EuclideanRhythm,
  ProbabilityGate: ProbabilityGate,
  PitchWalker: PitchWalker,
  Ratchet: Ratchet,
  SwingGroove: SwingGroove,
  DensityMorph: DensityMorph,
  IntervalLock: IntervalLock,
  VelocityShaper: VelocityShaper,
};
