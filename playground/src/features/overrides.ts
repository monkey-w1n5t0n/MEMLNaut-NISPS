/**
 * Override application — apply per-parameter overrides between MLP outputs
 * and the engine's parameter destination.
 *
 * The MLP emits values in [0, 1]. The mode schema specifies a per-parameter
 * `min`, `max`, and `curve`. Modes can layer overrides on top via
 * `modeStore.setOverride` to:
 *   - Re-curve the value (`curve` and `curveParam`).
 *   - Mute it (replace with `fixedValue` ∈ [hardMin, hardMax]).
 *   - Freeze it (hold last processed value).
 *   - Tighten the active range (`min`/`max` ⊂ schema bounds).
 *
 * `applyOverrides` walks the schema params in order, looks up overrides for
 * each, and writes results into a target Float32Array of the same length as
 * the MLP slice. The function is pure — caller manages buffer reuse.
 *
 * The output buffer values are NORMALISED to [0, 1] in their effective
 * range so the mode's audio engine, MIDI router, or visualiser can scale
 * uniformly. Engines/MIDI consumers that need actual min/max units can use
 * `paramsToSliderValues` from `mode-helpers`.
 */

import type { ParamOverride } from '../stores/mode-store';
import type { Param } from '../modes/generated/types';
import { applyCurve, type CurveName, clamp01 } from '../output/curves';

/**
 * Result of applying overrides:
 *  - `values` is a Float32Array of length `params.length`, each in [0, 1]
 *    representing the post-override normalised parameter value.
 *  - `freezeMask` (optional) marks per-output frozen flags. Only allocated
 *    when at least one param is frozen — saves work on the typical case.
 */
export interface OverrideResult {
  values: Float32Array;
  freezeMask: Uint8Array | null;
  /** Number of muted/frozen entries (for telemetry). */
  affectedCount: number;
}

/**
 * Apply per-param overrides to the slice of MLP outputs corresponding to
 * the schema's params.
 *
 * @param raw       processed (post output-pipeline) MLP outputs in [0,1]
 * @param prev      previous post-override outputs (for freeze hold)
 * @param params    mode schema params
 * @param overrides per-name override map (sparse; missing keys fall through)
 * @param dest      optional destination Float32Array; allocated if absent
 */
export function applyOverrides(
  raw: Float32Array,
  prev: Float32Array | null,
  params: ReadonlyArray<Param>,
  overrides: Record<string, ParamOverride>,
  dest?: Float32Array,
): OverrideResult {
  const n = params.length;
  const out = dest && dest.length === n ? dest : new Float32Array(n);
  let affected = 0;
  let freezeMask: Uint8Array | null = null;

  for (let i = 0; i < n; ++i) {
    const p = params[i]!;
    const ov = overrides[p.name];
    const r = clamp01(raw[i] ?? 0);

    if (!ov) {
      // No override → identity (raw normalised value).
      out[i] = r;
      continue;
    }

    if (ov.frozen) {
      // Freeze: hold last processed value. Track in freezeMask so the
      // output pipeline can also honor it next frame.
      if (!freezeMask) freezeMask = new Uint8Array(n);
      freezeMask[i] = 1;
      out[i] = prev?.[i] ?? r;
      affected++;
      continue;
    }

    if (ov.muted) {
      // Mute: replace with fixedValue. fixedValue is stored in schema units
      // [min, max] — normalise back to [0, 1] in the override's effective range.
      const range = ov.max - ov.min;
      const norm = range > 0 ? (ov.fixedValue - ov.min) / range : 0.5;
      out[i] = clamp01(norm);
      affected++;
      continue;
    }

    // Apply curve (if any), then clamp.
    let v = r;
    if (ov.curve && ov.curve !== 'linear') {
      v = applyCurve(ov.curve as CurveName, r, ov.curveParam);
    }
    out[i] = clamp01(v);
  }

  return { values: out, freezeMask, affectedCount: affected };
}

/**
 * Build a Uint8Array of length `outputSize` marking every pinned output
 * with a 1. Used by `WasmIML.moveWeights` to skip pinned weights during RL
 * perturbation. Combines:
 *   - explicit param-pins from sessionStore
 *   - per-param `pinned` flag in modeStore overrides
 */
export function buildPinMask(
  outputSize: number,
  modeId: string,
  params: ReadonlyArray<Param>,
  overrides: Record<string, ParamOverride>,
  paramPins: ReadonlyArray<{ key: string; outputIndex: number }>,
): Uint8Array {
  const mask = new Uint8Array(outputSize);
  for (let i = 0; i < params.length && i < outputSize; ++i) {
    const ov = overrides[params[i]!.name];
    if (ov && ov.pinned) mask[i] = 1;
  }
  for (const pin of paramPins) {
    if (!pin.key.startsWith(modeId + ':')) continue;
    if (pin.outputIndex >= 0 && pin.outputIndex < outputSize) {
      mask[pin.outputIndex] = 1;
    }
  }
  return mask;
}
