/**
 * The per-output control model for the Outputs / Routing dock (workstream D,
 * docs/specs/dock-spec.md §3.2).
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
 * To keep the dock tri-state and the existing OutputStage tri-state in sync
 * WITHOUT a second data path, this model is folded onto the
 * existing `MFParam` (model.ts) — `MFParam.status` carries `state`, and the new
 * `muted` / `armed` / backend fields live alongside it. ConsoleApp owns the
 * single `MFParam[]` store; the dock and the stage both read/write it.
 */

import type { MFParam, ParamStatus } from '../console/model';

/** The model-control tri-state (alias of the console ParamStatus). */
export type OutputState = ParamStatus; // 'off' | 'fixed' | 'live'

/** The selectable output backend (dock-spec §3.4; backends-spec §1). */
export type BackendId = 'synth' | 'particles' | 'midi' | 'osc' | 'cvgate' | 'vcv';

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
 * uSEQ CV/gate backend per-output extras. Each model output is assigned to one
 * physical uSEQ channel (or 'none'); gate channels threshold the mapped 0..1
 * value. The fixed hardware topology is 11 CV + 3 gate — see
 * docs/specs/useq-cv-protocol.md.
 */
export type CvChannelId =
  | 'none'
  | 'cv1' | 'cv2' | 'cv3' | 'cv4' | 'cv5' | 'cv6'
  | 'cv7' | 'cv8' | 'cv9' | 'cv10' | 'cv11'
  | 'gate1' | 'gate2' | 'gate3';

export interface CvChannelDesc {
  id: CvChannelId;
  label: string;
  kind: 'cv' | 'gate';
}

/** The fixed uSEQ channel roster (UI dropdown order). */
export const CV_CHANNELS: readonly CvChannelDesc[] = [
  { id: 'cv1', label: 'CV1 · main A1', kind: 'cv' },
  { id: 'cv2', label: 'CV2 · main A2', kind: 'cv' },
  { id: 'cv3', label: 'CV3 · main A3', kind: 'cv' },
  { id: 'cv4', label: 'CV4 · exp E1', kind: 'cv' },
  { id: 'cv5', label: 'CV5 · exp E2', kind: 'cv' },
  { id: 'cv6', label: 'CV6 · exp E3', kind: 'cv' },
  { id: 'cv7', label: 'CV7 · exp E4', kind: 'cv' },
  { id: 'cv8', label: 'CV8 · exp E5', kind: 'cv' },
  { id: 'cv9', label: 'CV9 · exp E6', kind: 'cv' },
  { id: 'cv10', label: 'CV10 · exp E7', kind: 'cv' },
  { id: 'cv11', label: 'CV11 · exp E8', kind: 'cv' },
  { id: 'gate1', label: 'Gate1 · main D1', kind: 'gate' },
  { id: 'gate2', label: 'Gate2 · main D2', kind: 'gate' },
  { id: 'gate3', label: 'Gate3 · main D3', kind: 'gate' },
] as const;

export interface CvSpec {
  /** Physical uSEQ channel this output drives, or 'none' to skip it. */
  channel: CvChannelId;
  /** For gate channels: gate goes HIGH when the mapped 0..1 value ≥ this. */
  gateThreshold: number;
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

/** Default VCV spec for an output — unipolar 0–10 V by default. */
export function defaultVcvSpec(): VcvSpec {
  return { bipolar: false };
}

/**
 * Default uSEQ CV channel for output `index` — identity map: outputs 0..10 →
 * CV1..CV11, outputs 11..13 → GATE1..3, the rest unassigned ('none').
 */
export function defaultCvSpec(index: number): CvSpec {
  const ch = CV_CHANNELS[index]?.id ?? 'none';
  return { channel: ch, gateThreshold: 0.5 };
}
