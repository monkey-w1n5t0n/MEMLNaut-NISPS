// Snapshot Stack — Multi-level undo for weight states
//
// A ring buffer of weight snapshots tagged with context (e.g. "before thumbs-down",
// "before train"). Auto-snapshot triggers in the app push snapshots before destructive
// operations. Users can undo (pop), peek, list, or jump to any snapshot.
//
// Each snapshot stores:
//   - weights: the full flat weight array (Array<number> or Float32Array)
//   - noiseLevel: the RL noise level at time of snapshot
//   - zoomLevel: the input pipeline zoom level (optional)
//   - tag: human-readable label for UI display
//   - timestamp: Date.now() when captured
//
// Usage:
//   import { SnapshotStack } from './snapshot-stack.js';
//   const stack = new SnapshotStack(20);
//   stack.push('before thumbs-down', { weights, noiseLevel, zoomLevel });
//   const prev = stack.pop(); // undo

export class SnapshotStack {
  /**
   * @param {number} maxSnapshots Ring buffer capacity. Oldest evicted when full.
   */
  constructor(maxSnapshots = 20) {
    this._max = maxSnapshots;
    this._stack = []; // Array of { tag, timestamp, state: { weights, noiseLevel, zoomLevel } }
  }

  // ---- Core operations ----

  /**
   * Push a snapshot onto the stack.
   * @param {string} tag  Human-readable label (e.g. "before thumbs-down")
   * @param {{ weights: Array|Float32Array, noiseLevel: number, zoomLevel?: number }} state
   */
  push(tag, state) {
    const snapshot = {
      tag,
      timestamp: Date.now(),
      state: {
        weights: Array.isArray(state.weights)
          ? [...state.weights]
          : Array.from(state.weights),
        noiseLevel: state.noiseLevel ?? 0,
        zoomLevel: state.zoomLevel ?? 1.0,
      },
    };

    this._stack.push(snapshot);

    // Ring buffer eviction: drop oldest if over capacity
    if (this._stack.length > this._max) {
      this._stack.shift();
    }

    this._dispatch('snapshot:push', { tag, depth: this.depth });
  }

  /**
   * Pop the most recent snapshot (undo).
   * @returns {{ weights: Array, noiseLevel: number, zoomLevel: number }|null}
   */
  pop() {
    if (this._stack.length === 0) return null;
    const snapshot = this._stack.pop();
    this._dispatch('snapshot:pop', { tag: snapshot.tag, depth: this.depth });
    return snapshot.state;
  }

  /**
   * Peek at the most recent snapshot without removing it.
   * @returns {{ weights: Array, noiseLevel: number, zoomLevel: number }|null}
   */
  peek() {
    if (this._stack.length === 0) return null;
    return this._stack[this._stack.length - 1].state;
  }

  /**
   * List all snapshots (newest last) for UI display.
   * @returns {Array<{ tag: string, timestamp: number, index: number }>}
   */
  list() {
    return this._stack.map((snap, i) => ({
      tag: snap.tag,
      timestamp: snap.timestamp,
      index: i,
    }));
  }

  /**
   * Jump to a specific snapshot by index. Removes everything above it.
   * @param {number} index
   * @returns {{ weights: Array, noiseLevel: number, zoomLevel: number }|null}
   */
  jumpTo(index) {
    if (index < 0 || index >= this._stack.length) return null;
    const snapshot = this._stack[index];
    // Truncate: keep entries 0..index (inclusive), remove the rest
    this._stack = this._stack.slice(0, index);
    this._dispatch('snapshot:jump', { tag: snapshot.tag, depth: this.depth });
    return snapshot.state;
  }

  /**
   * Current stack depth.
   * @returns {number}
   */
  get depth() {
    return this._stack.length;
  }

  /**
   * Clear all snapshots.
   */
  clear() {
    this._stack = [];
    this._dispatch('snapshot:clear', { depth: 0 });
  }

  // ---- Serialization ----

  /**
   * Serialize for localStorage persistence.
   */
  getState() {
    return {
      max: this._max,
      snapshots: this._stack.map(s => ({
        tag: s.tag,
        timestamp: s.timestamp,
        state: {
          weights: s.state.weights,
          noiseLevel: s.state.noiseLevel,
          zoomLevel: s.state.zoomLevel,
        },
      })),
    };
  }

  /**
   * Restore from serialized state.
   */
  setState(saved) {
    if (!saved) return;
    if (typeof saved.max === 'number') this._max = saved.max;
    if (Array.isArray(saved.snapshots)) {
      this._stack = saved.snapshots.map(s => ({
        tag: s.tag || 'restored',
        timestamp: s.timestamp || Date.now(),
        state: {
          weights: s.state?.weights || [],
          noiseLevel: s.state?.noiseLevel ?? 0,
          zoomLevel: s.state?.zoomLevel ?? 1.0,
        },
      }));
      // Trim to capacity
      while (this._stack.length > this._max) {
        this._stack.shift();
      }
    }
  }

  // ---- Internal ----

  _dispatch(type, detail) {
    document.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
