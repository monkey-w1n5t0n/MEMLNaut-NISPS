/**
 * ModeSwitcher — top-level select that picks the active mode.
 *
 * Writes through `modeStore.switchMode(id)` so persistence + the bus event
 * fire correctly. Reads the current selection back from the store so it
 * stays in sync with persisted state on first paint.
 *
 * Audio engine switching is handled inside the mode runtime (each mode
 * routes its own engine_id through `EngineHost.setEngine` when started).
 */

import { Component, createMemo, For, Show } from 'solid-js';
import { modeStore } from '../stores/mode-store';
import { MODE_REGISTRY, getModeById } from './index';
import styles from './ModeSwitcher.module.css';

export const ModeSwitcher: Component = () => {
  const activeId = () => modeStore.state.activeModeId ?? MODE_REGISTRY[0]!.id;
  const active = createMemo(() => getModeById(activeId()));

  return (
    <div class={styles.bar} role="region" aria-label="Mode selector">
      <span class={styles.label}>Mode</span>
      <select
        class={styles.select}
        value={activeId()}
        onChange={(e) => modeStore.switchMode(e.currentTarget.value)}
        aria-label="Select active mode"
      >
        <For each={MODE_REGISTRY}>
          {(m) => (
            <option value={m.id}>
              {m.label}
              {m.placeholder ? ' (TODO)' : ''}
            </option>
          )}
        </For>
      </select>
      <span
        class={styles.description}
        classList={{ [styles.placeholder]: !!active().placeholder }}
      >
        {active().description}
      </span>
      <Show when={active().placeholder}>
        <span class={styles.placeholder} aria-hidden="true">
          ⚠
        </span>
      </Show>
    </div>
  );
};

export default ModeSwitcher;
