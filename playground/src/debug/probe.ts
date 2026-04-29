/**
 * Debug probe: window.__nisps
 *
 * Synchronous-or-immediate Promise API for Playwright tests and dev console
 * use. Bypasses SolidJS reactivity by reading/writing the underlying stores
 * and WASM directly — values propagate to the UI on the next reactive tick,
 * but the probe always returns the freshest state.
 *
 * Stream 10 expanded the surface to cover stream 8/9 features:
 *   - Snapshot stack (push, pop, list)
 *   - A/B compare (capture, toggle, accept, revert)
 *   - Region pinning (add, remove, clear)
 *   - Auto-explore (toggle, interval, intensity)
 *   - Heatmap (refresh, color mode, getCells)
 *   - Weight health (histogram, status, layer stats)
 *   - Session presets (save, load, list, share URL)
 *   - Override application (read, write, clear)
 *
 * Test contract: every method either returns a value, returns null/empty,
 * or returns an immediately-resolved Promise. None of them throw — bad
 * input is silently ignored.
 */

import { batch, untrack } from 'solid-js';
import { mlStore } from '../stores/ml-store';
import { modeStore } from '../stores/mode-store';
import { sessionStore } from '../stores/session-store';
import { explorationStore } from '../stores/exploration-store';
import { controlStore } from '../stores/control-store';
import { inputStore } from '../stores/input-store';
import { outputStore } from '../stores/output-store';
import { coreBus } from '../stores/bus';
import {
  autoSnapshot,
  undoLastSnapshot,
  captureA as snapCaptureA,
  toggleAB as snapToggleAB,
  acceptB as snapAcceptB,
  revertToA as snapRevertToA,
} from '../features/snapshots';
import { HeatmapSampler } from '../features/heatmap-sampler';
import {
  weightHistogram,
  weightStatus as healthStatus,
  layerNorms,
  gradientStatuses,
  layerWeightCounts,
} from '../features/weight-health';
import {
  captureSessionPreset,
  restoreSessionPreset,
  saveNamedPreset,
  loadNamedPreset,
  buildShareUrl,
  applyUrlParams,
  type SessionPresetPayload,
} from '../features/session-preset';
import type { HeatmapColorMode } from '../features/heatmap-sampler';

export interface DebugProbe {
  /** Current 126-element output vector (Float32Array). */
  getOutputs(): Float32Array;
  /** Current per-param post-override values (length = active mode params). */
  getParamOutputs(): Float32Array;
  /** Last training loss, or null if no training has occurred. */
  getLoss(): number | null;
  /** Loss history of last training run. */
  getLossHistory(): ReadonlyArray<number>;
  /** Flat weight array. */
  getWeights(): Float32Array;
  /** Number of training examples currently in the dataset. */
  getExampleCount(): number;
  /** Set joystick X/Y in [0,1] and run inference. */
  setInputs(x: number, y: number): void;
  /** Trigger thumbs-up RL feedback. */
  thumbsUp(): void;
  /** Trigger thumbs-down RL feedback. */
  thumbsDown(): void;
  /** Synchronous training; returns final loss. */
  train(): number;
  /** Async training; returns Promise<loss>. */
  trainAsync(): Promise<number>;
  /** Randomize weights with default spread. */
  randomise(): void;
  /** Clear all training examples. */
  clearExamples(): void;
  /** Force a save to localStorage now (no debounce). */
  saveState(): void;
  /** Non-destructive loss query against current dataset. */
  evalLoss(): number | null;
  /** Batch inference: input is Nx2 array of [x,y] pairs. */
  inferBatch(points: ReadonlyArray<readonly [number, number]>): Float32Array;
  /** Per-layer weight statistics: layerCount * 4 floats (mean|w|, max|w|, dead%, sat%). */
  getLayerStats(): Float32Array;

  // Snapshot / undo / A/B
  pushSnapshot(tag: string): void;
  popSnapshot(): boolean;
  listSnapshots(): ReadonlyArray<{ id: string; tag: string; timestamp: number; noiseLevel: number }>;
  clearSnapshots(): void;
  captureA(): void;
  toggleAB(): 'A' | 'B';
  acceptB(): void;
  revertToA(): void;

