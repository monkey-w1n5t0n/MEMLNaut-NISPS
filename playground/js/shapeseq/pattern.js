/**
 * ShapeSeq Pattern Description Data Structure
 *
 * The foundational data type for the ShapeSeq sequencing system.
 * A pattern description is the symbolic output of the primitive chain --
 * a complete loop description that the clock engine steps through.
 *
 * Port-ready: typed arrays where possible, explicit construction, no closures.
 *
 * @module shapeseq/pattern
 */

// --- Step defaults ---

const DEFAULT_TRIGGER = false;
const DEFAULT_PITCH = 0.5;
const DEFAULT_VELOCITY = 0.7;
const DEFAULT_ACCENT = false;
const DEFAULT_TIME_OFFSET = 0.0;
const DEFAULT_SUBDIVISIONS = 1;

/**
 * Create a single step with default values.
 *
 * @returns {{ trigger: boolean, pitch: number, velocity: number, accent: boolean, timeOffset: number, subdivisions: number }}
 */
export function createStep() {
  return {
    trigger: DEFAULT_TRIGGER,
    pitch: DEFAULT_PITCH,
    velocity: DEFAULT_VELOCITY,
    accent: DEFAULT_ACCENT,
    timeOffset: DEFAULT_TIME_OFFSET,
    subdivisions: DEFAULT_SUBDIVISIONS,
    midiNote: null,
  };
}

/**
 * Create a pattern description with the given step count, all steps at defaults.
 *
 * @param {number} stepCount - Number of steps (must be positive integer)
 * @returns {{ steps: Array, stepCount: number, metadata: Object }}
 */
export function createPattern(stepCount) {
  const count = stepCount | 0; // coerce to int
  if (count < 1) {
    throw new RangeError('stepCount must be >= 1, got ' + stepCount);
  }

  const steps = new Array(count);
  for (let i = 0; i < count; i++) {
    steps[i] = createStep();
  }

  return {
    steps: steps,
    stepCount: count,
    metadata: {},
  };
}

/**
 * Deep clone a pattern description.
 * Needed for chain processing where each primitive transforms a copy.
 *
 * @param {{ steps: Array, stepCount: number, metadata: Object }} pattern
 * @returns {{ steps: Array, stepCount: number, metadata: Object }}
 */
export function clonePattern(pattern) {
  const count = pattern.stepCount;
  const srcSteps = pattern.steps;
  const steps = new Array(count);

  for (let i = 0; i < count; i++) {
    const s = srcSteps[i];
    steps[i] = {
      trigger: s.trigger,
      pitch: s.pitch,
      velocity: s.velocity,
      accent: s.accent,
      timeOffset: s.timeOffset,
      subdivisions: s.subdivisions,
      midiNote: s.midiNote,
    };
  }

  // Shallow clone metadata (one level deep for plain-object metadata)
  const srcMeta = pattern.metadata;
  const metadata = {};
  const keys = Object.keys(srcMeta);
  for (let i = 0; i < keys.length; i++) {
    metadata[keys[i]] = srcMeta[keys[i]];
  }

  return {
    steps: steps,
    stepCount: count,
    metadata: metadata,
  };
}

/**
 * Merge two patterns together.
 *
 * Both patterns must have the same stepCount.
 * Returns a new pattern (does not mutate inputs).
 *
 * @param {{ steps: Array, stepCount: number, metadata: Object }} patternA
 * @param {{ steps: Array, stepCount: number, metadata: Object }} patternB
 * @param {'additive'|'multiplicative'} mode
 *   - 'additive': triggers OR'd, pitch/velocity averaged
 *   - 'multiplicative': triggers AND'd, pitch/velocity averaged
 * @returns {{ steps: Array, stepCount: number, metadata: Object }}
 */
