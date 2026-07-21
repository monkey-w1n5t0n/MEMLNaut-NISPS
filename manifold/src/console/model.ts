/**
 * Console — shared instrument model: the modes catalogue + per-param shaping
 * helpers.
 *
 * SOURCE OF TRUTH (one-core-engine P5.2): the schema-backed modes are DERIVED
 * from the codegen-produced schemas in `src/modes/generated/` — real param
 * names, groups, count, and each mode's `ml` config + `engine_id` come from
 * schema truth, never hand-written. A thin manifold-side OVERLAY supplies only
 * the display concerns a schema has no opinion on: label, glyph, ModeClass,
 * input kind, and ordering. Two manifold-only modes with no schema
 * (`visualizer`, `c15` placeholder) stay hand-written and use the default net
 * shape.
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

import type { ModeSchema } from '../modes/generated/types';
import {
  BreakorSchema,
  ChannelStripSchema,
  ElysiamorfSchema,
  MemlceliumSchema,
  PafSynthSchema,
  SlpWorkshopSchema,
  SoundAnalysisMidiSchema,
  VerbFxSchema,
  XiasriSchema,
} from '../modes/generated';

export type ParamStatus = 'off' | 'fixed' | 'live';
/**
 * Param GROUP. Historically a small hand-picked union; now the group is the raw
 * schema string (`'operators'`, `'envelope'`, `'kick'`, …) so the type is just
 * `string`. Unknown groups fall back to the accent colour in the GROUP_COLOR
 * maps that key off this field.
 */
export type ParamGroup = string;
export type ModeClass = 'Synth' | 'Sequencer' | 'Controller' | 'Visual';
export type ModeInput = 'xy' | 'joystick' | 'audio_in';

/**
 * A mode's net shape — the engine dims the runtime-shaped WASM MLP is reshaped
 * to when this mode is active (one-core-engine P5.3). Schema-backed modes carry
 * their schema's `ml`; the manifold-only modes carry the default net shape.
 */
export interface ModeML {
  inputSize: number;
  outputSize: number;
  hidden: [number, number, number];
  /** Spread used when (re)drawing the net's weights on reshape. */
  defaultSpread: number;
}

/** The compiled default over-provisioned net (32→[10,14,18]→126). */
export const DEFAULT_MODE_ML: ModeML = {
  inputSize: 32,
  outputSize: 126,
  hidden: [10, 14, 18],
  defaultSpread: 0.6,
};

/**
 * Per-output control row — the unified store used by both the stage
 * (OutputStage) and the Outputs/Routing dock. `status` is the
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
  /**
   * Schema ENGINE-unit metadata (display/tooltips only — NOT the routing range).
   * `min`/`max`/`curve`/`val` above stay the 0..1 routing-knob semantics; these
   * carry the schema's real engine range, default, human label, and curve name
   * for the disliked param so the UI can show what an output actually drives.
   */
  schemaMin?: number;
  schemaMax?: number;
  schemaDefault?: number;
  schemaLabel?: string;
  schemaCurve?: string;
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
  /**
   * The net shape this mode drives (one-core-engine P5.3). Reshaped into the
   * engine on mode switch. Schema-backed modes carry their schema's `ml`; the
   * manifold-only modes carry {@link DEFAULT_MODE_ML}.
   */
  ml: ModeML;
  /**
   * The schema's `engine_id` (audio-engine metadata). NOTE: audio backend
   * SELECTION still routes through {@link modeEngineId}, which is unchanged —
   * this field is the schema-truth annotation, not the routing decision.
   */
  engineId: string;
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

/** Derive a mode's net shape from its schema `ml` config. */
function mlFromSchema(schema: ModeSchema): ModeML {
  const h = schema.ml.hidden_layers;
  return {
    inputSize: schema.ml.input_size,
    outputSize: schema.ml.output_size,
    hidden: [h[0] ?? 10, h[1] ?? 14, h[2] ?? 18],
    defaultSpread: schema.ml.default_spread,
  };
}

/**
 * Build the manifold param rows from a schema's params. The param NAME + GROUP
 * are schema truth; the routing knobs (status/val/min/max/curve) keep their
 * manifold defaults (0..1 routing range) — schema min/max/default/label/curve
 * are surfaced as ENGINE-unit metadata for display only.
 */
function paramsFromSchema(schema: ModeSchema): MFParam[] {
  return schema.params.map((p) => ({
    name: p.name,
    group: p.group,
    status: 'live' as ParamStatus,
    val: 0.5,
    min: 0,
    max: 1,
    curve: 0.5,
    schemaMin: p.min,
    schemaMax: p.max,
    schemaDefault: p.default,
    schemaLabel: p.label,
    schemaCurve: p.curve,
  }));
}

