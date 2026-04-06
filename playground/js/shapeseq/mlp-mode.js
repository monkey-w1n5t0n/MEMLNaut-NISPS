/**
 * MLP mode manager — switches between unified and dual MLP operation.
 *
 * Unified: single MLP, outputs partitioned between timbre and sequence.
 * Dual: separate MLPs for timbre and sequence, independent training.
 */

export const MLP_MODES = Object.freeze({ UNIFIED: 'unified', DUAL: 'dual' });

export class MLPModeManager {
  constructor() {
    this._mode = MLP_MODES.DUAL; // default to dual (current architecture)
    this._unifiedSliceStart = 0;  // where sequence outputs start in unified mode
    this._unifiedSliceCount = 16; // how many outputs go to sequence in unified mode
  }

  get mode() { return this._mode; }

  /**
   * Configure unified mode: which slice of the timbre MLP outputs feeds the sequencer.
   * @param {number} start - first output index for sequence
   * @param {number} count - number of outputs for sequence
   */
  setUnifiedConfig(start, count) {
    this._unifiedSliceStart = start;
    this._unifiedSliceCount = count;
  }

  get unifiedSliceStart() { return this._unifiedSliceStart; }
  get unifiedSliceCount() { return this._unifiedSliceCount; }

  setMode(mode) {
    if (mode !== MLP_MODES.UNIFIED && mode !== MLP_MODES.DUAL) {
      throw new TypeError('Invalid MLP mode: ' + mode);
    }
    this._mode = mode;
  }

  /**
   * Extract sequence params from a timbre MLP's outputs (unified mode).
   * @param {Float32Array} timbreOutputs - full output array from the timbre MLP
   * @returns {Float32Array} slice for the sequence engine
   */
  extractSequenceOutputs(timbreOutputs) {
    const start = this._unifiedSliceStart;
    const count = this._unifiedSliceCount;
    const result = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const idx = start + i;
      result[i] = idx < timbreOutputs.length ? timbreOutputs[idx] : 0.5;
    }
    return result;
  }
}
