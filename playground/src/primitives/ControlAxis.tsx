import { Component, Show } from 'solid-js';
import styles from './ControlAxis.module.css';

export interface ControlAxisProps {
  label: string;
  value: () => number;
  onChange: (v: number) => void;
  /** Active control preset id (rendered as subtitle when set). */
  preset?: () => string | null;
  /** Endpoint labels (left, right). E.g. ['Caution', 'Bold']. */
  endpoints?: readonly [string, string];
  /** Called when user double-taps the axis (re-link offsets). */
  onDoubleTap?: () => void;
  /** Disabled state. */
  disabled?: boolean;
  /** Visual color hint (defaults to --accent). */
  accentColor?: string;
}

export const ControlAxis: Component<ControlAxisProps> = (props) => {
  let lastTap = 0;

  const onPointerDown = () => {
    const now = performance.now();
    if (now - lastTap < 350 && props.onDoubleTap) {
      props.onDoubleTap();
      lastTap = 0;
    } else {
      lastTap = now;
    }
  };

  const onInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
    const v = parseFloat(e.currentTarget.value);
    if (!Number.isNaN(v)) props.onChange(Math.max(0, Math.min(1, v)));
  };

  const accent = () => props.accentColor ?? 'var(--accent)';

  return (
    <div
      class={styles.axis}
      classList={{ [styles.disabled]: !!props.disabled }}
      style={{ '--axis-accent': accent() }}
    >
      <div class={styles.head}>
        <span class={styles.label}>{props.label}</span>
        <Show when={props.preset?.()}>
          <span class={styles.preset}>{props.preset!()}</span>
        </Show>
        <span class={styles.value}>{props.value().toFixed(2)}</span>
      </div>
      <input
        class={styles.input}
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={props.value()}
        onInput={onInput}
        onPointerDown={onPointerDown}
        disabled={props.disabled}
        aria-label={`${props.label} control axis`}
      />
      <Show when={props.endpoints}>
        <div class={styles.endpoints}>
          <span>{props.endpoints![0]}</span>
          <span>{props.endpoints![1]}</span>
        </div>
      </Show>
    </div>
  );
};
