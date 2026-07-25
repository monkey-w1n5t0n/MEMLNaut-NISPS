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
 * `subscribe(cb)` + `version()` expose structural/training state changes.
 * `subscribeOutputs(cb)` + `outputVersion()` expose a throttled live-output
 * channel for DOM consumers. Canvas consumers read the live Float32Array
 * imperatively via `getOutputs()` / `routedOutput()`.
 */

import { EngineHost } from './engine-host';
import { ML_TRAIN_DEFAULTS } from '../modes/generated/ml_defaults';
import type { InputConfig, OutputConfig } from './pipeline-types';
import { Spine, type BackendSend } from './spine';
import type { EngineId, FeedbackMode, LayerStats } from './types';
import { WasmIML } from './wasm-iml';
import type { IoMigration } from './io-reshape';

export interface GeometricFeedbackConfig {
  learningRate: number;
  updatesPerSecond: number;
  lifetimeMs: number;
}

export const DEFAULT_GEOMETRIC_FEEDBACK_CONFIG: Readonly<GeometricFeedbackConfig> = {
  learningRate: 0.001,
  updatesPerSecond: 200,
  lifetimeMs: 2500,
};

export interface EngineFeedbackApi {
  /** Positive feedback (thumbs-up). Returns the FeedbackAction int. */
  thumbsUp(): number;
  /** Negative feedback (thumbs-down). Returns the FeedbackAction int. */
  thumbsDown(speed?: number, spread?: number, pinMask?: Uint8Array): number;
  setMode(mode: FeedbackMode): void;
  getMode(): FeedbackMode;
  /** Restrict feedback to a subset of outputs (solo / column-freeze). */
  setFocus(mask: Uint8Array | null): void;
  /** True while the controller is exploring (perturbed). */
  exploring(): boolean;

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
  /** Configure upstream-style replay dose and wall-clock lifetime. */
  setGeometricConfig(config: GeometricFeedbackConfig): void;
  /** Advance replay by elapsed wall-clock time; returns optimise cycles run. */
  advanceGeometric(dtSeconds: number): number;
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
  /** Default max training iterations for train/trainAsync. */
  maxIterations?: number;
  /** Default RL move speed / randomisation spread. Spread defaults to 0. */
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
  private maxIterations: number;
  private noiseCap: number;
  private spread_: number;

  readonly feedback: EngineFeedbackApi;
  readonly explore: EngineExploreApi;
  readonly audio: EngineAudioApi;

