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
}

export class EngineApi {
  readonly spine: Spine;
  private iml: WasmIML;
  private host: EngineHost;

  private learningRate: number;
  private noiseCap: number;
  private spread_: number;

  readonly feedback: EngineFeedbackApi;
  readonly audio: EngineAudioApi;

  private constructor(iml: WasmIML, spine: Spine, host: EngineHost, opts: EngineApiOptions) {
    this.iml = iml;
    this.spine = spine;
    this.host = host;
    this.learningRate = opts.learningRate ?? 1.0;
    this.noiseCap = opts.noiseCap ?? 0.3;
    this.spread_ = opts.spread ?? 0.6;

    // Wire the spine's backend.send to push routed params into the worklet.
    const send: BackendSend = (routed) => {
      if (this.host.isStarted) this.host.setParams(new Float32Array(routed));
    };
    this.spine.attach(iml, send);

    this.feedback = {
      thumbsUp: () => this.iml.feedbackUp(),
      thumbsDown: (speed = this.noiseCap, spread = this.spread_, pinMask?: Uint8Array) =>
        this.iml.feedbackDown(speed, spread, this.spine.outputs(), pinMask),
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

  /** Set an arbitrary input vector (first two used as XY for the fixed 2→N MLP). */
  setInputs(arr: ReadonlyArray<number>): void {
    this.spine.setInput(arr[0] ?? 0.5, arr[1] ?? 0.5);
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
   * Re-run the LAST raw input through the spine — used after a weight change
   * (train / randomise / feedback) so outputs + audio reflect the new MLP
   * state without the user having to move the controller.
   */
  process(): void {
    this.spine.setInput(this.spine.lastRawX, this.spine.lastRawY);
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
