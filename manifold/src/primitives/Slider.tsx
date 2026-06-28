import type { CSSProperties } from 'react';

export interface SliderProps {
  label?: string;
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onChange?: (value: number) => void;
  disabled?: boolean;
  /** Custom formatter for the value readout. */
  format?: (value: number) => string;
  style?: CSSProperties;
}

/**
 * Manifold Slider — labeled horizontal range with a glowing orange thumb and
 * a tabular value readout. Controlled via value/onChange (0..max).
 *
 * Relies on the `.mf-slider-input` rules in `styles/primitives.css` for the
 * track gradient and glowing thumb. The fill percentage is passed via the
 * inline `--mf-pct` custom property.
 */
export function Slider({
  label,
  value = 0,
  min = 0,
  max = 1,
  step = 0.01,
  unit = '',
  onChange,
  disabled = false,
  format,
  style,
}: SliderProps) {
  const pct = max > min ? (value - min) / (max - min) : 0;
  const display = format
    ? format(value)
    : Number.isInteger(step)
      ? String(value)
      : value.toFixed(2);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sp-1)',
        fontFamily: 'var(--font-mono)',
        userSelect: 'none',
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
        ...style,
      }}
    >
      {label && (
        <span
          style={{
            color: 'var(--fg-mute)',
            fontSize: 'var(--fs-xs)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {label}
        </span>
      )}
      <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange?.(parseFloat(e.target.value))}
          className="mf-slider-input"
          style={
            {
              flex: 1,
              WebkitAppearance: 'none',
              appearance: 'none',
              background: 'transparent',
              height: 24,
              margin: 0,
              cursor: 'pointer',
              '--mf-pct': `${pct}`,
            } as CSSProperties
          }
        />
        <span
          style={{
            fontVariantNumeric: 'tabular-nums',
            fontSize: 'var(--fs-xs)',
            color: 'var(--fg-mute)',
            minWidth: '4ch',
            textAlign: 'right',
          }}
        >
          {display}
          {unit && <span style={{ color: 'var(--fg-dim)', marginLeft: 2 }}>{unit}</span>}
        </span>
      </div>
    </div>
  );
}
