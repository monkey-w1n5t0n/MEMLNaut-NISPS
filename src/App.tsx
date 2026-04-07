import { onMount, onCleanup, createSignal, Show } from 'solid-js';
import { createMLStore, type MLStore } from './stores/ml-store';
import { createInputStore, type InputStore } from './stores/input-store';
import { createOutputStore, OutputProvider } from './stores/output-store';
import { createSynthStore, SynthProvider } from './stores/synth-store';
import { createSessionStore } from './stores/session-store';
import { exposeDebugProbe } from './probe/debug-probe';
import { exposeEocProbe } from './probe/eoc-probe';
import { EOCChain } from './core/eoc';
import bus from './bus';

// Hooks
import { useOutputRouting } from './hooks/useOutputRouting';
import { useSynthRouting } from './hooks/useSynthRouting';
import { useInputPipeline } from './hooks/useInputPipeline';
import { useOutputPipeline } from './hooks/useOutputPipeline';
import { useKeyboard } from './hooks/useKeyboard';
import { useAudioContext } from './hooks/useAudioContext';

// Components
import Joystick from './components/input/Joystick';
import JoyMap from './components/input/JoyMap';
import FlowField from './components/visual/FlowField';
import SynthVisualizer from './components/visual/SynthVisualizer';
import HeatmapStrip from './components/visual/HeatmapStrip';
import Dock from './components/layout/Dock';
import TrainingDrawer from './components/layout/TrainingDrawer';
import ModeDrawer from './components/layout/ModeDrawer';
import StatusLine from './components/layout/StatusLine';
import HelpOverlay from './components/layout/HelpOverlay';
import RLButtons from './components/rl/RLButtons';
import SynthControls from './components/synth/SynthControls';
import PresetSelector from './components/synth/PresetSelector';
import EngineSwitcher from './components/synth/EngineSwitcher';
import ControlSurface from './components/controls/ControlSurface';
import ABToggle from './components/controls/ABToggle';
import AutoExploreToggle from './components/controls/AutoExploreToggle';
import { createABCompare } from './core/ab-compare';
import { createAutoExplore } from './core/auto-explore';

/**
 * Root application component for the NISPS immersive app.
 * Initializes all stores, hooks, and components.
 */
