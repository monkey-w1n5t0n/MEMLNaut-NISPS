import { onMount, onCleanup, createSignal } from 'solid-js';
import { WasmIML } from './core/iml';
import { createSignalBus, type SignalBus } from './bus/signal-bus';
import { exposeDebugProbe } from './probe/debug-probe';

const N_INPUTS = 2;
const HIDDEN_LAYERS = [32, 48, 64];
const N_OUTPUTS = 126;

// Singleton signal bus — shared across the entire app
const bus: SignalBus = createSignalBus();

// Expose bus globally for e2e tests and debug access
(window as any).__nispsBus = bus;

export { bus };

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
      exposeDebugProbe(iml);
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
