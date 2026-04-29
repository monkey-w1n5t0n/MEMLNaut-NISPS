/**
 * Debug probe: window.__nisps
 *
 * Stream 8 (this stream) installs a stub that returns placeholder values.
 * Stream 10 wires real ML calls. Keeping the install path stable here means
 * Playwright tests can rely on `window.__nisps` existing from page load even
 * before the ML engine boots.
 *
 * All methods MUST be synchronous (or return immediately-resolved promises).
 * The probe deliberately bypasses Solid reactivity so tests get deterministic,
 * imperative semantics.
 */

export interface DebugProbe {
  /** Current 126-element output vector (Float32Array). */
  getOutputs(): Float32Array;
  /** Last training loss, or null if no training has occurred. */
  getLoss(): number | null;
  /** Flat weight array (~13K floats once wired). */
  getWeights(): Float32Array;
  /** Number of training examples currently in the dataset. */
  getExampleCount(): number;
  /** Set joystick X/Y in [0,1] and run inference. */
  setInputs(x: number, y: number): void;
  /** Trigger thumbs-up RL feedback (train + decay noise). */
  thumbsUp(): void;
  /** Trigger thumbs-down RL feedback (move weights + grow noise). */
  thumbsDown(): void;
  /** Synchronous training; returns final loss. */
  train(): number;
  /** Async training; returns Promise<loss>. */
  trainAsync(): Promise<number>;
  /** Randomize weights with current spread. */
  randomise(): void;
  /** Clear all training examples. */
  clearExamples(): void;
  /** Force a save to localStorage now (no debounce). */
  saveState(): void;
  /** Non-destructive loss query against current dataset. */
  evalLoss(): number | null;
  /** Batch inference: input is Nx2 array of [x,y] pairs. Output: Float32Array of N*outputSize. */
  inferBatch(points: ReadonlyArray<readonly [number, number]>): Float32Array;
  /** Per-layer weight statistics: Float32Array of layerCount * 4 (mean|w|, max|w|, dead%, sat%). */
  getLayerStats(): Float32Array;
  /** Marker showing this is a stream-8 stub. Tests can read this to skip when not ready. */
  readonly __ready: boolean;
}

declare global {
  interface Window {
    __nisps?: DebugProbe;
  }
}

const EMPTY_F32 = new Float32Array(0);

const stubProbe: DebugProbe = {
  getOutputs() {
    return EMPTY_F32;
  },
  getLoss() {
    return null;
  },
  getWeights() {
    return EMPTY_F32;
  },
  getExampleCount() {
    return 0;
  },
  setInputs(_x: number, _y: number) {
    /* no-op until ML wired */
  },
  thumbsUp() {
    /* no-op */
  },
  thumbsDown() {
    /* no-op */
  },
  train() {
    return 0;
  },
  trainAsync() {
    return Promise.resolve(0);
  },
  randomise() {
    /* no-op */
  },
  clearExamples() {
    /* no-op */
  },
  saveState() {
    /* no-op */
  },
  evalLoss() {
    return null;
  },
  inferBatch(points) {
    // Return a zero array of the right size for at least the inputs.
    return new Float32Array(points.length);
  },
  getLayerStats() {
    return EMPTY_F32;
  },
  __ready: false,
};

/**
 * Install the probe on window. Idempotent.
 *
 * Stream 10 will replace this with a fully-wired version. Until then the stub
 * advertises `__ready === false`, letting tests skip ML-dependent assertions.
 */
export function installDebugProbe(): void {
  if (typeof window === 'undefined') return;
  // Always overwrite — later streams may replace it; the marker prevents stale
  // probes from passing tests.
  window.__nisps = stubProbe;
}
