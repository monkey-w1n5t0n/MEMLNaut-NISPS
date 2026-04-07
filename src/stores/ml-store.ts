/**
 * ML Store — SolidJS reactive wrapper around dual WasmIML instances.
 *
 * Architecture (mirrors old a-app.js):
 *   imlJoy:  2 inputs (joystick), dynamic outputs — warm-started on resize
 *   imlHand: 14 inputs (hand tracking), dynamic outputs — fresh on resize
 *   iml:     pointer to whichever is active (imlJoy by default)
 *
 * Outputs are a Float32Array stored in a signal (NOT a store — proxies break typed arrays).
 * Mode changes trigger MLP recreation with warm-start weight transfer.
 */

import { createSignal, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { WasmIML } from '../core/iml';
import type { SignalBus } from '../bus/signal-bus';

// ─── Constants ────────────────────────────────────────────────────────

export const N_JOY_INPUTS = 2;
export const N_HAND_INPUTS = 14;
export const N_VISUAL_OUTPUTS = 20;
export const N_SYNTH_OUTPUTS = 126;
export const N_MIDI_CC_DEFAULT = 8;
export const N_AUDIO_CANVAS_OUTPUTS = 36;
export const HIDDEN_LAYERS_JOY = [32, 48, 64];
export const HIDDEN_LAYERS_HAND = [48, 48, 64];
export const MAX_UNDO = 20;

export type OutputMode = 'visual' | 'synth' | 'midi-cc' | 'audio-canvas';

/** Map from output mode to number of MLP outputs */
export function outputCountForMode(mode: OutputMode, midiCCCount = N_MIDI_CC_DEFAULT): number {
  switch (mode) {
    case 'visual': return N_VISUAL_OUTPUTS;
    case 'synth': return N_SYNTH_OUTPUTS;
    case 'midi-cc': return midiCCCount;
    case 'audio-canvas': return N_AUDIO_CANVAS_OUTPUTS;
    default: return N_SYNTH_OUTPUTS;
  }
}

// ─── Visual Presets ──────────────────────────────────────────────────

export interface VisualPresetExample {
  input: number[];
  output: number[];
}

/**
 * Visual preset definitions — each has 20-element output arrays (N_VISUAL_OUTPUTS).
 * When loaded, outputs are padded to current N_OUTPUTS with 0.5 defaults.
 * Ported from playground/js/a-app.js PRESETS object.
 */
export const VISUAL_PRESETS: Record<string, VisualPresetExample[]> = {
  'calm-to-chaotic': [
    { input: [0.1, 0.9], output: [0.25, 0.3, 0.1, 0.55, 0.2, 0.3, 0.02, 0.05, 0.9, 0.45, 0.25, 0.2, 0.9, 0.0, 0.0, 0.2, 0.05, 0.0, 0.0, 0.2] },
    { input: [0.9, 0.1], output: [0.75, 0.7, 0.9, 0.05, 0.8, 0.7, 0.9, 0.95, 0.3, 0.2, 0.85, 0.7, 0.25, 0.55, 1.0, 0.92, 0.02, 0.95, 0.8, 0.85] },
    { input: [0.5, 0.5], output: [0.5, 0.5, 0.5, 0.3, 0.5, 0.5, 0.4, 0.5, 0.7, 0.6, 0.5, 0.45, 0.55, 0.9, 0.5, 0.65, 0.08, 0.45, 0.4, 0.5] },
  ],
  'rainbow-sweep': [
    { input: [0.0, 0.5], output: [0.5, 0.5, 0.4, 0.0, 0.3, 0.4, 0.05, 0.3, 0.8, 0.55, 0.4, 0.3, 0.8, 0.0, 0.0, 0.45, 0.08, 0.2, 0.25, 0.45] },
    { input: [0.5, 0.5], output: [0.5, 0.5, 0.4, 0.5, 0.3, 0.4, 0.05, 0.3, 0.8, 0.55, 0.55, 0.35, 0.7, 0.0, 0.4, 0.45, 0.08, 0.45, 0.4, 0.6] },
    { input: [1.0, 0.5], output: [0.5, 0.5, 0.4, 1.0, 0.3, 0.4, 0.05, 0.3, 0.8, 0.55, 0.75, 0.45, 0.6, 0.0, 0.8, 0.45, 0.08, 0.7, 0.55, 0.75] },
  ],
  'vortex': [
    { input: [0.5, 0.5], output: [0.0, 0.8, 0.8, 0.6, 0.1, 0.15, 0.02, 1.0, 1.0, 0.3, 0.95, 0.85, 0.25, 1.0, 0.5, 0.95, 0.01, 1.0, 1.0, 1.0] },
    { input: [0.0, 0.0], output: [0.5, 0.2, 0.3, 0.8, 0.9, 0.6, 0.08, 0.1, 0.35, 0.8, 0.25, 0.15, 0.8, 0.5, 0.2, 0.35, 0.2, 0.15, 0.2, 0.25] },
    { input: [1.0, 1.0], output: [0.5, 0.2, 0.3, 0.2, 0.9, 0.6, 0.08, 0.1, 0.35, 0.8, 0.25, 0.15, 0.8, 0.5, 0.8, 0.35, 0.2, 0.15, 0.2, 0.25] },
    { input: [0.0, 1.0], output: [0.3, 0.4, 0.5, 0.4, 0.5, 0.4, 0.05, 0.5, 0.65, 0.5, 0.55, 0.45, 0.45, 0.2, 0.4, 0.7, 0.1, 0.5, 0.4, 0.55] },
    { input: [1.0, 0.0], output: [0.7, 0.4, 0.5, 0.0, 0.5, 0.4, 0.05, 0.5, 0.65, 0.5, 0.55, 0.45, 0.45, 0.2, 0.9, 0.7, 0.1, 0.5, 0.4, 0.55] },
  ],
  'spiral': [
    { input: [0.5, 0.5], output: [0.0, 0.6, 0.6, 0.3, 0.15, 0.2, 0.03, 0.7, 0.9, 0.25, 0.7, 0.6, 0.35, 0.8, 0.65, 0.9, 0.02, 0.3, 0.5, 0.7] },
    { input: [0.0, 0.0], output: [0.8, 0.3, 0.4, 0.7, 0.8, 0.5, 0.06, 0.2, 0.5, 0.7, 0.3, 0.2, 0.7, 0.3, 0.3, 0.4, 0.15, 0.1, 0.1, 0.3] },
    { input: [1.0, 1.0], output: [0.2, 0.3, 0.4, 0.1, 0.8, 0.5, 0.06, 0.2, 0.5, 0.7, 0.3, 0.2, 0.7, 0.3, 0.9, 0.4, 0.15, 0.1, 0.1, 0.3] },
  ],
  'embers': [
    { input: [0.5, 0.5], output: [0.1, 0.4, 0.2, 0.05, 0.05, 0.6, 0.02, 0.15, 0.6, 0.3, 0.15, 0.9, 0.5, 0.7, 0.1, 0.3, 0.2, 0.0, 0.0, 0.2] },
    { input: [0.2, 0.8], output: [0.5, 0.6, 0.15, 0.08, 0.08, 0.8, 0.015, 0.1, 0.8, 0.5, 0.1, 0.5, 0.8, 0.4, 0.05, 0.5, 0.1, 0.0, 0.0, 0.15] },
    { input: [0.8, 0.2], output: [0.9, 0.3, 0.35, 0.02, 0.12, 0.35, 0.04, 0.3, 0.4, 0.2, 0.3, 1.0, 0.3, 0.9, 0.2, 0.15, 0.3, 0.0, 0.0, 0.3] },
  ],
};

/** Get list of available visual preset names */
export const VISUAL_PRESET_NAMES = Object.keys(VISUAL_PRESETS);

/** Display labels for visual presets */
export const VISUAL_PRESET_LABELS: Record<string, string> = {
  'calm-to-chaotic': 'Calm/Chaos',
  'rainbow-sweep': 'Rainbow',
  'vortex': 'Vortex',
  'spiral': 'Spiral',
  'embers': 'Embers',
};

// ─── ML Store Interface ──────────────────────────────────────────────

export interface MLState {
  /** Current output mode */
  outputMode: OutputMode;
  /** Dynamic output count for MIDI CC mode */
  midiCCCount: number;
  /** Spread level [0,1] — controls weight initialization & RL noise */
  spreadLevel: number;
  /** Whether IML instances are initialized */
  initialized: boolean;
}

export interface MLStore {
  // Reactive state
  readonly state: MLState;
  readonly outputs: () => Float32Array;
  readonly outputCount: () => number;
  /** Current noise level for RL exploration */
  readonly noiseLevel: () => number;
  /** Reactive undo stack depth — updates on push/pop */
  readonly undoDepthSignal: () => number;
  /** Reactive example count — updates when examples are added/cleared */
  readonly exampleCountSignal: () => number;
  /** Reactive last loss — updates after training */
  readonly lastLossSignal: () => number | null;

  // IML access (opaque handles, NOT reactive)
  getActiveIml(): WasmIML | null;
  getImlJoy(): WasmIML | null;
  getImlHand(): WasmIML | null;

  // Actions
  setOutputMode(mode: OutputMode): Promise<void>;
  setMidiCCCount(count: number): Promise<void>;
  setSpreadLevel(level: number): void;

  // Direct IML operations (synchronous)
  setInputs(x: number, y: number): void;
  randomise(): void;
  clearExamples(): void;
  /** Clear examples, loss history, and reset noise to default */
  clearAll(): void;
  /** Add current input/output as a training example (updates reactive count) */
  addExample(): void;
  train(): number | null;
  trainAsync(): Promise<number | null>;
  thumbsUp(): Promise<number | null>;
  thumbsDown(speed?: number): void;
  /** Undo: pop from undo stack and restore weights + noise level */
  undo(): void;
  /** Current undo stack depth */
  undoDepth(): number;
  evalLoss(): number | null;
  inferBatch(points: number[][]): number[][];
  getLayerStats(): Array<{ meanAbs: number; maxAbs: number; deadFrac: number; satFrac: number }>;
  getWeights(): number[];
  getExampleCount(): number;
  getLoss(): number | null;
  getLossHistory(): number[];
  /** Load a visual preset: clears dataset, adds preset examples, trains, updates outputs */
  loadVisualPreset(name: string): void;
  saveState(): void;

  // Lifecycle
  dispose(): void;
}

// ─── Factory ─────────────────────────────────────────────────────────

export async function createMLStore(bus: SignalBus): Promise<MLStore> {
  const [state, setState] = createStore<MLState>({
    outputMode: 'visual',  // default mode — FlowField particles render on load
    midiCCCount: N_MIDI_CC_DEFAULT,
    spreadLevel: 0.6,
    initialized: false,
  });

  // Outputs as signal — Float32Array MUST NOT go in store (proxy overhead)
  const initialCount = outputCountForMode('visual');
  const [outputs, setOutputs] = createSignal<Float32Array>(new Float32Array(initialCount));
  const [outputCount, setOutputCount] = createSignal<number>(initialCount);

  // Noise level signal for RL exploration (reactive for status line + noise ring)
  const [noiseLevel, setNoiseLevel] = createSignal<number>(0.05);

  // Reactive example count and last loss (for status line to watch)
  const [exampleCountSignal, setExampleCountSignal] = createSignal<number>(0);
  const [lastLossSignal, setLastLossSignal] = createSignal<number | null>(null);

  // Undo stack — weight snapshots with noise level, max 20 entries (ring buffer)
  const undoStack: Array<{ weights: number[]; noiseLevel: number }> = [];
  // Reactive undo depth signal for UI button state
  const [undoDepthSignal, setUndoDepthSignal] = createSignal<number>(0);

  // IML instances — module-scope opaque handles (not reactive)
  let imlJoy: WasmIML | null = null;
  let imlHand: WasmIML | null = null;
  let activeIml: WasmIML | null = null;

  // Initialize dual IML instances
  const currentCount = outputCount();

  imlJoy = await WasmIML.create(N_JOY_INPUTS, currentCount, HIDDEN_LAYERS_JOY);
  imlJoy.setLogger((msg: string) => console.log('[NISPS:joy]', msg));

  imlHand = await WasmIML.create(N_HAND_INPUTS, currentCount, HIDDEN_LAYERS_HAND);
  imlHand.setLogger((msg: string) => console.log('[NISPS:hand]', msg));

  activeIml = imlJoy; // default to joystick

  // Run initial inference at center position
  activeIml.setInput(0, 0.5);
  activeIml.setInput(1, 0.5);
  activeIml.process();
  setOutputs(new Float32Array(activeIml.getOutputs()));

  setState('initialized', true);

  // Create bus topics for external consumers
  const outputsTopic = bus.createTopic<Float32Array>('ml.outputs');
  const outputCountTopic = bus.createTopic<number>('ml.outputCount');
  const modeTopic = bus.createTopic<OutputMode>('mode.output');

  // Publish initial values
  outputsTopic.emit(outputs());
  outputCountTopic.emit(outputCount());

  // ─── Helper: run inference and update signal ───

  function runInference(): void {
    if (!activeIml) return;
    activeIml.process();
    const newOutputs = new Float32Array(activeIml.getOutputs());
    setOutputs(newOutputs);
    outputsTopic.emit(newOutputs);
    // Update reactive state signals
    setExampleCountSignal(activeIml.exampleCount);
    setLastLossSignal(activeIml.lastLoss);
  }

  // ─── Helper: push undo snapshot ───

  function pushUndoSnapshot(): void {
    if (!activeIml) return;
    const weights = activeIml._getFlatWeights();
    undoStack.push({
      weights,
      noiseLevel: noiseLevel(),
    });
    // Ring buffer eviction: drop oldest if over capacity
    if (undoStack.length > MAX_UNDO) {
      undoStack.shift();
    }
    setUndoDepthSignal(undoStack.length);
  }

  // ─── Helper: resize MLP (mode switch) ───

  async function resizeMLP(newCount: number): Promise<void> {
    if (newCount === outputCount()) return;

    // Extract joystick weights for warm-start
    const joySnapshot = imlJoy ? imlJoy.extractWeights() : null;

    // Destroy old instances
    imlJoy?.destroy();
    imlHand?.destroy();

    // Joystick IML: warm-start if possible
    if (joySnapshot) {
      imlJoy = await WasmIML.createWithWarmStart(
        joySnapshot, newCount, 1000, 1.0, 0.00001
      );
    } else {
      imlJoy = await WasmIML.create(N_JOY_INPUTS, newCount, HIDDEN_LAYERS_JOY);
      imlJoy.randomiseWeights(state.spreadLevel);
    }
    imlJoy.setLogger((msg: string) => console.log('[NISPS:joy]', msg));

    // Hand IML: fresh init
    imlHand = await WasmIML.create(N_HAND_INPUTS, newCount, HIDDEN_LAYERS_HAND);
    imlHand.setLogger((msg: string) => console.log('[NISPS:hand]', msg));
    imlHand.randomiseWeights(state.spreadLevel);

    activeIml = imlJoy;

    // Run inference at current position
    activeIml.setInput(0, 0.5);
    activeIml.setInput(1, 0.5);
    activeIml.process();

    const newOutputs = new Float32Array(activeIml.getOutputs());
    setOutputs(newOutputs);
    setOutputCount(newCount);
    outputsTopic.emit(newOutputs);
    outputCountTopic.emit(newCount);

    console.log(`[NISPS] MLP resized to ${newCount} outputs (joystick IML warm-started)`);
  }

  // ─── Store implementation ───

  const store: MLStore = {
    get state() { return state; },
    outputs,
    outputCount,
    noiseLevel,
    undoDepthSignal,
    exampleCountSignal,
    lastLossSignal,

    getActiveIml: () => activeIml,
    getImlJoy: () => imlJoy,
    getImlHand: () => imlHand,

    setOutputMode: async (mode: OutputMode) => {
      const targetCount = outputCountForMode(mode, state.midiCCCount);
      const needsResize = targetCount !== outputCount();

      // Warn about training data loss if resizing with existing examples
      if (needsResize && activeIml && activeIml.exampleCount > 0) {
        const confirmed = window.confirm(
          `Switching to ${mode} mode requires ${targetCount} outputs (currently ${outputCount()}). ` +
          `This will reset training examples. Network weights will be partially preserved. Continue?`
        );
        if (!confirmed) {
          // Abort — mode stays unchanged
          return;
        }
      }

      setState('outputMode', mode);
      modeTopic.emit(mode);

      if (needsResize) {
        await resizeMLP(targetCount);
      }
    },

    setMidiCCCount: async (count: number) => {
      setState('midiCCCount', count);
      if (state.outputMode === 'midi-cc') {
        await resizeMLP(count);
      }
    },

    setSpreadLevel: (level: number) => {
      setState('spreadLevel', Math.max(0, Math.min(1, level)));
    },

    setInputs: (x: number, y: number) => {
      if (!activeIml) return;
      // Clamp to [0,1] and guard against NaN/Infinity
      const clamp = (v: number) => {
        if (!Number.isFinite(v)) return 0.5;
        return Math.max(0, Math.min(1, v));
      };
      activeIml.setInput(0, clamp(x));
      activeIml.setInput(1, clamp(y));
      runInference();
    },

    randomise: () => {
      if (!activeIml) return;
      pushUndoSnapshot();
      activeIml.randomiseWeights(state.spreadLevel);
      setNoiseLevel(0.05);
      runInference();
    },

    clearExamples: () => {
      activeIml?.clearDataset();
      setExampleCountSignal(0);
    },

    clearAll: () => {
      activeIml?.clearDataset();
      if (activeIml) {
        activeIml.lossHistory.length = 0;
        activeIml.lastLoss = null;
        activeIml.bestLoss = null;
        activeIml.totalTrainingIterations = 0;
      }
      setNoiseLevel(0.05);
      setExampleCountSignal(0);
      setLastLossSignal(null);
    },

    addExample: () => {
      if (!activeIml) return;
      activeIml.addExample(
        activeIml.inputState.slice(),
        activeIml.outputState.slice()
      );
      setExampleCountSignal(activeIml.exampleCount);
    },

    train: () => {
      if (!activeIml) return null;
      const loss = activeIml.train();
      runInference();
      return loss;
    },

    trainAsync: () => {
      if (!activeIml) return Promise.resolve(null);
      return activeIml.trainAsync(() => {
        runInference();
      });
    },

    thumbsUp: () => {
      if (!activeIml) return Promise.resolve(null);
      activeIml.addExample(
        activeIml.inputState.slice(),
        activeIml.outputState.slice()
      );
      // Update reactive signals immediately
      setExampleCountSignal(activeIml.exampleCount);
      // Decay noise on positive feedback
      const decayed = Math.max(noiseLevel() * 0.7, 0.005);
      setNoiseLevel(decayed);
      return activeIml.trainAsync(() => runInference());
    },

    thumbsDown: (speed?: number) => {
      if (!activeIml) return;
      pushUndoSnapshot();
      const spread = state.spreadLevel;
      const noiseCap = 0.3 * (1 - spread) + 0.05 * spread;
      const newNoise = Math.min(noiseLevel() * 1.5, noiseCap);
      setNoiseLevel(newNoise);
      const s = speed ?? newNoise;
      activeIml.moveWeights(s, spread);
      runInference();
    },

    undo: () => {
      if (undoStack.length === 0 || !activeIml) return;
      const snapshot = undoStack.pop()!;
      activeIml._setFlatWeights(snapshot.weights);
      setNoiseLevel(snapshot.noiseLevel);
      setUndoDepthSignal(undoStack.length);
      runInference();
    },

    undoDepth: () => undoStack.length,

    evalLoss: () => activeIml?.evalLoss() ?? null,

    inferBatch: (points: number[][]) => {
      if (!activeIml) return [];
      return activeIml.inferBatch(points);
    },

    getLayerStats: () => activeIml?.getLayerStats() ?? [],

    getWeights: () => activeIml?._getFlatWeights() ?? [],

    getExampleCount: () => activeIml?.exampleCount ?? 0,

    getLoss: () => activeIml?.lastLoss ?? null,

    getLossHistory: () => activeIml?.lossHistory.slice() ?? [],

    loadVisualPreset: (name: string) => {
      if (!imlJoy) return;
      const preset = VISUAL_PRESETS[name];
      if (!preset) return;

      // Always apply to joystick IML (visual presets use 2 inputs)
      imlJoy.clearDataset();

      // Pad 20-element preset outputs to current output count with 0.5 defaults
      const currentOutputCount = outputCount();
      for (const ex of preset) {
        const paddedOutputs = new Array(currentOutputCount).fill(0.5);
        for (let i = 0; i < ex.output.length && i < paddedOutputs.length; i++) {
          paddedOutputs[i] = ex.output[i];
        }
        imlJoy.addExample(ex.input.slice(), paddedOutputs);
      }

      // Point to joystick IML for training
      const prevActive = activeIml;
      activeIml = imlJoy;

      // Sync training
      activeIml.train();

      // Run inference with current inputs
      activeIml.process();
      const newOutputs = new Float32Array(activeIml.getOutputs());
      setOutputs(newOutputs);
      outputsTopic.emit(newOutputs);

      // Update reactive signals
      setExampleCountSignal(activeIml.exampleCount);
      setLastLossSignal(activeIml.lastLoss);

      // Restore active IML pointer
      activeIml = prevActive;
    },

    saveState: () => {
      if (!activeIml) return;
      const data = {
        weights: activeIml._getFlatWeights(),
        inputState: activeIml.inputState.slice(),
        outputState: activeIml.outputState.slice(),
        exampleCount: activeIml.exampleCount,
        lossHistory: activeIml.lossHistory.slice(),
        outputMode: state.outputMode,
        spreadLevel: state.spreadLevel,
      };
      localStorage.setItem('nisps-a-immersive', JSON.stringify(data));
    },

    dispose: () => {
      imlJoy?.destroy();
      imlHand?.destroy();
      imlJoy = null;
      imlHand = null;
      activeIml = null;
    },
  };

  return store;
}
