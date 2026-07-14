/**
 * EngineApi — the headless façade every consumer uses.
 *
 * This is the boundary the design docs (engine-architecture.md, findings §4)
 * call for: a framework-neutral object that owns the WasmIML (ML), the
 * EngineHost (audio), and the reactive Spine, and exposes ONE coherent API.
 * React talks to it through Context; the debug probe talks to it directly; a
 * headless test can `await createEngine()` and drive it with no DOM framework.
 *
 * The engine imports NO React. The only React in `engine/` is the
 * EngineProvider/useEngine binding layer (separate files).
 *
 * `subscribe(cb)` + `version()` are the `useSyncExternalStore` contract: React
 * re-reads on a version bump but consumers read the live Float32Array
 * imperatively via `getOutputs()` / `routedOutput()`.
 */

import { EngineHost } from './engine-host';
import { Spine, type BackendSend } from './spine';
import type { EngineId, FeedbackMode, LayerStats } from './types';
import { WasmIML } from './wasm-iml';

export interface EngineFeedbackApi {
  /** Positive feedback (thumbs-up). Returns the FeedbackAction int. */
  thumbsUp(): number;
  /** Negative feedback (thumbs-down). Returns the FeedbackAction int. */
  thumbsDown(speed?: number, spread?: number, pinMask?: Uint8Array): number;
  /** Drag (continuous perturbation) tick. */
  drag(): number;
  setMode(mode: FeedbackMode): void;
  getMode(): FeedbackMode;
  /** Restrict feedback to a subset of outputs (solo / column-freeze). */
  setFocus(mask: Uint8Array | null): void;
  /** True while the controller is exploring (perturbed). */
  exploring(): boolean;
  /** True while the controller has paused learning. */
  learningPaused(): boolean;

  // ---- ExploreAndPlace lifecycle (shared C++ core; mode 'explore_and_place') --
  /** Idle→Exploring: snapshot the real net, randomise a scratchpad. */
  enterExplore(spread?: number): void;
  /** Exploring→Idle: restore the real net, discard the scratchpad. */
  exitExplore(): void;
  /** Exploring scratchpad op: re-randomise (undoable). */
  reroll(spread?: number): void;
  /** Exploring scratchpad op: small bounded perturbation (undoable). */
  nudge(amount?: number): void;
  /** Exploring scratchpad op: undo the last reroll/nudge. */
  undo(): void;
  /** Exploring→Placing: freeze the scratchpad output at its current input. */
  like(): void;
  /** Placing→Idle: restore the real net (caller then stores +1 + trains). */
  commitPlace(): void;
  /** Placing→Exploring: back out without storing. */
  cancelPlace(): void;
  /** True while Placing (the frozen output is held). */
  placing(): boolean;
  /** ExploreState int: 0=Idle 1=Exploring 2=Placing. */
  exploreState(): number;
  /** Scratchpad undo-ring depth available to pop. */
  undoDepth(): number;
  /** The frozen placed / just-committed output (null if none). */
  placedOutput(): Float32Array | null;

  // ---- Geometric dislike (one-core-engine P3; rl-feedback-design §2.1) ----
  /**
   * Push the current mapping away from the liked centroid. `heardVec` is the
   * post-pipeline (HEARD) output vector — pass what the user hears, NOT the raw
   * MLP output, or the cold-start MSE derivative is zero. Returns the
   * FeedbackAction int (14=GeometricPush, 15=GeometricColdStart).
   */
  dislikeGeometric(heardVec?: Float32Array, lr?: number): number;
  /** Feed a positive (like) into the k-NN centroid (null → live MLP output). */
  storePositive(vec?: Float32Array): void;
  positiveCount(): number;
  negativeCount(): number;
  /** Avoid sub-mode: 0 = Geometric (default), 1 = Diffuse (legacy, A/B). */
  setAvoidStyle(style: number): void;
}

/**
 * Exploration gestures backed by the shared C++ core (nisps/ml/{jolt,ou_noise}.
 * hpp — the same the firmware ModeBase runs). The ExplorationController owns the
 * control-rate drivers; these are the raw per-tick primitives.
 */
export interface EngineExploreApi {
  /** Begin a held jolt (continuous weight morph). */
  joltPress(): void;
  /** One ~200 Hz morph tick while held (no-op when inactive; mutates weights). */
  joltStep(): void;
  /** Release: freeze the weights where they landed (permanent). */
  joltRelease(): void;
  joltActive(): boolean;
  /** Post-release LR-ramp multiplier (0 held → 1 over ~5 s of ticks). */
  joltLrScale(): number;
  joltTickLrRamp(): void;
  /** Exploration amount in [0,1]; 0 disables (inert — parity-safe). */
  setExploreIntensity(level: number): void;
  exploreIntensity(): number;
  /** Advance the OU walk and add it (clamped [0,1]) to `inout` in place. */
  exploreApply(inout: Float32Array): void;
}

