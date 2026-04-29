import { Component, createMemo, Show } from 'solid-js';
import { applyCurve, type CurveName } from '../output/curves';
import styles from './Slider.module.css';

export interface SliderProps {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  /**
   * If set, the slider position is normalised to [0,1], passed through the
   * named curve, then mapped to [min, max]. Setter receives the **mapped**
   * value. Reading `value` is also expected in the mapped range.
   */
  curve?: CurveName;
  curveParam?: number;
  label?: string;
  unit?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /** Optional precision for display (decimals). */
  decimals?: number;
}

export const Slider: Component<SliderProps> = (props) => {
  const min = () => props.min;
  const max = () => props.max;
  const step = () => props.step ?? (max() - min()) / 100;
  const curve = () => props.curve ?? 'linear';
  const curveParam = () => props.curveParam;

  // Display value can use a smaller step granularity than the slider itself.
  const display = createMemo(() => {
    const v = props.value;
    const d = props.decimals;
    if (d === undefined) {
      const range = max() - min();
      const decimals = range >= 100 ? 0 : range >= 10 ? 1 : range >= 1 ? 2 : 3;
      return v.toFixed(decimals);
    }
    return v.toFixed(d);
  });

  // Slider input is always [0,1] for curve mapping, mapped to [min,max].
  const sliderPos = createMemo(() => {
    const range = max() - min();
    if (range <= 0) return 0;
    const norm = (props.value - min()) / range;
    if (curve() === 'linear') return norm;
    // Inverse: we don't have inverse for all curves. For linear we round-trip
    // exactly; for others we accept that the slider position is a *forward*
    // mapping (snaps to nearest). Use raw normalised position for simplicity.
    return norm;
  });

  const handleInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
    const norm = parseFloat(e.currentTarget.value);
    let value: number;
    if (curve() === 'linear') {
      value = min() + norm * (max() - min());
    } else {
      const curved = applyCurve(curve(), norm, curveParam());
      value = min() + curved * (max() - min());
    }
    props.onChange(value);
  };

  return (
    <label class={styles.wrap} classList={{ [styles.disabled]: !!props.disabled }}>
      <Show when={props.label}>
        <span class={styles.label}>{props.label}</span>
      </Show>
      <div class={styles.row}>
        <input
          class={styles.input}
          type="range"
          min={0}
          max={1}
          step={step() / Math.max(0.000001, max() - min())}
          value={sliderPos()}
          onInput={handleInput}
          disabled={props.disabled}
          aria-label={props.ariaLabel ?? props.label ?? 'slider'}
        />
        <span class={styles.value}>
          {display()}{props.unit ? <span class={styles.unit}>{props.unit}</span> : null}
        </span>
      </div>
    </label>
  );
};
