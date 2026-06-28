import type { CSSProperties, ReactNode } from 'react';

export interface ControlAxisProps {
  label?: ReactNode;
  /** Bipolar endpoint labels, e.g. ['Caution', 'Bold']. */
  endpoints?: [ReactNode, ReactNode];
  value?: number;
  onChange?: (value: number) => void;
  /** Live preset tag shown next to the label. */
  preset?: ReactNode;
  /** Per-axis track/thumb accent colour (any CSS colour or var()). */
  accent?: string;
  disabled?: boolean;
  style?: CSSProperties;
}

/**
 * Manifold ControlAxis — a named macro slider with bipolar endpoint labels
 * (e.g. Boldness: Caution ↔ Bold). Shows a live preset tag and value. The
 * track accent can be themed per-axis via `accent`.
 *
 * Relies on the `.mf-axis-input` rules in `styles/primitives.css`; the accent
 * is passed via the inline `--mf-axis-accent` custom property.
 */
export function ControlAxis({
  label,
  endpoints = ['', ''],
  value = 0.5,
  onChange,
  preset,
  accent = 'var(--accent)',
  disabled = false,
  style,
}: ControlAxisProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sp-1)',
        background: 'var(--bg-1)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-2)',
        padding: 'var(--sp-2) var(--sp-3)',
        fontFamily: 'var(--font-mono)',
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-2)',
          fontSize: 'var(--fs-sm)',
        }}
      >
        <span
          style={{
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--fg)',
            flex: 1,
          }}
        >
          {label}
        </span>
        {preset && (
          <span
            style={{
              color: accent,
              fontSize: 'var(--fs-xs)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            {preset}
          </span>
        )}
        <span
          style={{
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--fg-mute)',
            fontSize: 'var(--fs-xs)',
            minWidth: '4ch',
            textAlign: 'right',
          }}
        >
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange?.(parseFloat(e.target.value))}
        className="mf-axis-input"
        style={
          {
            WebkitAppearance: 'none',
            appearance: 'none',
            width: '100%',
            height: 24,
            background: 'transparent',
            margin: 0,
            cursor: 'pointer',
            '--mf-axis-accent': accent,
          } as CSSProperties
        }
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--fg-dim)',
        }}
      >
        <span>{endpoints[0]}</span>
        <span>{endpoints[1]}</span>
      </div>
    </div>
  );
}
