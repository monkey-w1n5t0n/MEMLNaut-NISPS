/**
 * Preset model — pure functions describing how a Powerful Synth Engine preset
 * turns an MLP output vector into synth parameters. No DOM, no audio.
 *
 * Semantics reproduce the old playground (`a-app.js applyPreset` /
 * `applyGroupOverrides`):
 *  - `preset.active` lists the ML-controlled params in output order
 *    (`null` = all 126, in SYNTH_PARAM_MAP order).
 *  - A controlled param's range defaults to its tame range (`safeMin`/`safeMax`
 *    at tame level 1); `overrides[name]` replaces min/max/curve/fixedValue.
 *  - Curve: a per-param curve other than 0.5 wins; otherwise the preset's
 *    `groupCurves[section]` (default 0.5) applies.
 *  - Every other param is HELD at `mutedOverrides[name].fixedValue`, or its
 *    default, and is not tame-scaled.
 *  - Value = min + curve(raw)^ * (max - min), written to the engine as the
 *    normalised hardware value.
 */
import {
  SYNTH_PARAM_MAP,
  SYNTH_PARAM_SECTION,
  applyGroupOverride,
  findSynthParam,
  tameRange,
  type SynthParamEntry,
} from './psynth-params';
import { PRESET_TIERS, SYNTH_PRESETS, type SynthPreset } from './psynth-presets';

/** Tame level the old app used by default (`?tame=1`). */
export const DEFAULT_TAME = 1;

export interface PresetParamSpec {
  /** Machine name, e.g. 'Env_A_Att'. */
  name: string;
  /** Hardware parameter id. */
  id: number;
  label: string;
  /** Section name, e.g. 'Env A'. */
  group: string;
  min: number;
  max: number;
  /** Effective curve (0.5 = linear). */
  curve: number;
  /** Starting / frozen value (normalised hardware value). */
  initial: number;
}

export interface HeldValue {
  name: string;
  id: number;
  /** Normalised hardware value. */
  value: number;
}

export interface PresetGroup {
  tier: number;
  label: string;
  presets: SynthPreset[];
}

const presetById = new Map<string, SynthPreset>(SYNTH_PRESETS.map((p) => [p.id, p]));

export function getPreset(presetId: string): SynthPreset | undefined {
  return presetById.get(presetId);
}

function activeEntries(preset: SynthPreset): SynthParamEntry[] {
  if (preset.active === null) return [...SYNTH_PARAM_MAP];
  const out: SynthParamEntry[] = [];
  for (const name of preset.active) {
    const e = findSynthParam(name);
    if (e) out.push(e);
  }
  return out;
}

const specCache = new Map<string, readonly PresetParamSpec[]>();
const heldCache = new Map<string, readonly HeldValue[]>();

/** ML-controlled outputs of a preset, in output-index order. Empty for an unknown id. */
export function presetParamSpecs(presetId: string, tame: number = DEFAULT_TAME): readonly PresetParamSpec[] {
  const key = `${presetId}@${tame}`;
  const hit = specCache.get(key);
  if (hit) return hit;
  const preset = presetById.get(presetId);
  if (!preset) return [];
  const sectionOf = (e: SynthParamEntry): string => SYNTH_PARAM_SECTION[SYNTH_PARAM_MAP.indexOf(e)] ?? 'Other';
  const specs = activeEntries(preset).map((e): PresetParamSpec => {
    const ov = preset.overrides[e.name];
    const tr = tameRange(e, tame);
    const group = sectionOf(e);
    const groupCurve = preset.groupCurves[group] ?? 0.5;
    const ownCurve = ov?.curve ?? 0.5;
    return {
      name: e.name,
      id: e.id,
      label: e.label,
      group,
      min: ov?.min ?? tr.min,
      max: ov?.max ?? tr.max,
      curve: ownCurve !== 0.5 ? ownCurve : groupCurve,
      initial: ov?.fixedValue ?? e.defaultValue,
    };
  });
  specCache.set(key, specs);
  return specs;
}

/** Number of MLP outputs a preset drives (0 for an unknown id). */
export function presetOutputCount(presetId: string): number {
  const p = presetById.get(presetId);
  if (!p) return 0;
  return p.active === null ? SYNTH_PARAM_MAP.length : activeEntries(p).length;
}

/** Values the non-controlled params are held at: mutedOverrides fixedValue, else the default. */
export function presetHeldValues(presetId: string): readonly HeldValue[] {
  const hit = heldCache.get(presetId);
  if (hit) return hit;
  const preset = presetById.get(presetId);
  if (!preset) return [];
  const active = new Set(preset.active ?? SYNTH_PARAM_MAP.map((p) => p.name));
  const held: HeldValue[] = [];
  for (const e of SYNTH_PARAM_MAP) {
    if (active.has(e.name)) continue;
    const fixed = preset.mutedOverrides[e.name]?.fixedValue;
    held.push({ name: e.name, id: e.id, value: fixed !== undefined ? fixed : e.defaultValue });
  }
  heldCache.set(presetId, held);
  return held;
}

/** Presets grouped by tier, in tier order. */
export function listPresets(): PresetGroup[] {
  return PRESET_TIERS.map((t) => ({
    tier: t.tier,
    label: t.label,
    presets: SYNTH_PRESETS.filter((p) => p.tier === t.tier),
  }));
}

/**
 * How one MLP output (0..1) becomes a synth value: curve, then scale into
 * [min,max] — the old `applyGroupOverride`. The result is the normalised
 * hardware value written to the engine.
 */
export function mapOutputToParam(spec: Pick<PresetParamSpec, 'min' | 'max' | 'curve'>, raw01: number): number {
  return applyGroupOverride(raw01, spec.curve, spec.min, spec.max);
}
