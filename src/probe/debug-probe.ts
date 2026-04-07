/**
 * Debug probe — window.__nisps exposed when ?debug=1 is in the URL.
 * Used by Playwright e2e tests. Zero footprint in production.
 *
 * All methods are synchronous (bypass SolidJS batching with batch()/untrack()).
 * Updated to work with MLStore interface.
 */

import type { MLStore } from '../stores/ml-store';

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
  clearAll: () => void;
  saveState: () => void;
  evalLoss: () => number | null;
  inferBatch: (points: number[][]) => number[][];
  getLayerStats: () => Array<{
    meanAbs: number;
    maxAbs: number;
    deadFrac: number;
    satFrac: number;
  }>;
  getLossHistory: () => number[];
}

/**
 * Check if the debug probe should be activated.
 */
export function isDebugMode(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('debug') === '1';
}

/**
 * Create the debug probe object, wired to an MLStore instance.
 */
export function createDebugProbe(store: MLStore): DebugProbe {
  return {
    getOutputs: () => Array.from(store.outputs()),

    getLoss: () => store.getLoss(),

    getWeights: () => store.getWeights(),

    getExampleCount: () => store.getExampleCount(),

    setInputs: (x: number, y: number) => {
      store.setInputs(x, y);
    },

    thumbsUp: () => store.thumbsUp(),

    thumbsDown: () => store.thumbsDown(),

    train: () => store.train(),

    trainAsync: () => store.trainAsync(),

    randomise: () => store.randomise(),

    clearExamples: () => store.clearExamples(),

    clearAll: () => store.clearAll(),

    saveState: () => store.saveState(),

    evalLoss: () => store.evalLoss(),

    inferBatch: (points: number[][]) => store.inferBatch(points),

    getLayerStats: () => store.getLayerStats(),

    getLossHistory: () => store.getLossHistory(),
  };
}

/**
 * Expose window.__nisps if ?debug=1 is present.
 * Returns the probe object (or undefined if not in debug mode).
 */
export function exposeDebugProbe(store: MLStore): DebugProbe | undefined {
  if (!isDebugMode()) return undefined;

  const probe = createDebugProbe(store);
  (window as any).__nisps = probe;
  console.log('[NISPS] Debug probe exposed at window.__nisps');
  return probe;
}