/**
 * Manifold-side display OVERLAY for a schema-backed mode — the only fields a
 * schema has no opinion on. Everything else (params, ml, engineId) is derived.
 */
interface ModeOverlay {
  label: string;
  glyph: string;
  cls: ModeClass;
  input: ModeInput;
  badge?: string;
}

/**
 * ORDERED list of schema-backed modes: `{ schema, overlay }`. Order here is the
 * catalogue order. `xiasri` + `slp_workshop` are new browser-viable entries
 * (they have schemas but weren't in the hand-written catalogue). The overlay is
 * hand-picked display; the params/ml/engine_id come from the schema.
 */
const SCHEMA_MODES: ReadonlyArray<{ schema: ModeSchema; overlay: ModeOverlay }> = [
  { schema: PafSynthSchema, overlay: { label: 'PAF Synth', glyph: '∿', cls: 'Synth', input: 'xy' } },
  {
    schema: ChannelStripSchema,
    overlay: { label: 'Channel Strip', glyph: '▤', cls: 'Synth', input: 'joystick' },
  },
  { schema: VerbFxSchema, overlay: { label: 'Verb FX', glyph: '◞', cls: 'Synth', input: 'joystick' } },
  { schema: ElysiamorfSchema, overlay: { label: 'Elysiamorf', glyph: '❋', cls: 'Synth', input: 'xy' } },
  {
    schema: MemlceliumSchema,
    overlay: { label: 'MEML Celium', glyph: '☷', cls: 'Sequencer', input: 'xy' },
  },
  { schema: BreakorSchema, overlay: { label: 'Breakor', glyph: '⊟', cls: 'Sequencer', input: 'joystick' } },
  { schema: XiasriSchema, overlay: { label: 'Xiasri', glyph: '✴', cls: 'Synth', input: 'joystick' } },
  {
    schema: SlpWorkshopSchema,
    overlay: { label: 'SLP Workshop', glyph: '☷', cls: 'Sequencer', input: 'xy' },
  },
  {
    schema: SoundAnalysisMidiSchema,
    overlay: { label: 'Sound Analysis → MIDI', glyph: '⇉', cls: 'Controller', input: 'audio_in' },
  },
];

function modeFromSchema(schema: ModeSchema, overlay: ModeOverlay): MFMode {
  return {
    id: schema.mode_id,
    label: overlay.label,
    cls: overlay.cls,
    glyph: overlay.glyph,
    input: overlay.input,
    badge: overlay.badge,
    params: paramsFromSchema(schema),
    ml: mlFromSchema(schema),
    engineId: schema.engine_id,
  };
}

/**
 * Manifold-only modes with NO schema — hand-written params on the DEFAULT net
 * shape. `visualizer` is a pure browser visual; `c15` is the "Powerful Synth
 * Engine" placeholder (id stays `c15`; the string "C15" must never surface).
 */
const MANIFOLD_ONLY_MODES: MFMode[] = [
  {
    id: 'visualizer',
    label: 'Visualizer',
    cls: 'Visual',
    glyph: '◑',
    input: 'xy',
    ml: DEFAULT_MODE_ML,
    engineId: 'thru',
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
    ml: DEFAULT_MODE_ML,
    engineId: 'thru',
    params: mkParams([['amp', ['a', 'b']]]),
  },
];

export const MF_MODES: MFMode[] = [
  ...SCHEMA_MODES.map(({ schema, overlay }) => modeFromSchema(schema, overlay)),
  ...MANIFOLD_ONLY_MODES,
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
 * The engine output vector is now per-mode-sized (the net is reshaped to the
 * mode's schema `ml.output_size` on switch), so a mode with N params maps 1:1
 * onto its own N outputs; the `i < engineOut.length` guard keeps it safe during
 * the async reshape window.
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

/** Map a mode id → the audio-engine backend id. Mode ids align with engine ids
 *  except `slp_workshop` (runs the memlcelium engine), the analysis controller,
 *  and the relabelled `c15`. */
export function modeEngineId(modeId: string): string {
  switch (modeId) {
    case 'paf_synth':
    case 'channel_strip':
    case 'verb_fx':
    case 'elysiamorf':
    case 'memlcelium':
    case 'breakor':
    case 'xiasri':
      return modeId;
    case 'slp_workshop':
      return 'memlcelium';
    case 'sound_analysis_midi':
      return 'analysis';
    default:
      return 'thru';
  }
}
