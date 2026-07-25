/**
 * OutputControlRow — the shared per-output baseline control row (dock-spec §3.2).
 * Reused across the Routing, Synth and Visual drawers. Renders the FULL baseline:
 *
 *   editable name · M (mute) · S (solo/arm) · cycling status · dual-range · curve · value
 *
 * Writes eagerly through `onChange` into the single shared MFParam store
 * (ConsoleApp owns it) — never a second data path (dock-spec §3.2, §8).
 */
import type { CSSProperties } from 'react';
import { GROUP_COLOR } from '../console/model';
import type { MFParam, ParamStatus } from '../console/model';
import { CurvePad } from '../console/CurvePad';
import { DualRange } from '../console/DualRange';
import { defaultMidiSpec } from './output-state';

const STATE_META: { v: ParamStatus; label: string; color: string }[] = [
  { v: 'off', label: 'off', color: 'var(--fg-dim)' },
  { v: 'fixed', label: 'fixed', color: 'var(--accent-2)' },
  { v: 'live', label: 'live', color: 'var(--accent)' },
];

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
  /** Remove this semantic output from the active card set. */
  onDelete?: () => void;
  /** Show the curve pad inline (expand depth); hidden in compact rows. */
  showCurve?: boolean;
  /** Show the per-card MIDI CC and channel controls. */
  showMidi?: boolean;
}

export function OutputControlRow({
  param,
  value,
  onChange,
  onDelete,
  showCurve = false,
  showMidi = false,
}: OutputControlRowProps) {
  const gc = `var(${GROUP_COLOR[param.group] || '--accent'})`;
  const muted = param.muted ?? false;
  const armed = param.armed ?? false;
  const off = param.status === 'off';
  const barVal = param.status === 'fixed' ? param.min + param.val * (param.max - param.min) : value;
  const midi = param.midi ?? defaultMidiSpec(param.engineIndex ?? 0);
  const stateIndex = Math.max(0, STATE_META.findIndex((s) => s.v === param.status));
  const state = STATE_META[stateIndex];
  const nextState = STATE_META[(stateIndex + 1) % STATE_META.length];
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'var(--bg-2)',
        border: `1px solid ${armed ? 'var(--accent)' : 'var(--line)'}`,
        boxShadow: armed ? '0 0 0 1px var(--glow-accent)' : 'none',
        borderRadius: 'var(--r-1)',
        padding: '8px 10px',
        opacity: off ? 0.6 : 1,
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            aria-label={`Output name for ${param.name}`}
            value={param.name}
            onChange={(e) =>
              onChange({
                name: e.target.value,
                ...(showMidi ? { midi: { ...midi, name: e.target.value } } : {}),
              })
            }
            style={{
              flex: 1,
              minWidth: 0,
              width: 0,
              border: 0,
              borderBottom: '1px solid var(--line)',
              background: 'transparent',
              color: 'var(--fg)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-xs)',
              padding: '1px 0',
            }}
          />
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

        {showMidi && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--fg-mute)' }}>
              CC
              <input
                aria-label={`MIDI CC for ${param.name}`}
                type="number"
                min={0}
                max={127}
                value={midi.cc}
                onChange={(e) =>
                  onChange({ midi: { ...midi, cc: Math.max(0, Math.min(127, Number(e.target.value) || 0)) } })
                }
                style={{ width: 54, background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 'var(--r-1)', color: 'var(--fg)', fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 4px' }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--fg-mute)' }}>
              ch
              <input
                aria-label={`MIDI channel for ${param.name}`}
                type="number"
                min={1}
                max={16}
                value={midi.channel}
                onChange={(e) =>
                  onChange({ midi: { ...midi, channel: Math.max(1, Math.min(16, Number(e.target.value) || 1)) } })
                }
                style={{ width: 44, background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 'var(--r-1)', color: 'var(--fg)', fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 4px' }}
              />
            </label>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            title={`Status: ${state.label} · click for ${nextState.label}`}
            onClick={() => onChange({ status: nextState.v })}
            style={{
              minWidth: 52,
              fontSize: 9,
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              padding: '3px 6px',
              cursor: 'pointer',
              border: `1px solid ${state.color}`,
              background: state.color,
              color: 'var(--bg)',
              borderRadius: 'var(--r-1)',
            }}
          >
            {state.label}
          </button>
          <DualRange
            min={param.min}
            max={param.max}
            onMin={(v) => onChange({ min: v })}
            onMax={(v) => onChange({ max: v })}
          />
        </div>

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
              style={{ flex: 1, ['--mf-pct' as string]: `${Math.max(0, Math.min(1, param.val))}` } as CSSProperties}
            />
          </label>
        )}
      </div>

      {showCurve && (
        <div style={{ flex: '0 0 88px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CurvePad curve={param.curve} onChange={(c) => onChange({ curve: c })} size={88} />
        </div>
      )}

      {onDelete && (
        <button
          type="button"
          aria-label={`Delete ${param.name} output`}
          title={`Delete ${param.name} output`}
          onClick={onDelete}
          style={{
            position: 'absolute',
            top: -7,
            right: -7,
            zIndex: 2,
            width: 22,
            height: 22,
            borderRadius: '50%',
            border: '1px solid var(--danger)',
            background: 'var(--bg-2)',
            color: 'var(--danger)',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
