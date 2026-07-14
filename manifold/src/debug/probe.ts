/**
 * Debug probe: window.__nisps
 *
 * Synchronous-or-immediate Promise API for Playwright tests and dev console
 * use. Ported from `playground/src/debug/probe.ts` to read the framework-neutral
 * `EngineApi` instead of SolidJS stores. Gated behind `?debug=1` (see
 * `installDebugProbe`).
 *
 * Test contract (unchanged): every method returns a value, returns null/empty,
 * or returns an immediately-resolved Promise. None throw — bad input is
 * silently ignored.
 *
 * Scope note: the playground probe also covered features that live in Solid
 * feature-stores (snapshots, A/B, region pins, heatmap, session presets,
 * compound axes). Those stores don't exist in Manifold's engine layer yet
 * (they belong to later BUILD-PLAN steps). Their probe methods are present but
 * inert (no-op / empty) so the probe surface stays stable and never throws;
 * they'll be wired when the corresponding Manifold features land.
 */

import type { EngineApi } from '../engine/engine-api';
import type { FeedbackMode, LayerStats, MLArchitecture } from '../engine/types';

export interface DebugProbe {
  // ---- Core engine surface (live) ----
  getOutputs(): Float32Array;
  routedOutputs(): Float32Array;
  getLoss(): number | null;
  getLossHistory(): ReadonlyArray<number>;
  getWeights(): Float32Array;
  getExampleCount(): number;
  /** The net's current shape (runtime-shaped MLP; P2). */
  describe(): MLArchitecture;
  /**
   * Reshape the net (warm-started; dataset + feedback reset). Returns the new
   * shape on success, or null if the reshape was rejected / no-op. Omitted dims
   * keep their current value.
   */
  reshape(inputSize: number, outputSize?: number, hidden?: [number, number, number]): MLArchitecture | null;
  setInputs(x: number, y: number): void;
  thumbsUp(): number;
  thumbsDown(): number;
  setFeedbackMode(mode: FeedbackMode): void;
  getFeedbackMode(): FeedbackMode | null;
  setFocus(mask: ReadonlyArray<number> | null): void;
  exploring(): boolean;
  // ---- Geometric dislike (one-core-engine P3; rl-feedback-design §2.1) ----
  /**
   * Drive a geometric dislike at the MLP's CURRENT input with `heardVec` as the
   * heard (post-pipeline) output. `lr <= 0` uses the core default (small). Runs a
   * process() after so outputs reflect the trained net. Returns the FeedbackAction
   * int (14=GeometricPush, 15=GeometricColdStart).
   */
  dislikeGeometric(heardVec: ReadonlyArray<number>, lr?: number): number;
  /** Feed a positive into the k-NN centroid (omit vec → live MLP output). */
  storePositive(vec?: ReadonlyArray<number>): void;
  /** Replay-memory sizes (Mode 1). */
  feedbackCounts(): { positive: number; negative: number };
  /** Avoid sub-mode: 0 = Geometric (default), 1 = Diffuse (legacy). */
  setAvoidStyle(style: number): void;
  train(): number;
  trainAsync(): Promise<number>;
  randomise(): void;
  clearExamples(): void;
  saveState(): void;
  evalLoss(): number | null;
  inferBatch(points: ReadonlyArray<readonly [number, number]>): Float32Array;
  getLayerStats(): Float32Array;
  addExample(features: ReadonlyArray<number>, labels: ReadonlyArray<number>): boolean;

  // ---- Audio ----
  audioStart(): Promise<void>;
  audioStop(): Promise<void>;
  setMuted(muted: boolean): void;
  setBackend(id: string): void;

  // ---- Bus ----
  on(event: string, handler: (payload?: unknown) => void): () => void;

  readonly __ready: boolean;
}

declare global {
  interface Window {
    __nisps?: DebugProbe;
  }
}

const EMPTY_F32 = new Float32Array(0);

