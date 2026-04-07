import { onMount, onCleanup, createSignal } from 'solid-js';
import { createMLStore, type MLStore } from './stores/ml-store';
import { exposeDebugProbe } from './probe/debug-probe';
import bus from './bus';

/**
 * Root application component for the NISPS immersive app.
 * Initializes ML store (dual WasmIML instances), runs initial inference,
 * and exposes debug probe.
 */
export default function App() {
  const [status, setStatus] = createSignal<string>('Loading WASM...');
  const [ready, setReady] = createSignal(false);

  let mlStore: MLStore | null = null;

  onMount(async () => {
    try {
      const store = await createMLStore(bus);

      // Expose store globally for e2e tests
      (window as any).__nispsStore = store;

      // Expose bus topics for testing dual IML and mode switching
      bus.createTopic('ml.imlJoy').emit(store.getImlJoy() as any);
      bus.createTopic('ml.imlHand').emit(store.getImlHand() as any);

      const outputs = store.outputs();
      const allBounded = Array.from(outputs).every(v => v >= 0 && v <= 1);
      if (!allBounded) {
        setStatus('ERROR: outputs out of bounds');
        console.error('Unbounded outputs:', outputs);
        return;
      }

      setReady(true);
      setStatus(`Ready — ${outputs.length} outputs loaded`);

      // Expose debug probe if ?debug=1
      exposeDebugProbe(store);

      mlStore = store;
    } catch (err) {
      setStatus(`Error: ${err}`);
      console.error('WASM init failed:', err);
    }
  });

  onCleanup(() => {
    mlStore?.dispose();
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
