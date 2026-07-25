/**
 * OutputControlRow — the shared per-output baseline control row (dock-spec §3.2).
 * Reused across the Routing, Synth and Visual drawers. Renders the FULL baseline:
 *
 *   name · M (mute) · S (solo/arm) · [off|fixed|live] · dual-range · curve · value
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
  /** Show the per-card MIDI name, CC, and channel controls. */
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
  const barVal = param.status === 'fixed' ? param.val : value;
  const midi = param.midi ?? defaultMidiSpec(param.engineIndex ?? 0);
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
        {showMidi ? (
          <input
            aria-label={`MIDI name for ${param.name}`}
            value={midi.name}
            onChange={(e) => onChange({ midi: { ...midi, name: e.target.value } })}
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
        ) : (
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
        )}
        <span style={{ fontSize: 9, color: 'var(--fg-dim)' }}>{param.group}</span>
        {onDelete && (
          <button
            type="button"
            aria-label={`Delete ${param.name} output`}
            title={`Delete ${param.name} output`}
            onClick={onDelete}
            style={{
              width: 22,
              height: 22,
              borderRadius: 'var(--r-1)',
              border: '1px solid var(--line)',
              background: 'transparent',
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
              style={{
                width: 54,
                background: 'var(--bg-1)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-1)',
                color: 'var(--fg)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                padding: '2px 4px',
              }}
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
                onChange({
                  midi: { ...midi, channel: Math.max(1, Math.min(16, Number(e.target.value) || 1)) },
                })
              }
              style={{
                width: 44,
                background: 'var(--bg-1)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-1)',
                color: 'var(--fg)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                padding: '2px 4px',
              }}
            />
          </label>
        </div>
      )}

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
            style={{ flex: 1, ['--mf-pct' as string]: `${Math.max(0, Math.min(1, param.val))}` } as CSSProperties}
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