export function mergePatterns(patternA, patternB, mode) {
  if (patternA.stepCount !== patternB.stepCount) {
    throw new RangeError(
      'Cannot merge patterns with different step counts: ' +
        patternA.stepCount + ' vs ' + patternB.stepCount
    );
  }
  if (mode !== 'additive' && mode !== 'multiplicative') {
    throw new TypeError("mode must be 'additive' or 'multiplicative', got '" + mode + "'");
  }

  const count = patternA.stepCount;
  const stepsA = patternA.steps;
  const stepsB = patternB.steps;
  const steps = new Array(count);
  const isAdditive = mode === 'additive';

  for (let i = 0; i < count; i++) {
    const a = stepsA[i];
    const b = stepsB[i];

    const trigger = isAdditive ? (a.trigger || b.trigger) : (a.trigger && b.trigger);
    const bothTriggered = a.trigger && b.trigger;

    let pitch, velocity, accent, timeOffset, subdivisions, midiNote;

    if (bothTriggered) {
      // Both generators triggered: average continuous values, combine accent by mode
      pitch = (a.pitch + b.pitch) * 0.5;
      velocity = (a.velocity + b.velocity) * 0.5;
      accent = isAdditive ? (a.accent || b.accent) : (a.accent && b.accent);
      timeOffset = (a.timeOffset + b.timeOffset) * 0.5;
      subdivisions = Math.max(a.subdivisions, b.subdivisions);
      // midiNote: both set → average (rounded), one set → use it, neither → null
      if (a.midiNote != null && b.midiNote != null) {
        midiNote = Math.round((a.midiNote + b.midiNote) * 0.5);
      } else if (a.midiNote != null) {
        midiNote = a.midiNote;
      } else if (b.midiNote != null) {
        midiNote = b.midiNote;
      } else {
        midiNote = null;
      }
    } else if (a.trigger) {
      // Only A triggered: use A's values directly
      pitch = a.pitch;
      velocity = a.velocity;
      accent = a.accent;
      timeOffset = a.timeOffset;
      subdivisions = a.subdivisions;
      midiNote = a.midiNote;
    } else if (b.trigger) {
      // Only B triggered: use B's values directly
      pitch = b.pitch;
      velocity = b.velocity;
      accent = b.accent;
      timeOffset = b.timeOffset;
      subdivisions = b.subdivisions;
      midiNote = b.midiNote;
    } else {
      // Neither triggered: defaults
      pitch = DEFAULT_PITCH;
      velocity = DEFAULT_VELOCITY;
      accent = DEFAULT_ACCENT;
      timeOffset = DEFAULT_TIME_OFFSET;
      subdivisions = DEFAULT_SUBDIVISIONS;
      midiNote = null;
    }

    steps[i] = {
      trigger: trigger,
      pitch: pitch,
      velocity: velocity,
      accent: accent,
      timeOffset: timeOffset,
      subdivisions: subdivisions,
      midiNote: midiNote,
    };
  }

  return {
    steps: steps,
    stepCount: count,
    metadata: {},
  };
}

/**
 * Update a specific step in a pattern (mutates the pattern in place).
 *
 * Only the fields present in stepData are updated; others remain unchanged.
 *
 * @param {{ steps: Array, stepCount: number, metadata: Object }} pattern
 * @param {number} index - Step index (0-based)
 * @param {Object} stepData - Partial step data to apply
 */
export function setStep(pattern, index, stepData) {
  const idx = index | 0;
  if (idx < 0 || idx >= pattern.stepCount) {
    throw new RangeError('Step index ' + index + ' out of range [0, ' + (pattern.stepCount - 1) + ']');
  }

  const step = pattern.steps[idx];

  if (stepData.trigger !== undefined) step.trigger = !!stepData.trigger;
  if (stepData.pitch !== undefined) step.pitch = +stepData.pitch;
  if (stepData.velocity !== undefined) step.velocity = +stepData.velocity;
  if (stepData.accent !== undefined) step.accent = !!stepData.accent;
  if (stepData.timeOffset !== undefined) step.timeOffset = +stepData.timeOffset;
  if (stepData.subdivisions !== undefined) step.subdivisions = stepData.subdivisions | 0;
  if (stepData.midiNote !== undefined) step.midiNote = stepData.midiNote === null ? null : stepData.midiNote | 0;
}

/**
 * Validate a pattern description structure.
 *
 * Checks:
 *  - pattern is an object with steps array, stepCount int, metadata object
 *  - steps.length === stepCount
 *  - Each step has all required fields with correct types and in-range values
 *
 * @param {*} pattern
 * @returns {boolean}
 */
export function validatePattern(pattern) {
  if (pattern == null || typeof pattern !== 'object') return false;
  if (typeof pattern.stepCount !== 'number' || (pattern.stepCount | 0) < 1) return false;
  if (pattern.stepCount !== (pattern.stepCount | 0)) return false;
  if (!Array.isArray(pattern.steps)) return false;
  if (pattern.steps.length !== pattern.stepCount) return false;
  if (pattern.metadata == null || typeof pattern.metadata !== 'object') return false;

  const steps = pattern.steps;
  const count = pattern.stepCount;

  for (let i = 0; i < count; i++) {
    const s = steps[i];
    if (s == null || typeof s !== 'object') return false;
    if (typeof s.trigger !== 'boolean') return false;
    if (typeof s.pitch !== 'number' || s.pitch < 0 || s.pitch > 1) return false;
    if (typeof s.velocity !== 'number' || s.velocity < 0 || s.velocity > 1) return false;
    if (typeof s.accent !== 'boolean') return false;
    if (typeof s.timeOffset !== 'number' || s.timeOffset < -0.5 || s.timeOffset > 0.5) return false;
    if (typeof s.subdivisions !== 'number' || (s.subdivisions | 0) < 1 || (s.subdivisions | 0) > 4) return false;
    if (s.subdivisions !== (s.subdivisions | 0)) return false;
    // midiNote: null (pre-quantization) or integer 0-127
    if (s.midiNote !== null) {
      if (typeof s.midiNote !== 'number') return false;
      if (s.midiNote !== (s.midiNote | 0)) return false;
      if (s.midiNote < 0 || s.midiNote > 127) return false;
    }
  }

  return true;
}
