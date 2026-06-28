/**
 * Console — shared instrument model: the static modes catalogue + per-param
 * shaping helpers. Ported from the window-global `model.jsx`.
 *
 * KEY CHANGE vs the JSX reference: the pseudo-inference `MF_infer` (sin/cos
 * placeholder) and the `useInstrument` hook are GONE. The `values` every
 * consumer reads now come from the REAL engine (`engine.getOutputs()`), mapped
 * onto a mode's params here via {@link shapeValues}. This file keeps only the
 * mode/param DATA + the pure shaping maths.
 *
 * The `c15` mode and its synth label are relabelled to "Powerful Synth Engine"
 * — the string "C15" must never appear in the UI (it survives only as an
 * internal mode id).
 */

export type ParamStatus = 'off' | 'fixed' | 'live';
export type ParamGroup = 'formant' | 'pitch' | 'amp' | 'filter' | 'fx' | 'mod';
export type ModeClass = 'Synth' | 'Sequencer' | 'Controller' | 'Visual';
export type ModeInput = 'xy' | 'joystick' | 'audio_in';

/**
 * Per-output control row — the unified store used by both the stage
 * (OutputStage / ReadoutStrip) and the Outputs/Routing dock. `status` is the
 * model-control tri-state; `muted` and `armed` are ORTHOGONAL modifiers
 * (dock-spec §3.2 — the deliberate split of the deployed conflated
 * frozen↔muted field). Backend-specific specs are populated by the active
 * backend adapter (dock-spec §4); their shapes live in dock/output-state.ts and
 * are re-declared here loosely to avoid a console→dock import cycle.
 */
export interface MFParam {
  name: string;
  group: string;
  status: ParamStatus;
  val: number;
  min: number;
  max: number;
  curve: number;
  /** Downstream silence — still computed + visible (distinct from `off`). */
  muted?: boolean;
  /** Solo / arm — focus training on this output (dock-spec §1.2). */
  armed?: boolean;
  /** MIDI CC backend spec ({ cc, channel, name, value }). */
  midi?: { cc: number; channel: number; name: string; value: number };
  /** OSC backend spec ({ path, rangeMin, rangeMax }). */
  osc?: { path: string; rangeMin: number; rangeMax: number };
  /** VCV backend spec ({ bipolar }). */
  vcv?: { bipolar: boolean };
  /** uSEQ CV/gate backend spec ({ channel, gateThreshold }). */
  cv?: { channel: string; gateThreshold: number };
}

export interface MFMode {
  id: string;
  label: string;
  cls: ModeClass;
  glyph: string;
  input: ModeInput;
  params: MFParam[];
  placeholder?: boolean;
  badge?: string;
}

type Spec = ReadonlyArray<readonly [string, ReadonlyArray<string>]>;

function mkParams(spec: Spec): MFParam[] {
  const out: MFParam[] = [];
  for (const [group, names] of spec) {
    names.forEach((name) =>
      out.push({ name, group, status: 'live', val: 0.5, min: 0, max: 1, curve: 0.5 }),
    );
  }
  return out;
}