export interface EngineAudioApi {
  start(engineId?: EngineId): Promise<void>;
  stop(): Promise<void>;
  setMuted(muted: boolean): void;
  setBackend(id: EngineId): void;
  getBackend(): EngineId;
  readonly isStarted: boolean;
}

export interface EngineApiOptions {
  seed?: number;
  storageKey?: string;
  maxExamples?: number;
  /** Default learning rate for thumbsUp/train. */
  learningRate?: number;
  /** Default RL move speed / spread for thumbsDown. */
  noiseCap?: number;
  spread?: number;
  /**
   * Pin a deterministic per-tick dt (seconds) on the spine — set under ?debug=1
   * so the timing-driven pipeline smoothing is reproducible in tests. Omit in
   * production (real-time wall-clock dt).
   */
  debugClockDt?: number;
}

export class EngineApi {
  readonly spine: Spine;
  private iml: WasmIML;
  private host: EngineHost;

  private learningRate: number;
  private noiseCap: number;
  private spread_: number;

  readonly feedback: EngineFeedbackApi;
  readonly explore: EngineExploreApi;
  readonly audio: EngineAudioApi;

  private constructor(iml: WasmIML, spine: Spine, host: EngineHost, opts: EngineApiOptions) {
    this.iml = iml;
    this.spine = spine;
    this.host = host;
    this.learningRate = opts.learningRate ?? 1.0;
    this.noiseCap = opts.noiseCap ?? 0.3;
    this.spread_ = opts.spread ?? 0.6;
    if (opts.debugClockDt !== undefined) this.spine.setFixedDt(opts.debugClockDt);

    // Wire the spine's backend.send to push routed params into the worklet.
    const send: BackendSend = (routed) => {
      if (this.host.isStarted) this.host.setParams(new Float32Array(routed));
    };
    this.spine.attach(iml, send);

    this.feedback = {
      thumbsUp: () => this.iml.feedbackUp(),
      thumbsDown: (speed = this.noiseCap, spread = this.spread_, pinMask?: Uint8Array) =>
        // Pass the HEARD (post-pipeline, routed) vector as the disliked action —
        // NOT the raw MLP output. In Avoid+Geometric mode the core trains toward
        // it; a raw vector equal to the net's own output gives a zero MSE
        // derivative (an inert cold-start). Falls back to raw if not yet routed.
        this.iml.feedbackDown(
          speed,
          spread,
          this.spine.routedOutput() ?? this.spine.outputs(),
          pinMask,
        ),
      drag: () => this.iml.feedbackDrag(),
      setMode: (mode) => this.iml.feedbackSetMode(mode),
      getMode: () => this.iml.feedbackGetMode(),
      setFocus: (mask) => this.iml.feedbackSetFocus(mask),
      exploring: () => this.iml.feedbackExploring(),
      learningPaused: () => this.iml.feedbackLearningPaused(),
      enterExplore: (spread = this.spread_) => this.iml.feedbackEnterExplore(spread),
      exitExplore: () => this.iml.feedbackExitExplore(),
      reroll: (spread = this.spread_) => this.iml.feedbackReroll(spread),
      nudge: (amount = 0.05) => this.iml.feedbackNudge(amount),
      undo: () => this.iml.feedbackUndo(),
      like: () => this.iml.feedbackLike(),
      commitPlace: () => this.iml.feedbackCommitPlace(),
      cancelPlace: () => this.iml.feedbackCancelPlace(),
      placing: () => this.iml.feedbackPlacing(),
      exploreState: () => this.iml.feedbackState(),
      undoDepth: () => this.iml.feedbackUndoDepth(),
      placedOutput: () => this.iml.feedbackPlacedOutput(),
      dislikeGeometric: (heardVec?: Float32Array, lr = 0) =>
        this.iml.feedbackDislikeGeometric(heardVec, lr),
      storePositive: (vec?: Float32Array) => this.iml.feedbackStorePositive(vec),
      positiveCount: () => this.iml.feedbackPositiveCount(),
      negativeCount: () => this.iml.feedbackNegativeCount(),
      setAvoidStyle: (style) => this.iml.feedbackSetAvoidStyle(style),
    };

    this.explore = {
      joltPress: () => this.iml.joltPress(),
      joltStep: () => this.iml.joltStep(),
      joltRelease: () => this.iml.joltRelease(),
      joltActive: () => this.iml.joltActive(),
      joltLrScale: () => this.iml.joltLrScale(),
      joltTickLrRamp: () => this.iml.joltTickLrRamp(),
      setExploreIntensity: (level) => this.iml.setExploreIntensity(level),
      exploreIntensity: () => this.iml.exploreIntensity(),
      exploreApply: (inout) => this.iml.exploreApply(inout),
    };

    this.audio = {
      start: (engineId?: EngineId) => this.host.start(engineId),
      stop: () => this.host.stop(),
      setMuted: (muted) => this.host.setMuted(muted),
      setBackend: (id) => this.host.setEngine(id),
      getBackend: () => this.host.engine,
      get isStarted() {
        return host.isStarted;
      },
    };
  }