export default function App() {
  const [status, setStatus] = createSignal<string>('Loading WASM...');
  const [ready, setReady] = createSignal(false);

  let mlStore: MLStore | null = null;
  const [inputStore, setInputStore] = createSignal<InputStore | null>(null);

  // Stores (created eagerly, wired after WASM init)
  const outputStore = createOutputStore();
  const synthStore = createSynthStore();
  const sessionStore = createSessionStore();

  // EOC chain (lazy — needs AudioContext)
  let eocChain: EOCChain | null = null;

  // Drawer state
  const [openDrawers, setOpenDrawers] = createSignal<Set<string>>(new Set());

  // Help overlay state
  const helpSeen = localStorage.getItem('nisps-help-seen') === '1';
  const [helpVisible, setHelpVisible] = createSignal(!helpSeen);

  function toggleDrawer(drawerName: string): void {
    if (drawerName === 'help') {
      setHelpVisible(v => !v);
      return;
    }
    setOpenDrawers(prev => {
      const next = new Set(prev);
      if (next.has(drawerName)) {
        next.delete(drawerName);
      } else {
        next.add(drawerName);
      }
      return next;
    });
  }

  function closeDrawer(drawerName: string): void {
    setOpenDrawers(prev => {
      const next = new Set(prev);
      next.delete(drawerName);
      return next;
    });
  }

  onMount(async () => {
    try {
      const store = await createMLStore(bus);

      // Apply URL params
      if (sessionStore.urlParams.spread !== undefined) {
        store.setSpreadLevel(sessionStore.urlParams.spread);
      }

      // Expose store globally for e2e tests
      (window as any).__nispsStore = store;

      // Create input store wired to ML store
      const input = createInputStore(store, bus);
      setInputStore(input);
      (window as any).__nispsInputStore = input;

      // Expose bus topics for dual IML
      bus.createTopic('ml.imlJoy').emit(store.getImlJoy() as any);
      bus.createTopic('ml.imlHand').emit(store.getImlHand() as any);

      const outputs = store.outputs();
      const allBounded = Array.from(outputs).every(v => v >= 0 && v <= 1);
      if (!allBounded) {
        setStatus('ERROR: outputs out of bounds');
        console.error('Unbounded outputs:', outputs);
        return;
      }

      mlStore = store;

      // Initialize EOC chain
      eocChain = new EOCChain();
      exposeEocProbe(eocChain);

      // Restore saved state
      const savedState = sessionStore.load();
      if (savedState) {
        try {
          if (savedState.weights?.length) {
            store.getActiveIml()?._setFlatWeights(savedState.weights);
            store.setInputs(0.5, 0.5); // re-run inference
          }
          if (savedState.spreadLevel !== undefined) {
            store.setSpreadLevel(savedState.spreadLevel);
          }
        } catch (e) {
          console.warn('[NISPS] Failed to restore saved state:', e);
        }
      }

      // Start auto-save
      const stopAutoSave = sessionStore.startAutoSave(store as any);
      onCleanup(stopAutoSave);

      setReady(true);
      setStatus(`Ready — ${outputs.length} outputs loaded`);

      // Expose debug probe if ?debug=1
      exposeDebugProbe(store);
    } catch (err) {
      setStatus(`Error: ${err}`);
      console.error('WASM init failed:', err);
    }
  });

  onCleanup(() => {
    mlStore?.dispose();
  });

  // --- Hooks (called in render scope, run when ready) ---

  // These hooks use createEffect internally, which is fine in component scope.
  // They'll be inert until mlStore is set.

  return (
    <OutputProvider store={outputStore}>
      <SynthProvider store={synthStore}>
        <div style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          background: '#0a0a14',
          'font-family': 'var(--font-mono)',
          color: '#e0e0e8',
        }}>
          {/* Hidden title for e2e test detection */}
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

          <Show when={ready() && mlStore !== null}>
            {(() => {
              const store = mlStore!;
              const input = inputStore()!;

              // Wire hooks now that stores are ready
              useOutputRouting(store, bus);
              useSynthRouting(synthStore, bus);
              const inputPipeline = useInputPipeline(input, store);
              const outputPipeline = useOutputPipeline(store, outputStore);
              useKeyboard(store, input);
              useAudioContext();

              // Create AB compare and auto-explore instances
              const ab = createABCompare();
              const autoExplore = createAutoExplore();
              autoExplore.onExplore((e) => store.thumbsDown(e.intensity));

              return (
                <>
                  {/* Fullscreen visualizers (only one active at a time) */}
                  <Show when={store.state.outputMode === 'visual'}>
                    <FlowField mlStore={store} />
                  </Show>
                  <Show when={store.state.outputMode === 'synth'}>
                    <SynthVisualizer mlStore={store} />
                  </Show>

                  {/* Joystick + JoyMap minimap */}
                  <Joystick inputStore={input} mlStore={store} />
                  <JoyMap inputStore={input} mlStore={store} />

                  {/* Heatmap strip at top */}
                  <HeatmapStrip mlStore={store} />

                  {/* Dock + Drawers */}
                  <Dock onToggleDrawer={toggleDrawer} openDrawers={openDrawers} />

                  <div class="drawer-stack">
                    <TrainingDrawer
                      mlStore={store}
                      visible={openDrawers().has('training')}
                      onClose={() => closeDrawer('training')}
                    />
                    <ModeDrawer
                      mlStore={store}
                      visible={openDrawers().has('mode')}
                      onClose={() => closeDrawer('mode')}
                    />
                    <SynthControls
                      synthStore={synthStore}
                      visible={openDrawers().has('synth')}
                      onClose={() => closeDrawer('synth')}
                    />
                  </div>

                  {/* Synth sub-panels (inside synth drawer) */}
                  <Show when={openDrawers().has('synth')}>
                    <PresetSelector synthStore={synthStore} />
                    <EngineSwitcher synthStore={synthStore} />
                  </Show>

                  {/* Control Surface (floating bar, bottom-left) */}
                  <ControlSurface
                    mlStore={store}
                    inputPipeline={inputPipeline}
                    outputPipeline={outputPipeline}
                  />

                  {/* RL Buttons + extras */}
                  <RLButtons mlStore={store} />
                  <ABToggle mlStore={store} ab={ab} />
                  <AutoExploreToggle autoExplore={autoExplore} />

                  {/* Status Line */}
                  <StatusLine mlStore={store} />
                </>
              );
            })()}
          </Show>

          {/* Help overlay */}
          <HelpOverlay
            visible={helpVisible()}
            onClose={() => setHelpVisible(false)}
          />
        </div>
      </SynthProvider>
    </OutputProvider>
  );
}
