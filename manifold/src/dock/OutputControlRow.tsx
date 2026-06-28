/**
 * OutputControlRow — the shared per-output baseline control row (dock-spec §3.2).
 * Reused across the Routing, Synth and Visual drawers. Renders the FULL baseline:
 *
 *   name · M (mute) · S (solo/arm) · [off|fixed|live] · dual-range · curve · value
 *
 * Writes eagerly through `onChange` into the single shared MFParam store
 * (ConsoleApp owns it) — never a second data path (dock-spec §3.2, §8).
 */
import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { MFParam, ParamStatus } from '../console/model';
import { CurvePad } from '../console/CurvePad';

const STATE_META: { v: ParamStatus; label: string; color: string }[] = [
  { v: 'off', label: 'off', color: 'var(--fg-dim)' },
  { v: 'fixed', label: 'fixed', color: 'var(--accent-2)' },
  { v: 'live', label: 'live', color: 'var(--accent)' },
];

const GROUP_COLOR: Record<string, string> = {
  formant: '--accent',
  pitch: '--accent-2',
  amp: '--good',
  filter: '--warn',
  fx: '--info',
  mod: '--accent-3',
};

/** A compact dual-thumb min/max range (min blue, max orange — dock-spec §3.1). */
function DualRange({
  min,
  max,
  onMin,
  onMax,
}: {
  min: number;
  max: number;
  onMin: (v: number) => void;
  onMax: (v: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ which: 'min' | 'max' | null }>({ which: null });
  const valAt = (clientX: number) => {
    const el = track.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const v = valAt(e.clientX);
    drag.current.which = Math.abs(v - min) <= Math.abs(v - max) ? 'min' : 'max';
    apply(v);
  };
  const apply = (v: number) => {
    if (drag.current.which === 'min') onMin(Math.min(v, max));
    else if (drag.current.which === 'max') onMax(Math.max(v, min));
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current.which) apply(valAt(e.clientX));
  };
  const up = () => {
    drag.current.which = null;
  };
  return (
    <div
      ref={track}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      title={`range ${min.toFixed(2)}–${max.toFixed(2)}`}
      style={{
        position: 'relative',
        height: 16,
        flex: 1,
        minWidth: 60,
        background: 'var(--bg-1)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-pill)',
        cursor: 'ew-resize',
        touchAction: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${min * 100}%`,
          right: `${(1 - max) * 100}%`,
          background: 'linear-gradient(90deg, #4488ff, var(--accent))',
          opacity: 0.4,
          borderRadius: 'var(--r-pill)',
        }}
      />
      <Thumb pct={min} color="#4488ff" />
      <Thumb pct={max} color="var(--accent)" />
    </div>
  );
}

function Thumb({ pct, color }: { pct: number; color: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: `${pct * 100}%`,
        width: 10,
        height: 10,
        marginLeft: -5,
        marginTop: -5,
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 6px ${color}`,
      }}
    />
  );
}

function GlyphToggle({
  on,
  glyph,
  title,
  color,
  onClick,
}: {
  on: boolean;
  glyph: string;
  title: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        width: 22,
        height: 22,
        flex: '0 0 auto',
        borderRadius: 'var(--r-1)',
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        cursor: 'pointer',
        border: `1px solid ${on ? color : 'var(--line)'}`,
        background: on ? color : 'transparent',
        color: on ? 'var(--bg)' : 'var(--fg-dim)',
      }}
    >
      {glyph}
    </button>
  );
}

export interface OutputControlRowProps {
  param: MFParam;
  /** Live (computed) value for the value bar. */
  value: number;
  onChange: (patch: Partial<MFParam>) => void;
  /** Show the curve pad inline (expand depth); hidden in compact rows. */
  showCurve?: boolean;
}

export function OutputControlRow({ param, value, onChange, showCurve = false }: OutputControlRowProps) {
  const gc = `var(${GROUP_COLOR[param.group] || '--accent'})`;
  const muted = param.muted ?? false;
  const armed = param.armed ?? false;
  const off = param.status === 'off';
  const barVal = param.status === 'fixed' ? param.val : value;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        background: 'var(--bg-2)',
        border: `1px solid ${armed ? 'var(--accent)' : 'var(--line)'}`,
        boxShadow: armed ? '0 0 0 1px var(--glow-accent)' : 'none',
        borderRadius: 'var(--r-1)',
        padding: '5px 7px',
        opacity: off ? 0.6 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 'var(--fs-xs)',
            color: 'var(--fg)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {param.name}
        </span>
        <span style={{ fontSize: 9, color: 'var(--fg-dim)' }}>{param.group}</span>
        <GlyphToggle
          on={muted}
          glyph="M"
          title={muted ? 'Muted (silenced downstream, still computed)' : 'Mute downstream'}
          color="var(--danger)"
          onClick={() => onChange({ muted: !muted })}
        />
        <GlyphToggle
          on={armed}
          glyph="S"
          title={armed ? 'Armed — focus training on this output' : 'Solo / arm (focus training)'}
          color="var(--accent)"
          onClick={() => onChange({ armed: !armed })}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* tri-state segmented */}
        <div style={{ display: 'flex', gap: 1, flex: '0 0 auto' }}>
          {STATE_META.map((s) => {
            const on = param.status === s.v;
            return (
              <button
                key={s.v}
                type="button"
                onClick={() => onChange({ status: s.v })}
                style={{
                  fontSize: 9,
                  fontFamily: 'var(--font-mono)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  padding: '2px 5px',
                  cursor: 'pointer',
                  border: `1px solid ${on ? s.color : 'var(--line)'}`,
                  background: on ? s.color : 'transparent',
                  color: on ? 'var(--bg)' : 'var(--fg-dim)',
                  borderRadius: 'var(--r-1)',
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <DualRange
          min={param.min}
          max={param.max}
          onMin={(v) => onChange({ min: v })}
          onMax={(v) => onChange({ max: v })}
        />
      </div>

      {/* value bar (live model value, or held fixed value) */}
      <div
        style={{
          position: 'relative',
          height: 6,
          background: 'var(--bg-1)',
          borderRadius: 'var(--r-pill)',
          overflow: 'hidden',
        }}
        title={`value ${barVal.toFixed(3)}${muted ? ' (muted)' : ''}`}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${Math.max(0, Math.min(1, barVal)) * 100}%`,
            background: muted ? 'var(--fg-dim)' : gc,
            opacity: muted ? 0.4 : 0.8,
            transition: 'width 70ms linear',
          }}
        />
      </div>

      {param.status === 'fixed' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, color: 'var(--fg-mute)', textTransform: 'uppercase' }}>held</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={param.val}
            onChange={(e) => onChange({ val: parseFloat(e.target.value) })}
            className="mf-slider-input"
            style={{ flex: 1 }}
          />
        </label>
      )}

      {showCurve && (
        <div style={{ marginTop: 2 }}>
          <CurvePad curve={param.curve} onChange={(c) => onChange({ curve: c })} size={88} />
        </div>
      )}
    </div>
  );
}