  static async create(opts: EngineApiOptions = {}): Promise<EngineApi> {
    const spine = new Spine();
    const iml = await WasmIML.create({
      seed: opts.seed,
      storageKey: opts.storageKey,
      maxExamples: opts.maxExamples,
      sink: spine,
    });
    const host = new EngineHost();
    return new EngineApi(iml, spine, host, opts);
  }

  // ---- Input → spine -------------------------------------------------

  /** Drive a raw XY input ∈ [0,1] through the full spine (off React render). */
  setInput(x: number, y: number): void {
    this.spine.setInput(x, y);
  }

  /**
   * Set the full N-dimensional input vector (one axis per active input source).
   * The first two axes run through the 2-D input pipeline; axes 2+ are raw.
   * Extra axes beyond the net's input arity are ignored; unused slots → 0.
   */
  setInputs(arr: ReadonlyArray<number>): void {
    this.spine.setInputs(arr);
  }

  /** Live post-ML output vector (reused buffer — read, don't retain). */
  getOutputs(): Float32Array {
    return this.spine.outputs();
  }

  /** Live routed (post output-pipeline) vector. */
  routedOutput(): Float32Array | null {
    return this.spine.routedOutput();
  }

  /**
   * Current control input vector (2-D for the fixed 2→N MLP). Used by the VCV
   * backend (via BackendManager) to drive the module's inputs over the bridge.
   */
  inputVector(): ReadonlyArray<number> {
    return [this.spine.lastRawX, this.spine.lastRawY];
  }

  /**
   * Re-run the LAST raw input through the spine — used after a weight change
   * (train / randomise / feedback) so outputs + audio reflect the new MLP
   * state without the user having to move the controller.
   */
  process(): void {
    this.spine.reprocess();
  }

  // ---- Training ------------------------------------------------------

  addExample(features: ReadonlyArray<number>, labels: ReadonlyArray<number>): boolean {
    return this.iml.addExample(features, labels);
  }

  train(): number {
    return this.iml.train(this.learningRate);
  }

  trainAsync(): Promise<number> {
    return this.iml.trainAsync(this.learningRate);
  }

  randomise(spread = this.spread_): void {
    this.iml.randomiseWeights(spread);
    this.process();
  }

  /**
   * Reshape the net to new dims (runtime-shaped MLP; one-core-engine P2). The
   * new net is warm-started from the current net's overlapping weights; the
   * dataset + feedback/exploration state RESET (front-end shows a confirm modal
   * first). Returns true on success. On success the spine re-reads its arity and
   * re-ticks the last input so outputs/audio reflect the new net.
   */
  reshape(
    dims: { inputSize?: number; outputSize?: number; hidden?: [number, number, number] },
    spread = this.spread_,
  ): boolean {
    const ok = this.iml.reshape(dims, spread);
    if (ok) this.process();
    return ok;
  }

  clearExamples(): void {
    this.iml.clearExamples();
  }

  evalLoss(): number {
    return this.iml.evalLoss();
  }

  inferBatch(points: ReadonlyArray<readonly [number, number]>): Float32Array {
    return this.iml.inferBatch(points);
  }

  // ---- Weights / stats ----------------------------------------------

  getWeights(): Float32Array {
    return this.iml.getWeights();
  }

  setWeights(w: Float32Array): void {
    this.iml.setWeights(w);
  }

  getLayerStats(): LayerStats[] {
    return this.iml.getLayerStats();
  }

  getLayerStatsFlat(): Float32Array {
    return this.iml.getLayerStatsFlat();
  }

  // ---- Reactive contract --------------------------------------------

  /** Subscribe to state changes (useSyncExternalStore). Returns an unsubscribe. */
  subscribe(cb: () => void): () => void {
    return this.spine.subscribe(cb);
  }

  /** Monotonically-increasing counter, bumped on every state change. */
  version(): number {
    return this.spine.version();
  }

  /** Subscribe to a named engine event (`ml.*`, `feedback.*`, …). */
  on(event: string, fn: (payload?: unknown) => void): () => void {
    return this.spine.on(event, fn);
  }

  getState() {
    return this.spine.getState();
  }

  saveState(): void {
    this.iml.saveNow();
  }

  get architecture() {
    return this.iml.architecture;
  }

  // ---- Direct handle access (advanced consumers; spine pipelines, etc.) ----
  get ml(): WasmIML {
    return this.iml;
  }

  dispose(): void {
    this.host.dispose();
    this.iml.dispose();
  }
}

export async function createEngine(opts: EngineApiOptions = {}): Promise<EngineApi> {
  return EngineApi.create(opts);
}
