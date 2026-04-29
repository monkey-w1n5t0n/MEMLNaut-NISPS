import { Component, Show } from 'solid-js';
import styles from './TrainingControls.module.css';

export interface TrainingControlsProps {
  onTrain: () => void;
  onRandomize: () => void;
  onThumbsUp: () => void;
  onThumbsDown: () => void;
  onUndo: () => void;
  exampleCount: () => number;
  lastLoss: () => number | null;
  /** Whether training is currently in progress (disables actions). */
  busy?: () => boolean;
  /** Whether undo stack is non-empty. */
  canUndo?: () => boolean;
}

export const TrainingControls: Component<TrainingControlsProps> = (props) => {
  const busy = () => props.busy?.() ?? false;
  const canUndo = () => props.canUndo?.() ?? true;

  return (
    <div class={styles.wrap} role="toolbar" aria-label="Training controls">
      <div class={styles.row}>
        <button
          type="button"
          class={`${styles.btn} ${styles.thumbsDown}`}
          onClick={props.onThumbsDown}
          disabled={busy()}
          aria-label="Thumbs down (explore)"
          title="Thumbs down — explore (key: 2)"
        >−</button>
        <button
          type="button"
          class={`${styles.btn} ${styles.thumbsUp}`}
          onClick={props.onThumbsUp}
          disabled={busy()}
          aria-label="Thumbs up (train)"
          title="Thumbs up — train (key: 1)"
        >+</button>
        <button
          type="button"
          class={`${styles.btn} ${styles.undo}`}
          onClick={props.onUndo}
          disabled={busy() || !canUndo()}
          aria-label="Undo"
          title="Undo (key: Z)"
        >↶</button>
      </div>
      <div class={styles.row}>
        <button
          type="button"
          class={styles.btnAlt}
          onClick={props.onTrain}
          disabled={busy()}
        >Train</button>
        <button
          type="button"
          class={styles.btnAlt}
          onClick={props.onRandomize}
          disabled={busy()}
        >Randomise</button>
      </div>
      <div class={styles.status}>
        <span class={styles.statusItem}>
          <span class={styles.statusLabel}>examples</span>
          <span class={styles.statusValue}>{props.exampleCount()}</span>
        </span>
        <Show when={props.lastLoss() !== null}>
          <span class={styles.statusItem}>
            <span class={styles.statusLabel}>loss</span>
            <span class={styles.statusValue}>{props.lastLoss()!.toExponential(2)}</span>
          </span>
        </Show>
        <Show when={busy()}>
          <span class={`${styles.statusItem} ${styles.busy}`}>training…</span>
        </Show>
      </div>
    </div>
  );
};
