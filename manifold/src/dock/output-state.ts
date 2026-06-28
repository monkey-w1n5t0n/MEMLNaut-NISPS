/**
 * The per-output control model for the Outputs / Routing dock (workstream D,
 * docs/redesign/dock-spec.md §3.2).
 *
 * DELIBERATE DIVERGENCE from the deployed a-immersive app (dock-spec §3.3 note,
 * open choice 3): the deployed override system conflates "frozen" (heatmap
 * popup) and "muted" (group drawer) onto ONE underlying field. This model splits
 * the three orthogonal concepts into distinct fields:
 *
 *   - `state`  : 'off' | 'fixed' | 'live'  — the model-control tri-state.
 *   - `muted`  : boolean                   — downstream silence (still computed + visible).
 *   - `armed`  : boolean                   — solo / focus-training (=arm).
 *
 * They compose freely (e.g. an output can be `off` AND `muted` AND `armed`).
 * Recorded in ALIGNMENT.md.
 *
 * To keep the dock tri-state and the existing OutputStage / ReadoutStrip
 * tri-state in sync WITHOUT a second data path, this model is folded onto the
 * existing `MFParam` (model.ts) — `MFParam.status` carries `state`, and the new
 * `muted` / `armed` / backend fields live alongside it. ConsoleApp owns the
 * single `MFParam[]` store; the dock and the stage both read/write it.
 */

import type { MFParam, ParamStatus } from '../console/model';

/** The model-control tri-state (alias of the console ParamStatus). */
export type OutputState = ParamStatus; // 'off' | 'fixed' | 'live'

/** The selectable output backend (dock-spec §3.4; backends-spec §1). */
export type BackendId = 'synth' | 'particles' | 'midi' | 'osc' | 'cvgate' | 'vcv';

export interface BackendDescriptor {
  id: BackendId;
  /** Dock label — NEVER "C15" (backends-spec naming guard). */
  label: string;
  description: string;
}

/** The backend roster surfaced in the dock's backend selector. */
export const BACKENDS: readonly BackendDescriptor[] = [
  { id: 'synth', label: 'Powerful Synth Engine', description: 'Firmware-parity built-in audio engine.' },
  { id: 'midi', label: 'MIDI', description: 'Web MIDI CC out — per-output CC#/channel.' },
  { id: 'osc', label: 'OSC', description: 'OSC bridge — named paths + physical ranges.' },
  { id: 'cvgate', label: 'CV', description: 'CV / gate (via VCV bridge or DC-coupled audio).' },
  { id: 'vcv', label: 'VCV', description: 'VCV Rack module — 16 CV outs with LED rings.' },
  { id: 'particles', label: 'Particle', description: 'Flow-field visualiser (no audio).' },
] as const;

// ---- Backend-specific per-output specs (dock-spec §4) ----------------------

/** MIDI CC backend per-output extras (dock-spec §4.1). */
export interface MidiCcSpec {
  cc: number; // 0..127
  channel: number; // 1..16
  name: string;
  value: number; // last sent, round(v*127)
}

/** OSC backend per-output extras (dock-spec §4.2). */
export interface OscSpec {
  path: string; // e.g. "/synth/cutoff"
  rangeMin: number; // physical (engineering) units, NOT [0,1]
  rangeMax: number;
}

/** VCV backend per-output extras (dock-spec §4.3) — baseline min/max IS the range. */
export interface VcvSpec {
  bipolar: boolean; // unipolar 0..10V vs bipolar ±5V
}

/**
 * The full per-output control. This is the spec's `OutputControl` (dock-spec
 * §3.2). It is represented on `MFParam` for the shared store; this interface
 * documents the complete contract and is what {@link toOutputControl} yields.
 */
export interface OutputControl {
  index: number;
  name: string;
  group: string;
  state: OutputState; // off | fixed | live
  muted: boolean; // downstream silence; still computed
  armed: boolean; // solo / focus-training (=arm)
  min: number; // [0,1]
  max: number; // [0,1], min<=max
  curve: number; // [0,1], 0.5 linear
  fixedValue: number; // held value when state==='fixed'
  // backend-specific, populated by the active backend adapter:
  midi?: MidiCcSpec;
  osc?: OscSpec;
  vcv?: VcvSpec;
}

/** Project an MFParam (the shared store row) into the full OutputControl view. */
export function toOutputControl(p: MFParam, index: number): OutputControl {
  return {
    index,
    name: p.name,
    group: p.group,
    state: p.status,
    muted: p.muted ?? false,
    armed: p.armed ?? false,
    min: p.min,
    max: p.max,
    curve: p.curve,
    fixedValue: p.val,
    midi: p.midi,
    osc: p.osc,
    vcv: p.vcv,
  };
}

/**
 * Build the focus / solo mask from the per-row armed flags (dock-spec §1.2).
 * Returns null when nothing is armed (⇒ all outputs active / no focus).
 */
export function buildArmMask(params: MFParam[]): Uint8Array | null {
  const anyArmed = params.some((p) => p.armed);
  if (!anyArmed) return null;
  const mask = new Uint8Array(params.length);
  for (let i = 0; i < params.length; i++) mask[i] = params[i].armed ? 1 : 0;
  return mask;
}

/** Default MIDI CC spec for a freshly-added output, auto-named by index. */
export function defaultMidiSpec(index: number): MidiCcSpec {
  return { cc: index % 128, channel: 1, name: `CC ${index % 128}`, value: 0 };
}

/** Default OSC spec for an output. */
export function defaultOscSpec(name: string): OscSpec {
  return { path: `/nisps/${name.toLowerCase()}`, rangeMin: 0, rangeMax: 1 };
}
