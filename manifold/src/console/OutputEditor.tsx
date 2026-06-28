/**
 * OutputEditor — the per-output menu (state · min · max · static value · curve).
 * Opens on hover over an output column/cell. Ported from `OutputEditor.jsx`.
 */
import type { CSSProperties, ReactNode } from 'react';
import { CurvePad } from './CurvePad';
import type { MFParam, ParamStatus } from './model';

const OE_STATUS: { v: ParamStatus; label: string; color: string }[] = [
  { v: 'off', label: 'Off', color: 'var(--fg-dim)' },
  { v: 'fixed', label: 'Fixed', color: 'var(--accent-2)' },
  { v: 'live', label: 'Live', color: 'var(--accent)' },
];

function MiniSlider({
  label,
  value,
  onChange,
  disabled,
}: {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, opacity: disabled ? 0.4 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: 10,
            color: 'var(--fg-mute)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {label}
        </span>
        <span
          style={{ fontSize: 10, color: 'var(--fg-dim)', fontVariantNumeric: 'tabular-nums' }}
        >
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mf-slider-input"
        style={{ width: '100%', ['--mf-pct' as string]: `${Math.max(0, Math.min(1, value))}` } as CSSProperties}
      />
    </label>
  );
}

export interface OutputEditorProps {
  param: MFParam;
  onChange: (patch: Partial<MFParam>) => void;
  onHold: () => void;
  onLeave: () => void;
  place: CSSProperties;
}

export function OutputEditor({ param, onChange, onHold, onLeave, place }: OutputEditorProps) {
  const isLive = param.status === 'live';
  return (
    <div
      onPointerEnter={onHold}
      onPointerLeave={onLeave}
      style={{
        position: 'absolute',
        width: 196,
        zIndex: 80,
        ...place,
        background: 'var(--glass)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        border: '1px solid var(--glass-line)',
        borderRadius: 'var(--r-2)',
        boxShadow: 'var(--shadow-2)',
        padding: 'var(--sp-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sp-2)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg)' }}>{param.name}</strong>
        <span style={{ fontSize: 10, color: 'var(--fg-dim)' }}>{param.group}</span>
      </div>

      <div
        style={{
          display: 'flex',
          background: 'var(--bg-2)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-pill)',
          padding: 2,
          gap: 2,
        }}
      >
        {OE_STATUS.map((s) => {
          const on = param.status === s.v;
          return (
            <button
              key={s.v}
              type="button"
              onClick={() => onChange({ status: s.v })}
              style={{
                flex: 1,
                border: 0,
                borderRadius: 'var(--r-pill)',
                padding: '4px 0',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                background: on ? s.color : 'transparent',
                color: on ? 'var(--bg)' : 'var(--fg-mute)',
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      <MiniSlider label="min" value={param.min} onChange={(v) => onChange({ min: v })} />
      <MiniSlider label="max" value={param.max} onChange={(v) => onChange({ max: v })} />
      <MiniSlider
        label={isLive ? 'value · live' : 'value · static'}
        value={param.val}
        onChange={(v) => onChange({ val: v })}
        disabled={isLive}
      />
      <CurvePad curve={param.curve} onChange={(c) => onChange({ curve: c })} size={170} />
      <span style={{ fontSize: 9, color: 'var(--fg-dim)', lineHeight: 1.4 }}>
        drag a bar to set value · ⌥/alt-click cycles state
      </span>
    </div>
  );
}
