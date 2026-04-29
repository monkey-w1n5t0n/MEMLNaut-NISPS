import { Component, For } from 'solid-js';
import styles from './PillToggle.module.css';

export interface PillToggleOption {
  value: string;
  label: string;
}

export interface PillToggleProps {
  options: ReadonlyArray<PillToggleOption>;
  value: () => string;
  onChange: (v: string) => void;
  /** Optional aria label for the group. */
  ariaLabel?: string;
  disabled?: boolean;
}

export const PillToggle: Component<PillToggleProps> = (props) => {
  return (
    <div
      class={styles.group}
      classList={{ [styles.disabled]: !!props.disabled }}
      role="radiogroup"
      aria-label={props.ariaLabel ?? 'segmented control'}
    >
      <For each={props.options}>{(opt) => (
        <button
          type="button"
          class={styles.pill}
          classList={{ [styles.active]: props.value() === opt.value }}
          role="radio"
          aria-checked={props.value() === opt.value}
          onClick={() => !props.disabled && props.onChange(opt.value)}
          disabled={props.disabled}
        >
          {opt.label}
        </button>
      )}</For>
    </div>
  );
};
