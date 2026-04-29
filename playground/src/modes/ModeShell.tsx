/**
 * ModeShell — common scaffolding shared by every concrete mode.
 *
 * Provides:
 *   - Header (mode name, voice space pill, audio start/stop, drawer button).
 *   - Primary input area (mode-supplied) + JoyMap navigator on its right.
 *   - Output area (mode-supplied).
 *   - Control axes bar (Boldness/Memory/Precision wired to controlStore).
 *   - Training controls — undo, A/B, region/param pin all wired through.
 *   - SettingsDrawer (collapsible sections, per-param overrides, advanced).
 *
 * Modes only have to author the primary input + output JSX. Everything
 * else is owned here so behaviour stays consistent across modes.
 */

import { Component, createSignal, JSX, Show, For, createMemo } from 'solid-js';
import { TrainingControls } from '../primitives/TrainingControls';
import { ControlAxis } from '../primitives/ControlAxis';
import { PillToggle } from '../primitives/PillToggle';
import { Drawer } from '../primitives/Drawer';
import { JoyMap } from '../primitives/JoyMap';
import { controlStore } from '../stores/control-store';
import { inputStore } from '../stores/input-store';
import { sessionStore } from '../stores/session-store';
import { explorationStore } from '../stores/exploration-store';
import type { ModeRuntime } from './mode-runtime';
import type { ModeSchema } from './generated';
import { SettingsDrawer } from './SettingsDrawer';
import styles from './ModeShell.module.css';

export interface ModeShellProps {
  schema: ModeSchema;
  runtime: ModeRuntime;
  /** Primary input renderer (joystick / xy-pad / etc.). */
  primaryInput: () => JSX.Element;
  /** Output / visualisation area. */
  outputArea: () => JSX.Element;
  /** Optional drawer body for mode-specific settings (replaces default). */
  drawerContent?: () => JSX.Element;
  drawerTitle?: string;
  /** Active voice space index (only used if schema.voice_spaces is non-empty). */
  activeVoiceSpace?: () => number;
  onVoiceSpaceChange?: (idx: number) => void;
}

