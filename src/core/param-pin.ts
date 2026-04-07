/**
 * Parameter Pin Manager — Per-output pin flags
 *
 * Pinned parameters keep their current mapping during RL exploration (moveWeights)
 * and training. The strategy for the WASM path:
 *   1. Before moveWeights: snapshot weights for pinned output nodes' final-layer connections
 *   2. Call moveWeights normally
 *   3. After moveWeights: restore snapshotted weights
 * This weight-restore dance is handled by the app/store integration layer, not here.
 *
 * Ported from playground/js/ui/param-pin.js
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface ParamPinState {
  numOutputs: number;
  pinned: number[];
}

export interface ParamPinManager {
  /** Pin a specific output index. No-op if already pinned or out of range. */
  pin(index: number): void;

  /** Unpin a specific output index. No-op if already unpinned or out of range. */
  unpin(index: number): void;

  /** Toggle pin state. Returns the new state (true = pinned). Returns false for out-of-range. */
  toggle(index: number): boolean;

  /** Check if a specific output is pinned. Returns false for out-of-range indices. */
  isPinned(index: number): boolean;

  /**
   * Get the full pin mask as a Uint8Array.
   * Length = numOutputs. 1 = pinned, 0 = unpinned.
   * Note: this is the live internal array — copy if you need a snapshot.
   */
  getPinMask(): Uint8Array;

  /** Get array of pinned output indices. */
  getPinnedIndices(): number[];

  /** Total number of currently pinned outputs. */
  getPinnedCount(): number;

  /** Unpin all outputs. */
  clear(): void;

  /**
   * Resize the pin mask to a new output count.
   * Existing pins within the new range are preserved; truncated pins are lost.
   */
  resize(newSize: number): void;

  /** Serialize state for save/restore. */
  getState(): ParamPinState;

  /** Restore state from serialized form. */
  setState(saved: ParamPinState): void;
}

// ─── Implementation ──────────────────────────────────────────────────

export class ParamPinManagerImpl implements ParamPinManager {
  private _numOutputs: number;
  private _pinned: Uint8Array;

  constructor(numOutputs: number) {
    this._numOutputs = numOutputs;
    this._pinned = new Uint8Array(numOutputs); // all 0 (unpinned) by default
  }

  // ---- Public API ----

  pin(index: number): void {
    if (index < 0 || index >= this._numOutputs) return;
    this._pinned[index] = 1;
  }

  unpin(index: number): void {
    if (index < 0 || index >= this._numOutputs) return;
    this._pinned[index] = 0;
  }

  toggle(index: number): boolean {
    if (index < 0 || index >= this._numOutputs) return false;
    if (this._pinned[index]) {
      this._pinned[index] = 0;
      return false;
    } else {
      this._pinned[index] = 1;
      return true;
    }
  }

  isPinned(index: number): boolean {
    if (index < 0 || index >= this._numOutputs) return false;
    return this._pinned[index] === 1;
  }

  getPinMask(): Uint8Array {
    return this._pinned;
  }

  getPinnedIndices(): number[] {
    const indices: number[] = [];
    for (let i = 0; i < this._numOutputs; i++) {
      if (this._pinned[i]) indices.push(i);
    }
    return indices;
  }

  getPinnedCount(): number {
    let count = 0;
    for (let i = 0; i < this._numOutputs; i++) {
      if (this._pinned[i]) count++;
    }
    return count;
  }

  clear(): void {
    this._pinned.fill(0);
  }

  resize(newSize: number): void {
    if (newSize === this._numOutputs) return;
    const next = new Uint8Array(newSize);
    const copyLen = Math.min(this._numOutputs, newSize);
    for (let i = 0; i < copyLen; i++) {
      next[i] = this._pinned[i];
    }
    this._pinned = next;
    this._numOutputs = newSize;
  }

  // ---- Serialization ----

  getState(): ParamPinState {
    return {
      numOutputs: this._numOutputs,
      pinned: Array.from(this._pinned),
    };
  }

  setState(saved: ParamPinState): void {
    if (!saved) return;
    if (Array.isArray(saved.pinned)) {
      const len = Math.min(saved.pinned.length, this._numOutputs);
      for (let i = 0; i < len; i++) {
        this._pinned[i] = saved.pinned[i] ? 1 : 0;
      }
    }
  }
}

/** Convenience factory function */
export function createParamPinManager(numOutputs: number): ParamPinManager {
  return new ParamPinManagerImpl(numOutputs);
}
