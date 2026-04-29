/**
 * ModeShell — common scaffolding shared by every concrete mode.
 *
 * Provides:
 *   - Header (mode name, optional voice-space PillToggle, audio start/stop).
 *   - Primary input area (joystick / xy-pad / audio analyser, mode-supplied).
 *   - Output area (sliders / output bars, mode-supplied).
 *   - Control axes bar (Boldness/Memory/Precision wired to controlStore).
 *   - Training controls (wired to the mode runtime).
 *   - Optional right-side drawer for mode-specific settings.
 *
 * Modes only have to author the primary input + output JSX. Everything
 * else is owned here so behaviour stays consistent across modes.
 */

import { Component, createSignal, JSX, Show, For } from 'solid-js';
import { TrainingControls } from '../primitives/TrainingControls';
import { ControlAxis } from '../primitives/ControlAxis';
import { PillToggle } from '../primitives/PillToggle';
import { Drawer } from '../primitives/Drawer';
import { controlStore } from '../stores/control-store';
import type { ModeRuntime } from './mode-runtime';
import type { ModeSchema } from './generated';
import styles from './ModeShell.module.css';

export interface ModeShellProps {
  schema: ModeSchema;
  runtime: ModeRuntime;
  /** Primary input renderer (joystick / xy-pad / etc.). */
  primaryInput: () => JSX.Element;
  /** Output / visualisation area. */
  outputArea: () => JSX.Element;
  /** Optional drawer body for mode-specific settings. */
  drawerContent?: () => JSX.Element;
  drawerTitle?: string;
  /** Active voice space index (only used if schema.voice_spaces is non-empty). */
  activeVoiceSpace?: () => number;
  onVoiceSpaceChange?: (idx: number) => void;
}

export const ModeShell: Component<ModeShellProps> = (props) => {
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const showVoiceSpaces = () =>
    props.schema.ui.show_voice_space_selector && props.schema.voice_spaces.length > 0;

  const voiceSpaceOptions = () =>
    props.schema.voice_spaces.map((label, idx) => ({
      value: String(idx),
      label,
    }));

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
            when={props.runtime.audio.started()}
            fallback={
              <button
                type="button"
                class={styles.audioBtn}
                onClick={() => void props.runtime.audio.start()}
                aria-label="Start audio engine"
              >
                ▶ Start audio
              </button>
            }
          >
            <button
              type="button"
              class={`${styles.audioBtn} ${styles.on}`}
              onClick={() => void props.runtime.audio.stop()}
              aria-label="Stop audio engine"
            >
              ⏹ Stop audio
            </button>
          </Show>
          <Show when={props.drawerContent}>
            <button
              type="button"
              class={styles.drawerToggleBtn}
              onClick={() => setDrawerOpen(true)}
              aria-label="Open settings drawer"
            >
              ⚙
            </button>
          </Show>
        </div>
      </header>

      <div class={styles.body}>
        <div class={styles.primaryArea}>{props.primaryInput()}</div>
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
              // Stream 9 ships without undo wiring — no-op until session-store
              // gets a snapshot/pop method exposed via the runtime. Stubbed
              // so the button still appears.
            }}
            exampleCount={() => props.runtime.training.examples()}
            lastLoss={() => props.runtime.training.lastLoss()}
            busy={() => props.runtime.training.busy()}
            canUndo={() => false}
          />
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
        </span>
      </p>

      <Show when={props.drawerContent}>
        <Drawer
          open={drawerOpen()}
          onClose={() => setDrawerOpen(false)}
          side="right"
          title={props.drawerTitle ?? 'Mode settings'}
          width={420}
        >
          {props.drawerContent!()}
        </Drawer>
      </Show>
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
