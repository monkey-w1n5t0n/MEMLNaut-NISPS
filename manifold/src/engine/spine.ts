/**
 * Reactive spine — the external store that lives BELOW React.
 *
 * Per findings-design-and-manifold.md §4: the SolidJS spine was
 *   inputRaw → memo(processed) → memo(ml) → memo(routed) → effect(backend.send)
 * which recomputes on Solid's reactive graph. In React we must NOT couple the
 * per-frame audio inference to the render scheduler. So the spine is a tiny
 * hand-rolled observable: the `setInput` ACTION derives processed → ml → routed
 * EAGERLY + SYNCHRONOUSLY (input pipeline → WasmIML.processInto → output
 * pipeline) and fires the single `backend.send` at the action TAIL, off React's
 * render cycle.
 *
 * React subscribes via `useSyncExternalStore(subscribe, version)` — the version
 * counter, NOT the array — and reads the live `Float32Array` imperatively (so
 * canvases never re-render per frame).
 *
 * Buffers are reused (no per-frame allocation): `routedBuf` is a single
 * Float32Array threaded through the output pipeline and handed to the backend.
 */

import {
  defaultInputConfig,
  defaultInputState,
  processInput,
  type InputConfig,
  type InputState,
} from './input-pipeline';
import {
  defaultOutputConfig,
  defaultOutputState,
  processOutput,
  type OutputConfig,
  type OutputState,
} from './output-pipeline';
import type { EngineSink, EngineStatePatch } from './sink';
import type { WasmIML } from './wasm-iml';

/**
 * Float32Array that may be backed by either a plain ArrayBuffer or a
 * SharedArrayBuffer (TS 5.7+ made `Float32Array` generic over its buffer).
 * The output pipeline returns the loosely-typed form; we keep our reused
 * buffers loosely typed too so assignment doesn't fight the lib types.
 */
type F32 = Float32Array<ArrayBufferLike>;

/** The single side-effect the spine fires at the tail of each `setInput`. */
export type BackendSend = (routed: Float32Array) => void;

export interface SpineState {
  /** Monotonically increasing; bumped on every state change. */
  version: number;
  ready: boolean;
  training: boolean;
  exampleCount: number;
  lastLoss: number | null;
  lossHistory: ReadonlyArray<number>;
  inputSize: number;
  outputSize: number;
}

/**
 * The spine doubles as the `EngineSink` consumed by `WasmIML`. WasmIML calls
 * `setState/setOutputs/setWeights/emit`; the spine merges into its state,
 * stashes the live output/weight buffers, and bumps the version counter so
 * `useSyncExternalStore` consumers re-read.
 */
export class Spine implements EngineSink {
  private state_: SpineState = {
    version: 0,
    ready: false,
    training: false,
    exampleCount: 0,
    lastLoss: null,
    lossHistory: [],
    inputSize: 2,
    outputSize: 126,
  };

  private listeners = new Set<() => void>();
  private eventListeners = new Map<string, Set<(payload?: unknown) => void>>();

  // Engine handles wired in via `attach`.
  private iml: WasmIML | null = null;
  private backendSend: BackendSend | null = null;

  // Pipeline config + per-frame state.
  inputConfig: InputConfig = defaultInputConfig();
  outputConfig: OutputConfig = { ...defaultOutputConfig(), reuseBuffer: true };
  private inputState: InputState = defaultInputState();
  private outputState: OutputState = defaultOutputState();

  // Reused per-frame buffers — NO per-frame allocation in the hot path.
  private rawInput: [number, number] = [0.5, 0.5];
  // Last raw input, so `EngineApi.process()` can re-tick after a weight change.
  lastRawX = 0.5;
  lastRawY = 0.5;
  // Full last raw input vector (N-D) for re-ticking without losing extra axes.
  private lastRawInputs: Float32Array = new Float32Array(2);
  private mlBuf: F32 = new Float32Array(126);
  private routedBuf: F32 | null = null;

  // Last live output (post-ML, pre-routing) and weights, read imperatively.
  private liveOutputs: F32 = new Float32Array(126);
  private liveWeights: F32 = new Float32Array(0);

  // Optional post-output transform, applied to the routed buffer AFTER the
  // output pipeline and BEFORE backend.send (exploration noise — see
  // engine/exploration.ts). Inert (null) by default so the spine stays
  // parity-safe; the OU morph itself is a no-op until intensity > 0.
  private outputMorph: ((routed: Float32Array) => void) | null = null;