export const ModeShell: Component<ModeShellProps> = (props) => {
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [snapshotPopupOpen, setSnapshotPopupOpen] = createSignal(false);
  const showVoiceSpaces = () =>
    props.schema.ui.show_voice_space_selector && props.schema.voice_spaces.length > 0;

  const voiceSpaceOptions = () =>
    props.schema.voice_spaces.map((label, idx) => ({
      value: String(idx),
      label,
    }));

  const noiseRings = createMemo(() => {
    // Outer = noiseCap, inner = noiseLevel — both as fractions of half-window.
    const cap = explorationStore.state.noiseCap;
    const cur = explorationStore.state.noiseLevel;
    if (cap <= 0) return null;
    return [cap * 0.4, cur * 0.4] as const;
  });

  return (
    <section class={styles.shell} aria-label={`${props.schema.mode_id} mode`}>
      <header class={styles.header}>
        <div>
          <h2 class={styles.title}>{formatModeName(props.schema.mode_id)}</h2>
          <p class={styles.subtitle}>
            {props.schema.ml.input_size} in → {props.schema.ml.output_size} out
            {' · '}
            engine: <code>{props.schema.engine_id}</code>
          </p>
        </div>

        <Show when={showVoiceSpaces()}>
          <div class={styles.voiceSpaces}>
            <span class={styles.voiceSpacesLabel}>Voice space</span>
            <PillToggle
              options={voiceSpaceOptions()}
              value={() => String(props.activeVoiceSpace?.() ?? 0)}
              onChange={(v) => props.onVoiceSpaceChange?.(Number(v))}
              ariaLabel="Voice space"
            />
          </div>
        </Show>

        <div class={styles.audioToggle}>
          <Show
            when={props.schema.ui.primary_input === 'audio_in'}
          >
            <Show
              when={props.runtime.mic.started()}
              fallback={
                <button
                  type="button"
                  class={styles.audioBtn}
                  onClick={() => void props.runtime.mic.start()}
                  aria-label="Enable microphone"
                >🎤 Mic</button>
              }
            >
              <button
                type="button"
                class={`${styles.audioBtn} ${styles.on}`}
                onClick={() => void props.runtime.mic.stop()}
                aria-label="Disable microphone"
              >🎤 Mic on</button>
            </Show>
          </Show>
          <Show
            when={props.runtime.audio.started()}
            fallback={
              <button
                type="button"
                class={styles.audioBtn}
                onClick={() => void props.runtime.audio.start()}
                aria-label="Start audio engine"
              >▶ Start audio</button>
            }
          >
            <button
              type="button"
              class={`${styles.audioBtn} ${styles.on}`}
              onClick={() => void props.runtime.audio.stop()}
              aria-label="Stop audio engine"
            >⏹ Stop audio</button>
          </Show>
          <button
            type="button"
            class={styles.drawerToggleBtn}
            onClick={() => setDrawerOpen(true)}
            aria-label="Open settings drawer"
          >⚙</button>
        </div>
      </header>

      <div class={styles.body}>
        <div class={styles.primaryArea}>
          {props.primaryInput()}
          <JoyMap
            size={150}
            zoom={() => inputStore.config.zoom}
            anchor={() => [
              inputStore.config.anchorMode === 'center' ? 0.5 : inputStore.config.anchorX,
              inputStore.config.anchorMode === 'center' ? 0.5 : inputStore.config.anchorY,
            ]}
            position={props.runtime.pipedInput}
            trail={props.runtime.trail}
            regionPins={() => sessionStore.state.regionPins}
            noiseRings={noiseRings as () => readonly [number, number] | null}
            frozen={props.runtime.frozen}
            onTrailTap={(p) => props.runtime.snapToTrail(p)}
            onLongPress={() => props.runtime.pinCurrentRegion()}
            ariaLabel="Joy map navigator"
          />
        </div>
        <div class={styles.outputArea}>{props.outputArea()}</div>
      </div>

      <div class={styles.controls}>
        <div class={styles.controlAxes}>
          <For each={AXES}>
            {(axis) => (
              <ControlAxis
                label={axis.label}
                endpoints={axis.endpoints}
                value={() => controlStore.state[axis.key]}
                onChange={(v) => controlStore.setAxis(axis.key, v)}
                preset={() => controlStore.state.presetId}
                onDoubleTap={() => controlStore.clearOffsets(axis.key)}
              />
            )}
          </For>
        </div>
        <div class={styles.trainingPanel}>
          <TrainingControls
            onTrain={() => props.runtime.trainOnCurrent()}
            onRandomize={() => props.runtime.randomize()}
            onThumbsUp={() => props.runtime.thumbsUp()}
            onThumbsDown={() => props.runtime.thumbsDown()}
            onUndo={() => {
              // Click = pop one snapshot. Long-press = open list popup.
              props.runtime.undo();
            }}
            exampleCount={() => props.runtime.training.examples()}
            lastLoss={() => props.runtime.training.lastLoss()}
            busy={() => props.runtime.training.busy()}
            canUndo={() => props.runtime.canUndo()}
          />
          <Show when={sessionStore.state.snapshots.length > 0}>
            <button
              type="button"
              class={styles.drawerToggleBtn}
              onClick={() => setSnapshotPopupOpen((b) => !b)}
              aria-label="Show snapshot history"
              title={`History (${sessionStore.state.snapshots.length})`}
              style={{ 'margin-top': 'var(--sp-1)' }}
            >📚 {sessionStore.state.snapshots.length}</button>
          </Show>
        </div>
      </div>

      <p class={styles.statusLine}>
        <Show when={!props.runtime.ready()}>
          <span class={styles.notReady}>Loading WASM ML…</span>{' '}
        </Show>
        <Show when={props.runtime.frozen()}>
          <span class={styles.frozen}>frozen</span>{' '}
        </Show>
        <span>
          input ({props.runtime.pipedInput()[0].toFixed(2)},
          {' '}
          {props.runtime.pipedInput()[1].toFixed(2)})
          {' · '}
          noise {explorationStore.state.noiseLevel.toFixed(3)}
        </span>
      </p>

      <Drawer
        open={drawerOpen()}
        onClose={() => setDrawerOpen(false)}
        side="right"
        title={props.drawerTitle ?? 'Mode settings'}
        width={460}
      >
        <Show
          when={props.drawerContent}
          fallback={
            <SettingsDrawer schema={props.schema} runtime={props.runtime} />
          }
        >
          {props.drawerContent!()}
        </Show>
      </Drawer>

      {/* Snapshot list popup (long-press undo equivalent) */}
      <Drawer
        open={snapshotPopupOpen()}
        onClose={() => setSnapshotPopupOpen(false)}
        side="right"
        title="Snapshot history"
        width={320}
      >
        <ul style={{ 'list-style': 'none', padding: 0, margin: 0, display: 'flex', 'flex-direction': 'column', gap: 'var(--sp-1)' }}>
          <For each={sessionStore.listSnapshots().slice().reverse()}>{(s) => (
            <li>
              <button
                type="button"
                onClick={() => {
                  const map = sessionStore.state.snapshots;
                  const idx = map.findIndex((m) => m.id === s.id);
                  if (idx < 0) return;
                  for (let i = map.length - 1; i > idx; i--) sessionStore.popSnapshot();
                  props.runtime.undo();
                  setSnapshotPopupOpen(false);
                }}
                style={{
                  display: 'flex',
                  'flex-direction': 'column',
                  width: '100%',
                  background: 'var(--bg-2)',
                  border: '1px solid var(--line)',
                  'border-radius': 'var(--r-1)',
                  padding: 'var(--sp-1) var(--sp-2)',
                  'text-align': 'left',
                  cursor: 'pointer',
                  color: 'var(--fg)',
                }}
              >
                <span style={{ 'font-family': 'var(--font-mono)', 'font-size': 'var(--fs-sm)' }}>{s.tag}</span>
                <span style={{ 'font-family': 'var(--font-mono)', 'font-size': 'var(--fs-xs)', color: 'var(--fg-mute)' }}>
                  noise {s.noiseLevel.toFixed(3)}
                  {s.zoomLevel !== null ? ` · zoom ${s.zoomLevel.toFixed(2)}` : ''}
                </span>
              </button>
            </li>
          )}</For>
        </ul>
      </Drawer>
    </section>
  );
};

const AXES = [
  { key: 'boldness' as const, label: 'Boldness', endpoints: ['Caution', 'Bold'] as const },
  { key: 'memory' as const, label: 'Memory', endpoints: ['Amnesia', 'Elephant'] as const },
  { key: 'precision' as const, label: 'Precision', endpoints: ['Raw', 'Precise'] as const },
];

function formatModeName(id: string): string {
  return id
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default ModeShell;