function makeProbe(engine: EngineApi): DebugProbe {
  return {
    get __ready(): boolean {
      return engine.getState().ready;
    },

    getOutputs(): Float32Array {
      return engine.getOutputs();
    },

    routedOutputs(): Float32Array {
      return engine.routedOutput() ?? EMPTY_F32;
    },

    getLoss(): number | null {
      return engine.getState().lastLoss;
    },

    getLossHistory(): ReadonlyArray<number> {
      return engine.getState().lossHistory;
    },

    getWeights(): Float32Array {
      return engine.getWeights();
    },

    getExampleCount(): number {
      return engine.getState().exampleCount;
    },

    describe(): MLArchitecture {
      return engine.architecture;
    },

    reshape(inputSize, outputSize, hidden): MLArchitecture | null {
      const dims: { inputSize?: number; outputSize?: number; hidden?: [number, number, number] } = {
        inputSize,
      };
      if (outputSize !== undefined) dims.outputSize = outputSize;
      if (hidden !== undefined) dims.hidden = hidden;
      const ok = engine.reshape(dims);
      return ok ? engine.architecture : null;
    },

    setInputs(x: number, y: number): void {
      engine.setInput(x, y);
    },

    thumbsUp(): number {
      const a = engine.feedback.thumbsUp();
      engine.process();
      return a;
    },

    thumbsDown(): number {
      const a = engine.feedback.thumbsDown();
      engine.process();
      return a;
    },

    setFeedbackMode(mode: FeedbackMode): void {
      engine.feedback.setMode(mode);
    },

    getFeedbackMode(): FeedbackMode | null {
      try {
        return engine.feedback.getMode();
      } catch {
        return null;
      }
    },

    setFocus(mask: ReadonlyArray<number> | null): void {
      engine.feedback.setFocus(mask ? Uint8Array.from(mask) : null);
    },

    exploring(): boolean {
      return engine.feedback.exploring();
    },

    dislikeGeometric(heardVec: ReadonlyArray<number>, lr = 0): number {
      const a = engine.feedback.dislikeGeometric(Float32Array.from(heardVec), lr);
      engine.process();
      return a;
    },

    storePositive(vec?: ReadonlyArray<number>): void {
      engine.feedback.storePositive(vec ? Float32Array.from(vec) : undefined);
    },

    feedbackCounts(): { positive: number; negative: number } {
      return {
        positive: engine.feedback.positiveCount(),
        negative: engine.feedback.negativeCount(),
      };
    },

    setAvoidStyle(style: number): void {
      engine.feedback.setAvoidStyle(style);
    },

    train(): number {
      const loss = engine.train();
      engine.process();
      return loss;
    },

    async trainAsync(): Promise<number> {
      const loss = await engine.trainAsync();
      engine.process();
      return loss;
    },

    randomise(): void {
      engine.randomise();
    },

    clearExamples(): void {
      engine.clearExamples();
    },

    saveState(): void {
      engine.saveState();
    },

    evalLoss(): number | null {
      try {
        return engine.evalLoss();
      } catch {
        return null;
      }
    },

    inferBatch(points): Float32Array {
      return engine.inferBatch(points);
    },

    getLayerStats(): Float32Array {
      return engine.getLayerStatsFlat();
    },

    addExample(features, labels): boolean {
      return engine.addExample(features, labels);
    },

    audioStart(): Promise<void> {
      return engine.audio.start();
    },

    audioStop(): Promise<void> {
      return engine.audio.stop();
    },

    setMuted(muted: boolean): void {
      engine.audio.setMuted(muted);
    },

    setBackend(id: string): void {
      // Lossy cast — the probe is intentionally weakly typed.
      engine.audio.setBackend(id as Parameters<EngineApi['audio']['setBackend']>[0]);
    },

    on(event: string, handler): () => void {
      return engine.on(event, handler);
    },
  };
}

/** Type-only re-export so consumers can reference the stat shape. */
export type { LayerStats };

/**
 * Install the probe on window iff `?debug=1` is present. Idempotent.
 */
export function installDebugProbe(engine: EngineApi): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') !== '1') return;
  window.__nisps = makeProbe(engine);
}