export const MF_MODES: MFMode[] = [
  {
    id: 'paf_synth',
    label: 'PAF Synth',
    cls: 'Synth',
    glyph: '∿',
    input: 'xy',
    params: mkParams([
      ['formant', ['F1', 'F2', 'F3', 'tilt', 'spread', 'skirt']],
      ['pitch', ['root', 'glide', 'detune']],
      ['amp', ['gain', 'attack', 'decay']],
      ['filter', ['cutoff', 'res', 'env']],
      ['fx', ['drive', 'air', 'width']],
    ]),
  },
  {
    id: 'channel_strip',
    label: 'Channel Strip',
    cls: 'Synth',
    glyph: '▤',
    input: 'joystick',
    params: mkParams([
      ['filter', ['lo', 'loMid', 'hiMid', 'hi']],
      ['amp', ['comp', 'gate', 'makeup']],
      ['fx', ['sat', 'width', 'glue', 'tilt', 'air']],
    ]),
  },
  {
    id: 'verb_fx',
    label: 'Verb FX',
    cls: 'Synth',
    glyph: '◞',
    input: 'joystick',
    params: mkParams([
      ['fx', ['size', 'decay', 'damp', 'diff']],
      ['mod', ['rate', 'depth']],
      ['filter', ['lo', 'hi']],
    ]),
  },
  {
    id: 'elysiamorf',
    label: 'Elysiamorf',
    cls: 'Synth',
    glyph: '❋',
    input: 'xy',
    params: mkParams([
      ['formant', ['grain', 'size', 'pos', 'spray']],
      ['mod', ['rate', 'depth', 'jitter']],
      ['amp', ['gain', 'env']],
      ['filter', ['cutoff', 'res']],
      ['fx', ['blur', 'shimmer', 'freeze', 'width']],
    ]),
  },
  {
    id: 'memlcelium',
    label: 'MEML Celium',
    cls: 'Sequencer',
    glyph: '☷',
    input: 'xy',
    params: mkParams([
      ['mod', ['cvA', 'cvB', 'gate', 'div']],
      ['pitch', ['root', 'scale', 'oct']],
      ['amp', ['vca', 'slew']],
    ]),
  },
  {
    id: 'breakor',
    label: 'Breakor',
    cls: 'Sequencer',
    glyph: '⊟',
    input: 'joystick',
    params: mkParams([
      ['mod', ['density', 'swing', 'fill', 'stutter']],
      ['amp', ['punch', 'decay']],
      ['filter', ['tone', 'crush']],
      ['fx', ['glitch', 'rev']],
    ]),
  },
  {
    id: 'sound_analysis_midi',
    label: 'Sound Analysis → MIDI',
    cls: 'Controller',
    glyph: '⇉',
    input: 'audio_in',
    badge: '1-input',
    params: mkParams([
      ['mod', ['cc1', 'cc2', 'cc3', 'cc4']],
      ['pitch', ['note', 'bend']],
      ['amp', ['vel', 'press']],
    ]),
  },
  {
    id: 'visualizer',
    label: 'Visualizer',
    cls: 'Visual',
    glyph: '◑',
    input: 'xy',
    params: mkParams([
      ['mod', ['hue', 'sat', 'flow', 'warp']],
      ['amp', ['bloom', 'fade']],
      ['fx', ['grain', 'trail']],
    ]),
  },
  {
    // Internal id stays `c15`; the UI label is "Powerful Synth Engine".
    id: 'c15',
    label: 'Powerful Synth Engine',
    cls: 'Synth',
    glyph: '◆',
    input: 'xy',
    placeholder: true,
    badge: 'soon',
    params: mkParams([['amp', ['a', 'b']]]),
  },
];

/** Mirrors the engine's `applyCurve` (≈0.43 ≈ linear). */
export function applyCurve(v: number, c: number): number {
  const e = 0.25 + c * 1.75;
  return Math.pow(Math.max(0, Math.min(1, v)), e);
}

/**
 * Map the engine's raw output vector onto a mode's params, applying each
 * param's status / min / max / curve. Replaces `MF_infer`:
 *   off   → 0 (muted)
 *   fixed → p.val (held static)
 *   live  → engine output[i], shaped by min/max/curve
 *
 * The engine output is 126-dim; a mode with N params uses the first N.
 */
export function shapeValues(params: MFParam[], engineOut: Float32Array | null): number[] {
  return params.map((p, i) => {
    if (p.status === 'off') return 0;
    if (p.status === 'fixed') return p.val ?? 0.5;
    const raw = engineOut && i < engineOut.length ? engineOut[i] : 0.5;
    const v = p.min + applyCurve(raw, p.curve) * (p.max - p.min);
    return Math.max(0, Math.min(1, v));
  });
}

/** Deterministic per-revision gradient-flow stub (visual only; ported as-is). */
export function seededGradient(rev: number): {
  norms: number[];
  status: string[];
} {
  const n = 4;
  const norms: number[] = [];
  const status: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.abs((Math.sin((rev + 1) * (i + 1) * 12.9898) * 43758.5453) % 1);
    norms.push(0.2 + r * 0.8);
    status.push(r > 0.85 ? 'exploding' : r < 0.18 ? 'vanishing' : r < 0.3 ? 'converged' : 'healthy');
  }
  return { norms, status };
}

/** Map a mode's `input` kind → the engine backend id to drive audio. */
export function modeEngineId(modeId: string): string {
  // Mode ids align with engine ids except the relabelled `c15`.
  switch (modeId) {
    case 'paf_synth':
    case 'channel_strip':
    case 'verb_fx':
    case 'elysiamorf':
    case 'memlcelium':
    case 'breakor':
      return modeId;
    case 'sound_analysis_midi':
      return 'analysis';
    default:
      return 'thru';
  }
}
