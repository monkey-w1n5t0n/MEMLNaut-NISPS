import { onMount, onCleanup, createSignal } from 'solid-js';
import { WasmIML } from './core/iml';

const N_INPUTS = 2;
const HIDDEN_LAYERS = [32, 48, 64];
const N_OUTPUTS = 126;

/**
 * Root application component for the NISPS immersive app.
 * Initializes WASM IML, runs initial inference, and exposes debug probe.
 */
export default function App() {
  const [status, setStatus] = createSignal<string>('Loading WASM...');
  const [ready, setReady] = createSignal(false);

  // IML instance lives outside reactive state (opaque handle)
  let iml: WasmIML | null = null;

  onMount(async () => {
    try {
      iml = await WasmIML.create(N_INPUTS, N_OUTPUTS, HIDDEN_LAYERS);

      // Run initial inference at center position
      iml.setInput(0, 0.5);
      iml.setInput(1, 0.5);
      iml.process();

      const outputs = iml.getOutputs();
      const allBounded = outputs.every((v: number) => v >= 0 && v <= 1);
      if (!allBounded) {
        setStatus('ERROR: outputs out of bounds');
        console.error('Unbounded outputs:', outputs);
        return;
      }

      setReady(true);
      setStatus(`Ready — ${outputs.length} outputs loaded`);

      // Expose debug probe if ?debug=1
      const params = new URLSearchParams(window.location.search);
      if (params.get('debug') === '1') {
        exposeDebugProbe(iml);
      }
    } catch (err) {
      setStatus(`Error: ${err}`);
      console.error('WASM init failed:', err);
    }
  });

  onCleanup(() => {
    iml?.destroy();
  });

  return (
    <div style={{
      display: 'flex',
      'flex-direction': 'column',
      'align-items': 'center',
      'justify-content': 'center',
      height: '100%',
      'font-family': 'var(--font-mono)',
      color: '#e0e0e8',
    }}>
      <h1 style={{
        'font-size': '1.5rem',
        'font-weight': 300,
        'margin-bottom': '0.5rem',
        'letter-spacing': '0.1em',
      }}>
        MEMLNaut NISPS
      </h1>
      <p style={{
        'font-size': '0.8rem',
        opacity: ready() ? 0.7 : 1,
        color: ready() ? '#e0e0e8' : '#00d4ff',
      }}>
        {status()}
      </p>
    </div>
  );
}

/**
 * Expose window.__nisps debug probe for Playwright tests.
 * All methods are synchronous (bypass SolidJS batching).
 */
function exposeDebugProbe(iml: WasmIML): void {
  const probe = {
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

  (window as any).__nisps = probe;
  console.log('[NISPS] Debug probe exposed at window.__nisps');
}