  private lastTickMs = 0;
  // Optional fixed per-tick dt (seconds). null ⇒ real wall-clock dt. Set under
  // ?debug=1 (see App.tsx) so the input/output pipeline smoothing + momentum are
  // deterministic across runs — the pipelines otherwise read performance.now(),
  // which makes single-tick EMA lag (and therefore feedback/inference deltas)
  // timing-dependent and flaky in tests. Production keeps real-time dt.
  private fixedDt: number | null = null;

  /** Pin a deterministic per-tick dt (seconds), or null to use wall-clock. */
  setFixedDt(dt: number | null): void {
    this.fixedDt = dt !== null && dt > 0 ? dt : null;
  }

  // ---- EngineSink ----------------------------------------------------

  setState(patch: EngineStatePatch): void {
    let changed = false;
    const s = this.state_;
    // A reshape (WasmIML.reshape → sink.setState) can change either dim. The
    // stored inputSize drives the setInputs axis loop (and lastRawInputs resizes
    // itself there); a changed outputSize resizes the hot output buffers below.
    // Either bumps the version so useSyncExternalStore consumers re-read the new
    // arity (e.g. inputs.engineInputSize in the dock).
    if (patch.inputSize !== undefined && patch.inputSize !== s.inputSize) { s.inputSize = patch.inputSize; changed = true; }
    if (patch.outputSize !== undefined && patch.outputSize !== s.outputSize) {
      s.outputSize = patch.outputSize;
      // Resize hot buffers to the resolved output size.
      this.mlBuf = new Float32Array(patch.outputSize);
      this.routedBuf = new Float32Array(patch.outputSize);
      this.liveOutputs = new Float32Array(patch.outputSize);
      changed = true;
    }
    if (patch.exampleCount !== undefined && patch.exampleCount !== s.exampleCount) { s.exampleCount = patch.exampleCount; changed = true; }
    if (patch.lastLoss !== undefined && patch.lastLoss !== s.lastLoss) { s.lastLoss = patch.lastLoss; changed = true; }
    if (patch.lossHistory !== undefined) { s.lossHistory = patch.lossHistory; changed = true; }
    if (patch.training !== undefined && patch.training !== s.training) { s.training = patch.training; changed = true; }
    if (patch.ready !== undefined && patch.ready !== s.ready) { s.ready = patch.ready; changed = true; }
    if (changed) this.bump_();
  }

  setOutputs(out: Float32Array): void {
    if (this.liveOutputs.length === out.length) this.liveOutputs.set(out);
    else this.liveOutputs = new Float32Array(out);
    this.bump_();
  }

  setWeights(w: Float32Array): void {
    this.liveWeights = w;
    this.bump_();
  }

  emit(event: string, payload?: unknown): void {
    const set = this.eventListeners.get(event);
    if (set) for (const fn of set) fn(payload);
    // Prefix listeners ("ml." matches "ml.trained").
    for (const [prefix, fns] of this.eventListeners) {
      if (prefix.endsWith('.') && event.startsWith(prefix)) {
        for (const fn of fns) fn(payload);
      }
    }
  }

  // ---- Wiring --------------------------------------------------------

  attach(iml: WasmIML, backendSend: BackendSend | null): void {
    this.iml = iml;
    this.backendSend = backendSend;
    if (this.routedBuf === null || this.routedBuf.length !== iml.architecture.outputSize) {
      this.routedBuf = new Float32Array(iml.architecture.outputSize);
    }
  }

  setBackendSend(backendSend: BackendSend | null): void {
    this.backendSend = backendSend;
  }

  /**
   * Register (or clear with null) a post-output transform applied to the routed
   * buffer in place, after the output pipeline and before backend.send. Used for
   * exploration noise (engine/exploration.ts). Interim seam — in P3 the OU walk
   * runs in the WASM core and this hook can retire.
   */
  setOutputMorph(fn: ((routed: Float32Array) => void) | null): void {
    this.outputMorph = fn;
  }

  // ---- The hot action ------------------------------------------------

  /**
   * Drive a raw [0,1] XY input through processed → ml → routed. Convenience for
   * the 2-D manifold / XY-pad path — delegates to {@link setInputs}.
   */
  setInput(x: number, y: number): Float32Array | null {
    return this.setInputs([x, y]);
  }

