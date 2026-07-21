/**
 * Console — shared instrument model: the modes catalogue + per-param shaping
 * helpers.
 *
 * SOURCE OF TRUTH (one-core-engine P5.2, mode-identity consolidation S1 —
 * simplification 2026-07): the schema-backed modes are DERIVED from
 * `ALL_MODE_SCHEMAS`, codegen's mechanically-generated registry of every
 * schema in `src/modes/generated/` — real param names, groups, count, each
 * mode's `ml` config + `engine_id`, AND the set of mode ids itself all come
 * from schema truth, never hand-imported one-by-one. A thin manifold-side
 * OVERLAY (`SCHEMA_MODE_OVERLAYS`, keyed by mode_id) supplies only the display
 * concerns a schema has no opinion on: label, glyph, ModeClass, input kind,
 * and catalogue ORDER (insertion order of the object's keys) — those are
 * legitimately hand-curated display truth, not mechanically derivable, and
 * survive here. Two manifold-only modes with no schema (`visualizer`, `c15`
 * placeholder) stay hand-written and use the default net shape.
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
import { ALL_MODE_SCHEMAS } from '../modes/generated';
import { applyCurve } from '../backends/mapping';

export type ParamStatus = 'off' | 'fixed' | 'live';
/**
 * Param GROUP. Historically a small hand-picked union; now the group is the raw
 * schema string (`'operators'`, `'envelope'`, `'kick'`, …) so the type is just
 * `string`. Unknown groups fall back to the accent colour in {@link GROUP_COLOR}.
 */
export type ParamGroup = string;
export type ModeClass = 'Synth' | 'Sequencer' | 'Controller' | 'Visual';
export type ModeInput = 'xy' | 'joystick' | 'audio_in';

/**
 * Group → CSS custom-property name, for colouring per-output UI (bars, dots,
 * meters). ST4 (simplification 2026-07): this was four byte-identical copies
 * (console/shared-ui.tsx, console/OutputStage.tsx, console/CompositeStage.tsx,
 * dock/OutputControlRow.tsx) — one canonical map now lives here.
 *
 * The keys are JSX-era placeholder group names, NOT the real schema group
 * strings (`schemas/modes/*.json` uses `verb`, `sequencer`, `kick`, `snare`,
 * `filterbank`, `operators`, … — only `pitch` overlaps). For every
 * schema-backed mode this means almost every param falls through to the
 * `--accent` default; the map only does real work for the two hand-written
 * manifold-only modes (`visualizer`, `c15`), whose {@link MANIFOLD_ONLY_MODES}
 * groups (`mod`/`amp`/`fx`) were chosen to match it. A hash-to-palette
 * function over arbitrary group strings would fix this for schema-driven
 * groups too, but `console/OutputStage.tsx` — the hero output view, and the
 * highest-traffic consumer of group colour — is outside this pass's file
 * ownership; changing the strategy here alone would make the demoted/dock
 * views (this map's consumers) disagree with the hero view instead of
 * agreeing, which is the opposite of ST4's goal. Left as a plain map;
 * revisit keys/strategy together with OutputStage.tsx in one change.
 */
