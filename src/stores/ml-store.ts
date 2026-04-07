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
  evalLoss(): number | null;
  inferBatch(points: number[][]): number[][];
  getLayerStats(): Array<{ meanAbs: number; maxAbs: number; deadFrac: number; satFrac: number }>;
  getWeights(): number[];
  getExampleCount(): number;
  getLoss(): number | null;
  getLossHistory(): number[];
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
    exampleCountSignal,
    lastLossSignal,

    getActiveIml: () => activeIml,
    getImlJoy: () => imlJoy,
    getImlHand: () => imlHand,

    setOutputMode: async (mode: OutputMode) => {
      setState('outputMode', mode);
      modeTopic.emit(mode);

      const targetCount = outputCountForMode(mode, state.midiCCCount);
      await resizeMLP(targetCount);
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
      const spread = state.spreadLevel;
      const noiseCap = 0.3 * (1 - spread) + 0.05 * spread;
      const newNoise = Math.min(noiseLevel() * 1.5, noiseCap);
      setNoiseLevel(newNoise);
      const s = speed ?? newNoise;
      activeIml.moveWeights(s, spread);
      runInference();
    },

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