  // Pins
  addRegionPin(pin: { x: number; y: number; width: number; height: number }): string;
  removeRegionPin(id: string): void;
  toggleParamPin(modeId: string, paramName: string, outputIndex: number): boolean;
  isParamPinned(modeId: string, paramName: string): boolean;

  // Auto-explore
  setAutoExplore(enabled: boolean): void;
  setAutoExploreInterval(ms: number): void;
  setAutoExploreIntensity(v: number): void;

  // Pressure
  setPressure(force: number, holdMs?: number): void;

  // Heatmap
  refreshHeatmap(force?: boolean): boolean;
  getHeatmapCells(): Float32Array;
  setHeatmapColorMode(mode: HeatmapColorMode): void;

  // Weight health
  getWeightHistogram(): number[];
  getWeightStatus(): 'dead' | 'saturating' | 'healthy';
  getGradientFlow(beforeWeights: Float32Array, afterWeights: Float32Array): { norms: number[]; status: ReturnType<typeof gradientStatuses> };

  // Overrides
  setOverride(modeId: string, paramName: string, override: Partial<{ min: number; max: number; curve: string; muted: boolean; pinned: boolean; frozen: boolean; fixedValue: number }>): void;
  clearOverride(modeId: string, paramName: string): void;
  clearAllOverrides(modeId: string): void;
  getOverride(modeId: string, paramName: string): unknown;

  // Compound axes
  setAxis(axis: 'boldness' | 'memory' | 'precision', value: number): void;
  applyControlPreset(id: string): boolean;

  // Pipelines
  setZoom(zoom: number): void;
  setSpread(spread: number): void;
  setOutputFreeze(frozen: boolean): void;

  // Session presets
  captureSessionPreset(withWeights?: boolean): SessionPresetPayload;
  restoreSessionPreset(payload: SessionPresetPayload): boolean;
  saveSessionPreset(name: string, withWeights?: boolean): void;
  loadSessionPreset(id: string): boolean;
  buildShareUrl(): string;
  applyUrlParams(search?: string): boolean;

  // Bus
  emit(topic: string, data: unknown): void;
  on(topic: string, handler: (data: unknown) => void): () => void;

  /** True once the WASM is fully initialised. */
  readonly __ready: boolean;
  /** Force initialisation. Returns a promise that resolves when the WASM is ready. */
  __init(): Promise<void>;
}

declare global {
  interface Window {
    __nisps?: DebugProbe;
  }
}

const EMPTY_F32 = new Float32Array(0);

let lazyInitPromise: Promise<void> | null = null;
function lazyInit(): Promise<void> {
  if (mlStore.iml) return Promise.resolve();
  if (!lazyInitPromise) {
    lazyInitPromise = mlStore.initialize().then(() => undefined);
  }
  return lazyInitPromise;
}

// Probe-local heatmap sampler (independent of any active mode runtime).
const probeHeatmap = new HeatmapSampler({ resolution: 16 });

