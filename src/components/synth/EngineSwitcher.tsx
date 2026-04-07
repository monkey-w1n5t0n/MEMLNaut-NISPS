/**
 * EngineSwitcher — pill toggle for switching between synth engines.
 *
 * Shows three pills: C15 (Shaper Feedback), Additive, FM.
 * Clicking an inactive pill:
 *   1. Stops the current engine via synthStore.stop()
 *   2. Instantiates the new engine via the registry factory
 *   3. Calls engine.init() (async) — shows a brief loading state
 *   4. Calls synthStore.setEngine() with the initialised engine
 *
 * The active pill matches synthStore.state.engineId. While a switch is in
 * progress the switcher disables all buttons to prevent double-clicks.
 */

import { createSignal, For } from 'solid-js';
import type { SynthStore } from '../../stores/synth-store';
import type { SynthEngine } from '../../core/synth/engine-interface';
import { C15Adapter } from '../../core/synth/c15-adapter';
import { AdditiveEngine } from '../../core/synth/additive-engine';
import { FMEngine } from '../../core/synth/fm-engine';
import '../layout/drawer.css';
import './engine-switcher.css';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface EngineSwitcherProps {
  synthStore: SynthStore;
}

// ─── Engine registry ──────────────────────────────────────────────────────────

interface EngineEntry {
  id: string;
  label: string;
  factory: () => SynthEngine;
}

const ENGINES: EngineEntry[] = [
  { id: 'shaper-feedback', label: 'C15',      factory: () => new C15Adapter() },
  { id: 'additive',        label: 'Additive', factory: () => new AdditiveEngine() },
  { id: 'fm',              label: 'FM',        factory: () => new FMEngine() },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function EngineSwitcher(props: EngineSwitcherProps) {
  const [loading, setLoading] = createSignal(false);

  const activeId = () => props.synthStore.state.engineId;

  async function onSelect(entry: EngineEntry): Promise<void> {
    // Skip if already active or mid-transition
    if (entry.id === activeId() || loading()) return;

    setLoading(true);
    try {
      // Stop the current engine (also updates isRunning in the store)
      props.synthStore.stop();

      // Create and initialise the new engine
      const newEngine = entry.factory();
      // init() needs an AudioContext — use a shared/suspended one if available,
      // or create a minimal one just for the engine. Each concrete engine
      // (C15Adapter, FaustEngineBase) manages its own AudioContext internally,
      // so passing a dummy here is safe for engines that ignore the argument.
      const audioCtx = new AudioContext();
      await newEngine.init(audioCtx);

      // Hand the initialised engine to the store
      props.synthStore.setEngine(newEngine);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="engine-switcher">
      <div class="engine-switcher-label">Engine</div>
      <div class={`pill-toggle engine-switcher-pills${loading() ? ' engine-switcher-loading' : ''}`}>
        <For each={ENGINES}>
          {(entry) => (
            <button
              class={`pill-opt${activeId() === entry.id ? ' active' : ''}`}
              disabled={loading()}
              aria-pressed={activeId() === entry.id}
              onClick={() => onSelect(entry)}
            >
              {loading() && activeId() !== entry.id
                ? <span class="engine-switcher-spinner" aria-hidden="true" />
                : null}
              {entry.label}
            </button>
          )}
        </For>
      </div>
      {loading() && (
        <div class="engine-switcher-status" aria-live="polite">
          Loading…
        </div>
      )}
    </div>
  );
}
