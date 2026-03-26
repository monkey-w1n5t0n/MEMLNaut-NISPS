// Parameter Pin Manager — Per-output pin flags
//
// Pinned parameters keep their current mapping during moveWeights and training.
// During moveWeights, weights in the final layer connecting to pinned output nodes
// are skipped. During training, pinned outputs have their labels frozen to current
// inferred values so the network maintains the learned mapping.
//
// For the WASM path (which doesn't support pin masks natively), the approach is:
//   1. Before moveWeights: snapshot weights for pinned output nodes' final-layer connections
//   2. After moveWeights: restore those weights
// This is handled by the app integration, not inside this module.
//
// Usage:
//   import { ParamPinManager } from './param-pin.js';
//   const paramPins = new ParamPinManager(126);
//   paramPins.pin(42);      // pin output #42
//   paramPins.toggle(42);   // unpin
//   const mask = paramPins.getPinMask(); // Uint8Array[126], 1 = pinned

export class ParamPinManager {
  /**
   * @param {number} numOutputs  Total number of output parameters
   */
  constructor(numOutputs) {
    this._numOutputs = numOutputs;
    this._pinned = new Uint8Array(numOutputs); // 0 = unpinned, 1 = pinned
  }

  // ---- Public API ----

  /**
   * Pin a specific output index.
   * @param {number} outputIndex
   */
  pin(outputIndex) {
    if (outputIndex < 0 || outputIndex >= this._numOutputs) return;
    if (this._pinned[outputIndex] === 1) return; // already pinned
    this._pinned[outputIndex] = 1;
    this._dispatch('parampin:change', {
      index: outputIndex,
      pinned: true,
      totalPinned: this.pinnedCount,
    });
  }

  /**
   * Unpin a specific output index.
   * @param {number} outputIndex
   */
  unpin(outputIndex) {
    if (outputIndex < 0 || outputIndex >= this._numOutputs) return;
    if (this._pinned[outputIndex] === 0) return; // already unpinned
    this._pinned[outputIndex] = 0;
    this._dispatch('parampin:change', {
      index: outputIndex,
      pinned: false,
      totalPinned: this.pinnedCount,
    });
  }

  /**
   * Toggle pin state for a specific output index.
   * @param {number} outputIndex
   * @returns {boolean} New pin state (true = pinned).
   */
  toggle(outputIndex) {
    if (outputIndex < 0 || outputIndex >= this._numOutputs) return false;
    if (this._pinned[outputIndex]) {
      this.unpin(outputIndex);
      return false;
    } else {
      this.pin(outputIndex);
      return true;
    }
  }

  /**
   * Check if a specific output is pinned.
   * @param {number} outputIndex
   * @returns {boolean}
   */
  isPinned(outputIndex) {
    if (outputIndex < 0 || outputIndex >= this._numOutputs) return false;
    return this._pinned[outputIndex] === 1;
  }

  /**
   * Get the full pin mask.
   * @returns {Uint8Array} Length = numOutputs. 1 = pinned, 0 = unpinned.
   */
  getPinMask() {
    return this._pinned;
  }

  /**
   * Get array of pinned output indices.
   * @returns {number[]}
   */
  getPinnedIndices() {
    const indices = [];
    for (let i = 0; i < this._numOutputs; i++) {
      if (this._pinned[i]) indices.push(i);
    }
    return indices;
  }

  /**
   * Number of currently pinned outputs.
   * @returns {number}
   */
  get pinnedCount() {
    let count = 0;
    for (let i = 0; i < this._numOutputs; i++) {
      if (this._pinned[i]) count++;
    }
    return count;
  }

  /**
   * Unpin all outputs.
   */
  clearAll() {
    this._pinned.fill(0);
    this._dispatch('parampin:clearall', { totalPinned: 0 });
  }

  // ---- Serialization ----

  getState() {
    return {
      numOutputs: this._numOutputs,
      pinned: Array.from(this._pinned),
    };
  }

  setState(saved) {
    if (!saved) return;
    if (Array.isArray(saved.pinned)) {
      const len = Math.min(saved.pinned.length, this._numOutputs);
      for (let i = 0; i < len; i++) {
        this._pinned[i] = saved.pinned[i] ? 1 : 0;
      }
    }
  }

  // ---- Internal ----

  _dispatch(type, detail) {
    document.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