const probe: DebugProbe = {
  get __ready(): boolean {
    return !!mlStore.iml && mlStore.state.ready;
  },

  __init(): Promise<void> {
    return lazyInit();
  },

  getOutputs(): Float32Array {
    return mlStore.outputs();
  },

  getParamOutputs(): Float32Array {
    // The probe doesn't have a runtime reference; recompute from raw outputs.
    const raw = mlStore.outputs();
    if (raw.length === 0) return EMPTY_F32;
    // Just return the raw outputs — actual override application requires
    // schema knowledge that the probe doesn't track. Tests can read
    // overrides via `getOverride` instead.
    return raw;
  },

  getLoss(): number | null {
    return mlStore.state.lastLoss;
  },

  getLossHistory(): ReadonlyArray<number> {
    return mlStore.state.lossHistory;
  },

  getWeights(): Float32Array {
    return mlStore.getWeights();
  },

  getExampleCount(): number {
    return mlStore.state.exampleCount;
  },

  setInputs(x: number, y: number): void {
    if (!mlStore.iml) {
      void lazyInit();
      return;
    }
    untrack(() => mlStore.iml!.inferXY(x, y));
  },

  thumbsUp(): void {
    if (!mlStore.iml) return;
    untrack(() => {
      autoSnapshot('before thumbs-up (probe)');
      mlStore.iml!.train(explorationStore.state.learningRate);
      explorationStore.decayNoise(0.5);
    });
  },

  thumbsDown(): void {
    if (!mlStore.iml) return;
    untrack(() => {
      autoSnapshot('before thumbs-down (probe)');
      const cap = explorationStore.state.noiseCap;
      const spread = explorationStore.state.spread;
      mlStore.iml!.moveWeights(cap, spread);
      explorationStore.growNoise(0.5);
    });
  },

  train(): number {
    if (!mlStore.iml) {
      void lazyInit();
      return 0;
    }
    return untrack(() => {
      autoSnapshot('before train (probe)');
      return mlStore.iml!.train(explorationStore.state.learningRate);
    });
  },

  async trainAsync(): Promise<number> {
    await lazyInit();
    if (!mlStore.iml) return 0;
    autoSnapshot('before trainAsync (probe)');
    return mlStore.iml.trainAsync(explorationStore.state.learningRate);
  },

  randomise(): void {
    if (!mlStore.iml) return;
    untrack(() => {
      autoSnapshot('before randomize (probe)');
      mlStore.iml!.randomiseWeights(explorationStore.state.spread);
    });
  },

  clearExamples(): void {
    mlStore.clearExamples();
  },

  saveState(): void {
    mlStore.saveNow();
  },

  evalLoss(): number | null {
    if (!mlStore.iml) return null;
    return mlStore.iml.evalLoss();
  },

  inferBatch(points: ReadonlyArray<readonly [number, number]>): Float32Array {
    if (!mlStore.iml) return new Float32Array(points.length * mlStore.state.outputSize);
    return mlStore.iml.inferBatch(points);
  },

  getLayerStats(): Float32Array {
    if (!mlStore.iml) return EMPTY_F32;
    return mlStore.iml.getLayerStatsFlat();
  },

  // ----- Snapshot / undo / A/B ---------------------------------------------

  pushSnapshot(tag: string): void {
    autoSnapshot(tag);
  },

  popSnapshot(): boolean {
    return undoLastSnapshot();
  },

  listSnapshots() {
    return sessionStore.listSnapshots().map((s) => ({
      id: s.id,
      tag: s.tag,
      timestamp: s.timestamp,
      noiseLevel: s.noiseLevel,
    }));
  },

  clearSnapshots(): void {
    sessionStore.clearSnapshots();
  },

  captureA(): void {
    snapCaptureA();
  },

  toggleAB(): 'A' | 'B' {
    return snapToggleAB();
  },

  acceptB(): void {
    snapAcceptB();
  },

  revertToA(): void {
    snapRevertToA();
  },

  // ----- Pins ---------------------------------------------------------------

  addRegionPin(pin) {
    const created = sessionStore.addRegionPin(pin);
    return created.id;
  },

  removeRegionPin(id: string): void {
    sessionStore.removeRegionPin(id);
  },

  toggleParamPin(modeId: string, paramName: string, outputIndex: number): boolean {
    return sessionStore.toggleParamPin(`${modeId}:${paramName}`, outputIndex);
  },

  isParamPinned(modeId: string, paramName: string): boolean {
    return sessionStore.isParamPinned(`${modeId}:${paramName}`);
  },

  // ----- Auto-explore -------------------------------------------------------

  setAutoExplore(enabled: boolean): void {
    explorationStore.setAutoExplore(enabled);
  },

  setAutoExploreInterval(ms: number): void {
    explorationStore.setAutoExploreInterval(ms);
  },

  setAutoExploreIntensity(v: number): void {
    explorationStore.setAutoExploreIntensity(v);
  },

  setPressure(force: number, holdMs: number = 0): void {
    explorationStore.setPressure(force, holdMs);
  },

  // ----- Heatmap ------------------------------------------------------------

  refreshHeatmap(force = false): boolean {
    if (!mlStore.iml) return false;
    const cfg = inputStore.config;
    const z = cfg.zoom;
    const cx = cfg.anchorMode === 'center' ? 0.5 : cfg.anchorX;
    const cy = cfg.anchorMode === 'center' ? 0.5 : cfg.anchorY;
    return probeHeatmap.update({ cx, cy, zoom: z }, force);
  },

  getHeatmapCells(): Float32Array {
    return probeHeatmap.getCells();
  },

  setHeatmapColorMode(mode: HeatmapColorMode): void {
    probeHeatmap.setColorMode(mode);
  },

  // ----- Weight health ------------------------------------------------------

  getWeightHistogram(): number[] {
    return weightHistogram(mlStore.weights());
  },

  getWeightStatus() {
    return healthStatus(mlStore.weights());
  },

  getGradientFlow(beforeWeights: Float32Array, afterWeights: Float32Array) {
    if (!mlStore.iml) return { norms: [], status: [] };
    const arch = mlStore.iml.architecture;
    const sizes = layerWeightCounts({
      inputSize: arch.inputSize,
      hidden: arch.hidden,
      outputSize: arch.outputSize,
    });
    const norms = layerNorms(beforeWeights, afterWeights, sizes);
    return { norms, status: gradientStatuses(norms) };
  },

  // ----- Overrides ----------------------------------------------------------

  setOverride(modeId: string, paramName: string, patch): void {
    const existing = modeStore.getOverride(modeId, paramName);
    const next = {
      min: existing?.min ?? 0,
      max: existing?.max ?? 1,
      curve: existing?.curve ?? 'linear',
      curveParam: existing?.curveParam,
      muted: existing?.muted ?? false,
      pinned: existing?.pinned ?? false,
      frozen: existing?.frozen ?? false,
      fixedValue: existing?.fixedValue ?? 0.5,
      ...patch,
    } as Parameters<typeof modeStore.setOverride>[2];
    modeStore.setOverride(modeId, paramName, next);
  },

  clearOverride(modeId: string, paramName: string): void {
    modeStore.clearOverride(modeId, paramName);
  },

  clearAllOverrides(modeId: string): void {
    modeStore.clearAllOverrides(modeId);
  },

  getOverride(modeId: string, paramName: string) {
    return modeStore.getOverride(modeId, paramName);
  },

  // ----- Compound axes ------------------------------------------------------

  setAxis(axis: 'boldness' | 'memory' | 'precision', value: number): void {
    controlStore.setAxis(axis, value);
  },

  applyControlPreset(id: string): boolean {
    return controlStore.applyPreset(id);
  },

  // ----- Pipelines ----------------------------------------------------------

  setZoom(zoom: number): void {
    inputStore.setZoom(zoom);
  },

  setSpread(spread: number): void {
    explorationStore.setSpread(spread);
  },

  setOutputFreeze(frozen: boolean): void {
    outputStore.setFreezeOutput(frozen);
  },

  // ----- Session presets ----------------------------------------------------

  captureSessionPreset(withWeights = false): SessionPresetPayload {
    return captureSessionPreset(withWeights);
  },

  restoreSessionPreset(payload: SessionPresetPayload): boolean {
    return batch(() => restoreSessionPreset(payload));
  },

  saveSessionPreset(name: string, withWeights = false): void {
    saveNamedPreset(name, withWeights);
  },

  loadSessionPreset(id: string): boolean {
    return batch(() => loadNamedPreset(id));
  },

  buildShareUrl(): string {
    return buildShareUrl();
  },

  applyUrlParams(search?: string): boolean {
    return batch(() => applyUrlParams(search));
  },

  // ----- Bus ----------------------------------------------------------------

  emit(topic: string, data: unknown): void {
    // Lossy cast — the probe is intentionally weakly typed.
    coreBus.emit(topic as never, data as never);
  },

  on(topic: string, handler): () => void {
    return coreBus.onPrefix(topic, handler);
  },
};

/**
 * Install the probe on window. Idempotent — the probe object is a
 * singleton, so capturing `window.__nisps` once is safe across hot
 * reloads and re-installs.
 */
export function installDebugProbe(): void {
  if (typeof window === 'undefined') return;
  window.__nisps = probe;
}
