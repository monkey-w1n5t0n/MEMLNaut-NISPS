/**
 * SequencerDrawer — the dock's Sequencer menu.
 *
 * The sequencer is played by a second MLP engine (right stick / this drawer's
 * pad-less controls); this drawer holds the fixed "musician" settings — scale,
 * root, steps, octave range/offset, tempo, gate — plus the generator choice,
 * the synth preset, a live view of what the sequencer's MLP is outputting, and
 * like / push-away buttons for teaching it.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Slider } from '../primitives';
import { GENERATORS, SCALES, type GeneratorId } from '../sequencer';
import { listPresets } from '../synth/preset-model';
import { PSYNTH_MODE_PREFIX } from './model';
import type { ConsoleCtx, DrawerDepth } from './types';

const GENERATOR_IDS: GeneratorId[] = ['euclid-turing', 'walker', 'steps'];
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

const label = (children: ReactNode) => (
  <div
    style={{
      fontSize: 10,
      color: 'var(--fg-dim)',
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      marginTop: 'var(--sp-2)',
    }}
  >
    {children}
  </div>
);

const selectStyle = {
  background: 'var(--bg-2)',
  color: 'var(--fg)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-1)',
  padding: '4px 8px',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-xs)',
} as const;

export function noteName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Live bars for the sequencer MLP's outputs, labelled by the generator's slots. */
function SlotBars({ ctx }: { ctx: ConsoleCtx }) {
  const rig = ctx.rig;
  const generator = ctx.rigState?.settings.generator ?? 'euclid-turing';
  const slots = GENERATORS[generator].slots;
  const [values, setValues] = useState<number[]>([]);

  useEffect(() => {
    if (!rig) return;
    const id = window.setInterval(() => {
      const v = rig.slotValues();
      if (v) setValues(Array.from(v.subarray(0, slots.length)));
    }, 80);
    return () => window.clearInterval(id);
  }, [rig, slots.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {slots.map((slot, i) => (
        <div key={slot.id} title={slot.hint} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 92, fontSize: 'var(--fs-xs)', color: 'var(--fg-mute)' }}>{slot.label}</span>
          <div style={{ flex: 1, height: 6, background: 'var(--bg-2)', borderRadius: 3 }}>
            <div
              style={{
                width: `${Math.round((values[i] ?? 0) * 100)}%`,
                height: '100%',
                background: 'var(--accent-2)',
                borderRadius: 3,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SequencerDrawer({ ctx }: { ctx: ConsoleCtx; depth: DrawerDepth }) {
  const rig = ctx.rig;
  const rs = ctx.rigState;
  if (!rig || !rs) {
    return <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-mute)' }}>Sequencer unavailable.</div>;
  }
  const s = rs.settings;
  const generator = GENERATORS[s.generator];
  const activePreset = ctx.modeId.startsWith(PSYNTH_MODE_PREFIX)
    ? ctx.modeId.slice(PSYNTH_MODE_PREFIX.length)
    : '';

  return (
    <>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button size="sm" variant={rs.active ? 'secondary' : 'primary'} onClick={() => rig.setActive(!rs.active)}>
          {rs.active ? 'dual mode on' : 'enable dual mode'}
        </Button>
        <Button
          size="sm"
          variant={rs.audioRunning ? 'secondary' : 'primary'}
          onClick={() => void (rs.audioRunning ? rig.stopAudio() : rig.startAudio())}
        >
          {rs.audioRunning ? 'pause' : 'play'}
        </Button>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)' }}>
          {rs.active ? 'Left stick: synth · Right stick: sequencer' : 'Connect a gamepad to switch on automatically'}
        </span>
      </div>

      {label('Synth preset')}
      <select
        style={selectStyle}
        value={activePreset}
        onChange={(e) => ctx.setModeId(PSYNTH_MODE_PREFIX + e.target.value)}
      >
        <option value="" disabled>
          choose…
        </option>
        {listPresets().map((g) => (
          <optgroup key={g.tier} label={g.label}>
            {g.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.description}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {label('Melody maker')}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {GENERATOR_IDS.map((id) => (
          <Button
            key={id}
            size="sm"
            variant={s.generator === id ? 'primary' : 'secondary'}
            onClick={() => rig.updateSettings({ generator: id })}
          >
            {GENERATORS[id].label}
          </Button>
        ))}
      </div>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-mute)' }}>{generator.blurb}</div>

      {label('Scale')}
      <div style={{ display: 'flex', gap: 6 }}>
        <select
          style={selectStyle}
          value={s.root}
          onChange={(e) => rig.updateSettings({ root: Number(e.target.value) })}
          aria-label="Root note"
        >
          {NOTE_NAMES.map((n, i) => (
            <option key={n} value={i}>
              {n}
            </option>
          ))}
        </select>
        <select
          style={{ ...selectStyle, flex: 1 }}
          value={s.scale}
          onChange={(e) => rig.updateSettings({ scale: e.target.value })}
          aria-label="Scale"
        >
          {Object.entries(SCALES).map(([id, sc]) => (
            <option key={id} value={id}>
              {sc.label}
            </option>
          ))}
        </select>
      </div>

      <Slider label="Steps" value={s.steps} min={2} max={16} step={1} onChange={(v) => rig.updateSettings({ steps: v })} />
      <Slider
        label="Octave range"
        value={s.octaveRange}
        min={1}
        max={4}
        step={1}
        onChange={(v) => rig.updateSettings({ octaveRange: v })}
      />
      <Slider
        label="Octave offset"
        value={s.octaveOffset}
        min={-3}
        max={3}
        step={1}
        format={(v) => (v > 0 ? `+${v}` : String(v))}
        onChange={(v) => rig.updateSettings({ octaveOffset: v })}
      />
      <Slider
        label="Tempo"
        value={s.bpm}
        min={40}
        max={240}
        step={1}
        unit=" bpm"
        onChange={(v) => rig.updateSettings({ bpm: v })}
      />
      <Slider label="Gate length" value={s.gate} min={0.05} max={1} step={0.05} onChange={(v) => rig.updateSettings({ gate: v })} />

      {label('What the sequencer is doing')}
      <SlotBars ctx={ctx} />
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-mute)' }}>
        Step {rs.playhead >= 0 ? (rs.playhead % s.steps) + 1 : '–'} / {s.steps} ·{' '}
        {rs.lastNote === null ? 'rest' : noteName(rs.lastNote)}
      </div>

      {label('Teach it')}
      <div style={{ display: 'flex', gap: 6 }}>
        <Button size="sm" variant="secondary" onClick={() => rig.dislike()}>
          ▽ push away
        </Button>
        <Button size="sm" variant="primary" onClick={() => rig.like()}>
          △ like
        </Button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--fg-dim)' }}>
        Gamepad: LT push away · RT like · Start play/pause · D-pad ◀ ▶ melody maker · ▲ ▼ tempo
      </div>
    </>
  );
}