  private constructor(iml: WasmIML, spine: Spine, host: EngineHost, opts: EngineApiOptions) {
    this.iml = iml;
    this.spine = spine;
    this.host = host;
    this.learningRate = opts.learningRate ?? ML_TRAIN_DEFAULTS.learningRate;
    this.maxIterations = opts.maxIterations ?? ML_TRAIN_DEFAULTS.maxIterations;
    this.noiseCap = opts.noiseCap ?? 0.3;
    this.spread_ = opts.spread ?? 0;
    // Persist the configured default on the underlying MLP too (S26) — makes
    // the WASM engine's OWN training config match EngineApi's knobs, the same
    // real runtime-configurability firmware/VCV get for free from
    // MLPCore::TrainConfig's default member initialisers.
    this.iml.setTrainConfig(this.learningRate, this.maxIterations, ML_TRAIN_DEFAULTS.minError);
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
      setMode: (mode) => this.iml.feedbackSetMode(mode),
      getMode: () => this.iml.feedbackGetMode(),
      setFocus: (mask) => this.iml.feedbackSetFocus(mask),
      exploring: () => this.iml.feedbackExploring(),
      enterExplore: (spread = this.spread_) => this.iml.feedbackEnterExplore(spread),
      exitExplore: () => this.iml.feedbackExitExplore(),
      reroll: (spread = this.spread_) => this.iml.feedbackReroll(spread),
      nudge: (amount = 0.05) => this.iml.feedbackNudge(amount),
      undo: () => this.iml.feedbackUndo(),
      like: () => this.iml.feedbackLike(),
      commitPlace: () => this.iml.feedbackCommitPlace(),
      cancelPlace: () => this.iml.feedbackCancelPlace(),
      undoDepth: () => this.iml.feedbackUndoDepth(),
      placedOutput: () => this.iml.feedbackPlacedOutput(),
      dislikeGeometric: (heardVec?: Float32Array, lr = 0) =>
        this.iml.feedbackDislikeGeometric(heardVec, lr),
      setGeometricConfig: (config) =>
        this.iml.feedbackSetGeometricConfig(
          config.learningRate,
          config.updatesPerSecond,
          config.lifetimeMs,
        ),
      advanceGeometric: (dtSeconds) => this.iml.feedbackAdvanceGeometric(dtSeconds),
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
      initialSpread: opts.spread ?? 0,
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
   * Current FULL-width control input vector (one entry per active input axis,
   * up to the net's input arity — NOT fixed at 2). Live reused buffer — copy,
   * don't retain. Used by the VCV backend (via BackendManager) to drive the
   * module's inputs over the bridge without truncating gamepad/MIDI axes
   * beyond the first two (simplification audit S10).
   */
  inputVector(): ArrayLike<number> {
    return this.spine.lastRawInputs;
  }

  /**
   * Re-run the LAST raw input through the spine — used after a weight change
   * (train / randomise / feedback) so outputs + audio reflect the new MLP
   * state without the user having to move the controller.
   */
  process(): void {
    this.spine.reprocess();
  }

  // ---- Pipeline config + curves (one-core-engine P4) -----------------

  /** Replace the input-pipeline config (forwarded into the WASM input chain). */
  setInputConfig(cfg: InputConfig): void {
    this.spine.setInputConfig(cfg);
  }

  /** Replace the output-pipeline config (forwarded into the WASM output chain). */
  setOutputConfig(cfg: OutputConfig): void {
    this.spine.setOutputConfig(cfg);
  }

  /** Sample one catalog curve via the WASM core. id 0..6 = nisps::Curve (param
   *  ignored); id 7 = centred power (param = exponent). */
  curveApply(id: number, x: number, param = 0): number {
    return this.iml.curveApply(id, x, param);
  }

  /** Batch-sample a curve over `xs` into `out` (one WASM call, chunked). Use for
   *  previews / bulk shaping instead of per-value curveApply. */
  curveApplyBatch(id: number, xs: ArrayLike<number>, out: Float32Array, param = 0): void {
    this.iml.curveApplyBatch(id, xs, out, param);
  }

  // ---- Training ------------------------------------------------------

  addExample(features: ReadonlyArray<number>, labels: ReadonlyArray<number>): boolean {
    return this.iml.addExample(features, labels);
  }

  train(): number {
    return this.iml.train(this.learningRate, this.maxIterations);
  }

  trainAsync(): Promise<number> {
    return this.iml.trainAsync(this.learningRate, this.maxIterations);
  }

  randomise(spread = this.spread_): void {
    this.iml.randomiseWeights(spread);
    this.process();
  }

  /**
   * Reconfigure runtime I/O. Without a migration plan this is the legacy
   * reconstruct-and-clear operation. With one, stable dimension maps preserve
   * semantic weights and optionally adapt examples; same-shape permutations do
   * not reconstruct the MLP. Feedback/exploration scratch state always resets.
   */
  reshape(
    dims: { inputSize?: number; outputSize?: number; hidden?: [number, number, number] },
    spread = this.spread_,
    migration?: IoMigration,
  ): boolean {
    const ok = this.iml.reshape(dims, spread, migration);
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

  /**
   * Per-iteration loss of the most recent training run — the real curve the
   * core recorded (`nisps::ml::MLPCore::loss_history`, read out through
   * `nisps_ml_loss_history`), not a synthesised one.
   *
   * Deliberately sourced from spine state rather than the MLP handle: an async
   * train runs on the WORKER's mirror net, so the main handle's own history is
   * empty for those runs. Both paths publish here, so this is the one honest
   * answer to "how did the last fit go?".
   */
  lossHistory(): ReadonlyArray<number> {
    return this.spine.getState().lossHistory;
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

  /** Subscribe to throttled live-output changes for non-canvas UI consumers. */
  subscribeOutputs(cb: () => void): () => void {
    return this.spine.subscribeOutputs(cb);
  }

  /** Latest live-output revision; increments on every inference. */
  outputVersion(): number {
    return this.spine.outputVersion();
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

  get weightCount(): number {
    return this.iml.weightCount;
  }

  get exampleCount(): number {
    return this.iml.exampleCount;
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
