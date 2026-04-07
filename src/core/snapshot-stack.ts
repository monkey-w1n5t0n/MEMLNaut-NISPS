/**
 * SnapshotStack — Multi-level undo for weight states.
 *
 * Ring buffer of weight snapshots tagged with context (e.g. "before thumbs-down",
 * "before train"). Push before destructive operations; pop/jumpTo to restore.
 *
 * Ported from playground/js/ui/snapshot-stack.js.
 */

export interface WeightSnapshot {
  weights: number[];
  noiseLevel: number;
  tag: string;       // e.g. 'thumbs-down', 'train', 'randomize'
  timestamp: number; // Date.now()
}

/** Internal entry with full state */
interface SnapshotEntry {
  tag: string;
  timestamp: number;
  state: {
    weights: number[];
    noiseLevel: number;
  };
}

export interface SnapshotListItem {
  tag: string;
  timestamp: number;
  index: number;
}

export class SnapshotStack {
  private _max: number;
  private _stack: SnapshotEntry[];

  constructor(maxSnapshots = 20) {
    this._max = maxSnapshots;
    this._stack = [];
  }

  // ---- Core operations ----

  /**
   * Push a snapshot onto the stack.
   * @param tag  Human-readable label (e.g. "before thumbs-down")
   * @param state  Current weights and noise level
   */
  push(tag: string, state: { weights: number[] | Float32Array; noiseLevel: number }): void {
    const entry: SnapshotEntry = {
      tag,
      timestamp: Date.now(),
      state: {
        weights: Array.isArray(state.weights)
          ? [...state.weights]
          : Array.from(state.weights),
        noiseLevel: state.noiseLevel ?? 0,
      },
    };

    this._stack.push(entry);

    // Ring buffer eviction: drop oldest if over capacity
    if (this._stack.length > this._max) {
      this._stack.shift();
    }

    this._dispatch('snapshot:push', { tag, depth: this.depth });
  }

  /**
   * Pop the most recent snapshot (undo).
   * Returns the state object, or null if empty.
   */
  pop(): { weights: number[]; noiseLevel: number } | null {
    if (this._stack.length === 0) return null;
    const entry = this._stack.pop()!;
    this._dispatch('snapshot:pop', { tag: entry.tag, depth: this.depth });
    return entry.state;
  }

  /**
   * Peek at the most recent snapshot without removing it.
   */
  peek(): { weights: number[]; noiseLevel: number } | null {
    if (this._stack.length === 0) return null;
    return this._stack[this._stack.length - 1].state;
  }

  /**
   * List all snapshots (oldest first) for UI display.
   */
  list(): SnapshotListItem[] {
    return this._stack.map((snap, i) => ({
      tag: snap.tag,
      timestamp: snap.timestamp,
      index: i,
    }));
  }

  /**
   * Jump to a specific snapshot by index. Removes everything above it.
   * Returns the state at that index, or null if out of range.
   */
  jumpTo(index: number): { weights: number[]; noiseLevel: number } | null {
    if (index < 0 || index >= this._stack.length) return null;
    const entry = this._stack[index];
    // Truncate: keep 0..index inclusive
    this._stack = this._stack.slice(0, index + 1);
    this._dispatch('snapshot:jump', { tag: entry.tag, depth: this.depth });
    return entry.state;
  }

  /** Current stack depth */
  get depth(): number {
    return this._stack.length;
  }

  /** Clear all snapshots */
  clear(): void {
    this._stack = [];
    this._dispatch('snapshot:clear', { depth: 0 });
  }

  // ---- Serialization ----

  /** Serialize for localStorage persistence */
  getState(): { max: number; snapshots: SnapshotEntry[] } {
    return {
      max: this._max,
      snapshots: this._stack.map(s => ({
        tag: s.tag,
        timestamp: s.timestamp,
        state: {
          weights: s.state.weights,
          noiseLevel: s.state.noiseLevel,
        },
      })),
    };
  }

  /** Restore from serialized state */
  setState(saved: { max?: number; snapshots?: SnapshotEntry[] }): void {
    if (!saved) return;
    if (typeof saved.max === 'number') this._max = saved.max;
    if (Array.isArray(saved.snapshots)) {
      this._stack = saved.snapshots.map(s => ({
        tag: s.tag || 'restored',
        timestamp: s.timestamp || Date.now(),
        state: {
          weights: s.state?.weights || [],
          noiseLevel: s.state?.noiseLevel ?? 0,
        },
      }));
      // Trim to capacity
      while (this._stack.length > this._max) {
        this._stack.shift();
      }
    }
  }

  // ---- Internal ----

  private _dispatch(type: string, detail: Record<string, unknown>): void {
    document.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
