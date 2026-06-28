/**
 * Console — shared chrome for the simpler altitudes. Ported from `shared-ui.jsx`.
 *
 * AltitudeNav no longer navigates to separate HTML files (the JSX's href model);
 * the focus switch is driven by React state via `onFocus`. The altitude pills
 * (Console / Perform / Zen) are inert here — Manifold ships a single altitude.
 */
import type { CSSProperties } from 'react';
import type { Focus } from './types';
import type { MFParam } from './model';

const FOCI: [Focus, string, string][] = [
  ['in', 'IN', 'Input-first'],
  ['split', 'DUAL', 'Input + output equal'],
  ['out', 'OUT', 'Output-first'],
  ['composite', 'FLEX', 'Composite — drag to rebalance'],
];

export interface AltitudeNavProps {
  current?: string;
  focus?: Focus;
  onFocus?: (f: Focus) => void;
  style?: CSSProperties;
}

export function AltitudeNav({ current = 'console', focus = 'in', onFocus, style }: AltitudeNavProps) {
  const items = [
    { id: 'console', dots: '◆◆◆', label: 'Console' },
    { id: 'perform', dots: '◆◆', label: 'Perform' },
    { id: 'zen', dots: '◆', label: 'Zen' },
  ];
  const pill = (on: boolean): CSSProperties => ({
    textDecoration: 'none',
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 'var(--r-pill)',
    color: on ? 'var(--accent)' : 'var(--fg-dim)',
    background: on ? 'rgba(255,106,0,0.14)' : 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
  });
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 14,
        zIndex: 70,
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        background: 'var(--glass)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid var(--glass-line)',
        borderRadius: 'var(--r-pill)',
        padding: '4px 6px',
        ...style,
      }}
    >
      {items.map((it) => (
        <span key={it.id} title={`${it.label} · ${focus}`} style={pill(it.id === current)}>
          {it.dots}
        </span>
      ))}
      <span style={{ width: 1, height: 16, background: 'var(--glass-line)' }} />
      {FOCI.map(([f, label, title]) => (
        <button
          key={f}
          type="button"
          title={title}
          onClick={() => onFocus?.(f)}
          style={{ ...pill(focus === f), fontSize: 9, letterSpacing: '0.08em' }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const MM_GROUP_COLOR: Record<string, string> = {
  formant: '--accent',
  pitch: '--accent-2',
  amp: '--good',
  filter: '--warn',
  fx: '--info',
  mod: '--accent-3',
};

/** MiniMeters — glanceable read-only output bars (no interaction). */
export function MiniMeters({ params, values }: { params: MFParam[]; values: number[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 40 }}>
      {values.map((v, i) => (
        <div
          key={i}
          title={`${params[i]?.name}: ${v.toFixed(2)}`}
          style={{
            width: 5,
            height: '100%',
            background: 'var(--bg-2)',
            borderRadius: 1,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: `${v * 100}%`,
              background: `var(${MM_GROUP_COLOR[params[i]?.group] || '--accent'})`,
              opacity: 0.3 + v * 0.6,
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** CompactAxis — slim labelled feel slider (Perform bar; kept for parity). */
export function CompactAxis({
  label,
  value,
  onChange,
  accent = 'var(--accent)',
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  accent?: string;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-2)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <span
        style={{
          width: 64,
          fontSize: 10,
          color: 'var(--fg-mute)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {label}
      </span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mf-slider-input"
        style={{ width: 120, ['--mf-axis-accent' as string]: accent } as CSSProperties}
      />
      <span
        style={{
          width: '3ch',
          fontSize: 10,
          color: 'var(--fg-dim)',
          fontVariantNumeric: 'tabular-nums',
          textAlign: 'right',
        }}
      >
        {value.toFixed(2)}
      </span>
    </label>
  );
}