export const GROUP_COLOR: Readonly<Record<string, string>> = {
  formant: '--accent',
  pitch: '--accent-2',
  amp: '--good',
  filter: '--warn',
  fx: '--info',
  mod: '--accent-3',
};

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
   * The schema's `engine_id` (audio-engine metadata). {@link modeEngineId}
   * routes the actual backend SELECTION off this field for every mode except
   * `sound_analysis_midi` (see that function's doc comment for why it needs
   * an exception) — this field stays the schema-truth annotation;
   * `modeEngineId` is the routing decision.
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
 * Mode-identity display OVERLAY, keyed by mode_id (S1 — simplification
 * 2026-07): labels, glyphs, `ModeClass`, input kind, and CATALOGUE ORDER
 * (this object's key insertion order) are hand-curated display truth with no
 * schema opinion, so they stay hand-written here. Everything else a mode
 * needs (which mode ids exist, their params/ml/engine_id) is mechanically
 * derived from `ALL_MODE_SCHEMAS` (codegen output) below — `xiasri` +
 * `slp_workshop` are browser-viable entries that have schemas but weren't in
 * the pre-P5 hand-written catalogue.
 */
const SCHEMA_MODE_OVERLAYS: Readonly<Record<string, ModeOverlay>> = {
  paf_synth: { label: 'PAF Synth', glyph: '∿', cls: 'Synth', input: 'xy' },
  channel_strip: { label: 'Channel Strip', glyph: '▤', cls: 'Synth', input: 'joystick' },
  verb_fx: { label: 'Verb FX', glyph: '◞', cls: 'Synth', input: 'joystick' },
  elysiamorf: { label: 'Elysiamorf', glyph: '❋', cls: 'Synth', input: 'xy' },
  memlcelium: { label: 'MEML Celium', glyph: '☷', cls: 'Sequencer', input: 'xy' },
  breakor: { label: 'Breakor', glyph: '⊟', cls: 'Sequencer', input: 'joystick' },
  xiasri: { label: 'Xiasri', glyph: '✴', cls: 'Synth', input: 'joystick' },
  slp_workshop: { label: 'SLP Workshop', glyph: '☷', cls: 'Sequencer', input: 'xy' },
  sound_analysis_midi: {
    label: 'Sound Analysis → MIDI',
    glyph: '⇉',
    cls: 'Controller',
    input: 'audio_in',
  },
};

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
 * Schema-backed modes, in {@link SCHEMA_MODE_OVERLAYS}'s curated catalogue
 * order. A mode_id with no matching generated schema is dropped (loudly, via
 * console.error) rather than crashing the console — this should only be
 * reachable mid-edit, between adding/removing a schema and updating the
 * overlay map.
 */
const SCHEMA_MODES: MFMode[] = Object.entries(SCHEMA_MODE_OVERLAYS).flatMap(
  ([modeId, overlay]) => {
    const schema = ALL_MODE_SCHEMAS.find((s) => s.mode_id === modeId);
    if (!schema) {
      console.error(
        `model.ts: SCHEMA_MODE_OVERLAYS has an entry for mode_id '${modeId}' but no ` +
          'matching generated schema exists (check codegen output) — dropped from MF_MODES.',
      );
      return [];
    }
    return [modeFromSchema(schema, overlay)];
  },
);

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

export const MF_MODES: MFMode[] = [...SCHEMA_MODES, ...MANIFOLD_ONLY_MODES];

/**
 * L38 (simplification 2026-07): this used to be a SECOND, divergent
 * `applyCurve` (`e = 0.25 + c * 1.75`, linear at c≈0.43) alongside
 * `backends/mapping.ts`'s spec-anchored version (0.5 = exact linear
 * midpoint, backends-spec §3). Deleted in favour of the mapping.ts survivor,
 * imported above and re-exported below so `console/index.ts`'s existing
 * `export { applyCurve } from './model'` keeps working.
 *
 * Behaviour change: {@link shapeValues} (below) and Drawers.tsx's bar
 * snapshot are the only consumers of this UI-display curve — they shape the
 * on-screen output value/bar for every mode, at every param's `curve`
 * setting (default 0.5). Actual backend signals (MIDI/OSC/VCV/CV, via
 * `backends/*.ts`'s `mapOutput`) already used mapping.ts's formula
 * exclusively, so this change makes the on-screen numbers agree with what is
 * actually sent to a sink, rather than diverging from it as before. At the
 * default curve (0.5) the exponent moves from 1.125 to an exact 1.0
 * (linear); away from 0.5 the whole response-curve shape changes (mapping.ts
 * is symmetric in log-exponent space, 0.25 at c=0, 4.0 at c=1; the deleted
 * version ranged 0.25→2.0 linearly) — every displayed output value moves
 * visibly, for every mode, at every curve setting except the shared endpoint
 * c=0 (both give exponent 0.25). No schema, engine, or backend-emitted value
 * changes.
 *
 * NOTE for a follow-up: `console/CurvePad.tsx` (out of this pass's file
 * ownership) has its own THIRD inlined copy of the deleted formula
 * (`e = 0.25 + curve * 1.75`) to draw its response-curve preview canvas and
 * the numeric readout beside it. That preview matched this file's curve
 * before today; now it matches neither this file's (now mapping.ts's) curve
 * nor the value the backends actually emit. Repoint it at the same
 * `applyCurve` import so the knob preview, the on-screen bars, and the
 * emitted signal all agree.
 */
export { applyCurve };

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

/**
 * Map a mode id → the audio-engine backend id. Routes on `MFMode.engineId`
 * (schema truth — `slp_workshop`'s schema already declares `engine_id:
 * 'memlcelium'`, so it needs no special case here; unknown ids, including the
 * two manifold-only modes, fall back to `'thru'` via their own `engineId`)
 * (L37 — simplification 2026-07, deleted the hand-`switch`ed duplicate of
 * schema `engine_id` that silently dropped any new mode never added to it).
 *
 * ONE named exception: `sound_analysis_midi`. Its schema declares `engine_id:
 * 'thru'` because `SoundAnalysisMIDIMode`'s own `ModeBase` audio-engine slot
 * really is `NoOpEngine` (nisps/modes/sound_analysis_midi.hpp) — audio passes
 * through silently. But the mode also runs a SEPARATE real engine, the
 * spectral-feature tap `AnalysisEngine` (engine_id "analysis",
 * nisps/engines/analysis.hpp:95) — the browser must instantiate THAT as its
 * audio backend for feature extraction to run at all. `schema.engine_id`
 * ('thru') and the backend to actually select ('analysis') are genuinely
 * different facts for this one mode; every other mode has them equal.
 */
export function modeEngineId(modeId: string): string {
  if (modeId === 'sound_analysis_midi') return 'analysis';
  return MF_MODES.find((m) => m.id === modeId)?.engineId ?? 'thru';
}
