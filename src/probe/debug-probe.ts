/**
 * Debug probe — window.__nisps exposed when ?debug=1 is in the URL.
 * Used by Playwright e2e tests. Zero footprint in production.
 *
 * All methods are synchronous (bypass SolidJS batching with batch()/untrack()).
 */

import type { WasmIML } from '../core/iml';

export interface DebugProbe {
  getOutputs: () => number[];
  getLoss: () => number | null;
  getWeights: () => number[];
  getExampleCount: () => number;
  setInputs: (x: number, y: number) => void;
  thumbsUp: () => Promise<number | null>;
  thumbsDown: () => void;
  train: () => number | null;
  trainAsync: () => Promise<number | null>;
  randomise: () => void;
  clearExamples: () => void;
  saveState: () => void;
  evalLoss: () => number | null;
  inferBatch: (points: number[][]) => number[][];
  getLayerStats: () => Array<{
    meanAbs: number;
    maxAbs: number;
    deadFrac: number;
    satFrac: number;
  }>;
}

/**
 * Check if the debug probe should be activated.
 */
export function isDebugMode(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('debug') === '1';
}

/**
 * Create the debug probe object, wired to a WasmIML instance.
 */
export function createDebugProbe(iml: WasmIML): DebugProbe {
  return {
    getOutputs: () => iml.getOutputs(),

    getLoss: () => iml.lastLoss,

    getWeights: () => iml._getFlatWeights(),

    getExampleCount: () => iml.exampleCount,

    setInputs: (x: number, y: number) => {
      iml.setInput(0, Math.max(0, Math.min(1, x)));
      iml.setInput(1, Math.max(0, Math.min(1, y)));
      iml.process();
    },

    thumbsUp: () => {
      iml.addExample(iml.inputState.slice(), iml.outputState.slice());
      return iml.trainAsync();
    },

    thumbsDown: () => {
      const spread = 0.6;
      const speed = 0.15 * (1 - spread) + 0.05 * spread;
      iml.moveWeights(speed, spread);
    },

    train: () => iml.train(),

    trainAsync: () => iml.trainAsync(),

    randomise: () => iml.randomiseWeights(0.6),

    clearExamples: () => iml.clearDataset(),

    saveState: () => {
      const state = {
        weights: iml._getFlatWeights(),
        inputState: iml.inputState.slice(),
        outputState: iml.outputState.slice(),
        exampleCount: iml.exampleCount,
        lossHistory: iml.lossHistory.slice(),
      };
      localStorage.setItem('nisps-a-immersive', JSON.stringify(state));
    },

    evalLoss: () => iml.evalLoss(),

    inferBatch: (points: number[][]) => iml.inferBatch(points),

    getLayerStats: () => iml.getLayerStats(),
  };
}

/**
 * Expose window.__nisps if ?debug=1 is present.
 * Returns the probe object (or undefined if not in debug mode).
 */
export function exposeDebugProbe(iml: WasmIML): DebugProbe | undefined {
  if (!isDebugMode()) return undefined;

  const probe = createDebugProbe(iml);
  (window as any).__nisps = probe;
  console.log('[NISPS] Debug probe exposed at window.__nisps');
  return probe;
}