  /**
   * Drive an N-dimensional raw input vector (each ∈ [0,1]) through
   * processed → ml → routed eagerly and synchronously, then fire the single
   * backend.send at the tail. Off render. Returns the routed buffer (live,
   * reused — do not retain across calls).
   *
   * The mix-and-match input layer composes one axis PER active input source
   * (XY pad / gamepad sticks / learned MIDI CCs) into this vector. The first
   * two axes run through the 2-D input pipeline (deadzone→zoom→curve→smoothing→
   * momentum) so the pad keeps its feel and the ≤2-D path is unchanged; axes 2+
   * are written raw (sources self-condition). Unused slots up to the net's input
   * arity are held at 0 so a shrinking vector never leaves a stale dimension hot.
   */
  setInputs(arr: ArrayLike<number>): Float32Array | null {
    const iml = this.iml;
    if (!iml) return null;

    const dt = this.dt_();
    const inSize = this.state_.inputSize;

    // 1. primary pair through the pure input pipeline (pad feel / 2-D parity).
    const x = arr.length > 0 ? arr[0] : 0.5;
    const y = arr.length > 1 ? arr[1] : 0.5;
    this.rawInput[0] = x;
    this.rawInput[1] = y;
    this.lastRawX = x;
    this.lastRawY = y;
    const proc = processInput(this.rawInput, this.inputConfig, this.inputState, dt);
    this.inputState = proc.state;
    iml.setInput(0, proc.x);
    iml.setInput(1, proc.y);

    // 2. extra axes raw; unused slots cleared to 0. Remember the full raw vector
    //    so process() can re-tick after a weight change without losing dims.
    if (this.lastRawInputs.length !== inSize) this.lastRawInputs = new Float32Array(inSize);
    this.lastRawInputs[0] = x;
    this.lastRawInputs[1] = y;
    for (let i = 2; i < inSize; i++) {
      const v = i < arr.length ? arr[i] : 0;
      iml.setInput(i, v);
      this.lastRawInputs[i] = v;
    }

    // 3. ml (inference into the reused buffer; no alloc).
    iml.processInto(this.mlBuf);
    this.liveOutputs.set(this.mlBuf.subarray(0, this.liveOutputs.length));

    // 4. routed (output pipeline → reused routedBuf).
    const routedRes = processOutput(this.mlBuf, this.outputConfig, this.outputState, dt * 1000);
    this.outputState = routedRes.state;
    const routed = routedRes.processed;
    if (this.routedBuf && this.routedBuf.length === routed.length) {
      this.routedBuf.set(routed);
    } else {
      this.routedBuf = routed;
    }

    // 4b. optional exploration morph on the routed vector (OU noise). Inert
    //     unless a controller has registered one AND it is turned up.
    if (this.outputMorph && this.routedBuf) this.outputMorph(this.routedBuf);

    // 5. single backend.send at the tail (off React render).
    if (this.backendSend && this.routedBuf) this.backendSend(this.routedBuf);

    this.bump_();
    return this.routedBuf;
  }

  /**
   * Re-run the LAST full raw input vector through the spine (after a weight
   * change — train / randomise / feedback) so outputs + audio reflect the new
   * net without the user touching a control. Preserves all N dimensions.
   */
  reprocess(): Float32Array | null {
    return this.setInputs(this.lastRawInputs);
  }

  /** Monotonic per-tick dt in seconds (≈1/60 on the first tick). A pinned
   *  {@link fixedDt} (debug) overrides the wall-clock delta for determinism. */
  private dt_(): number {
    if (this.fixedDt !== null) return this.fixedDt;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const dt = this.lastTickMs > 0 ? (now - this.lastTickMs) / 1000 : 1 / 60;
    this.lastTickMs = now;
    return dt;
  }

  // ---- Imperative reads (canvas consumers bypass React) --------------

  /** Live post-ML output vector. Reused — read, don't retain. */
  outputs(): Float32Array {
    return this.liveOutputs;
  }

  /** Live routed (post output-pipeline) vector. Reused — read, don't retain. */
  routedOutput(): Float32Array | null {
    return this.routedBuf;
  }

  weights(): Float32Array {
    return this.liveWeights;
  }

  // ---- useSyncExternalStore plumbing ---------------------------------

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  };

  version = (): number => this.state_.version;

  getState(): Readonly<SpineState> {
    return this.state_;
  }

  on(event: string, fn: (payload?: unknown) => void): () => void {
    let set = this.eventListeners.get(event);
    if (!set) { set = new Set(); this.eventListeners.set(event, set); }
    set.add(fn);
    return () => { set!.delete(fn); };
  }

  private bump_(): void {
    this.state_ = { ...this.state_, version: this.state_.version + 1 };
    for (const fn of this.listeners) fn();
  }
}
