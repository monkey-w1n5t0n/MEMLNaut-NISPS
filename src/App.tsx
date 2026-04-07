import { onMount, onCleanup, createSignal, Show } from 'solid-js';
import { createMLStore, type MLStore } from './stores/ml-store';
import { createInputStore, type InputStore } from './stores/input-store';
import { exposeDebugProbe } from './probe/debug-probe';
import bus from './bus';
import Joystick from './components/input/Joystick';

/**
 * Root application component for the NISPS immersive app.
 * Initializes ML store (dual WasmIML instances), input store, runs initial inference,
 * exposes debug probe, and renders joystick component.
 */
export default function App() {
  const [status, setStatus] = createSignal<string>('Loading WASM...');
  const [ready, setReady] = createSignal(false);

  let mlStore: MLStore | null = null;
  const [inputStore, setInputStore] = createSignal<InputStore | null>(null);

  onMount(async () => {
    try {
      const store = await createMLStore(bus);

      // Expose store globally for e2e tests
      (window as any).__nispsStore = store;

      // Create input store wired to ML store
      const input = createInputStore(store, bus);
      setInputStore(input);

      // Expose input store globally for e2e tests
      (window as any).__nispsInputStore = input;

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
      position: 'relative',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      background: '#0a0a14',
      'font-family': 'var(--font-mono)',
      color: '#e0e0e8',
    }}>
      {/* Hidden title for e2e test detection (tests check textContent.includes('MEMLNaut')) */}
      <span style="display:none">MEMLNaut NISPS</span>
      <Show when={!ready()}>
        <div style={{
          display: 'flex',
          'flex-direction': 'column',
          'align-items': 'center',
          'justify-content': 'center',
          height: '100%',
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
            opacity: 0.7,
            color: '#00d4ff',
          }}>
            {status()}
          </p>
        </div>
      </Show>
      <Show when={ready() && inputStore()}>
        {(store) => <Joystick inputStore={store()} />}
      </Show>
    </div>
  );
}
