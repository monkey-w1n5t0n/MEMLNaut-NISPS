/**
 * preset-types.js — JSDoc typedefs for the unified preset schema.
 *
 * Pure types. No runtime code. Importing this file has no side effects and
 * contributes nothing to the runtime bundle; it exists so editors (and humans)
 * can typecheck preset objects against the canonical schema.
 *
 * Source of truth: `playground/docs/unified-preset-schema.md`.
 * Epic: meml-iid8. Issue: meml-piri.
 */

/**
 * A single parameter entry within a preset.
 *
 * Normalised to [0, 1]. The per-engine param-metadata table converts to raw
 * engineering units (Hz, seconds, semitones, …) — see meml-4bin for the
 * modular-side normalised setParam work.
 *
 * Two independent flags control how the MLP interacts with this param:
 *
 * - `bypassed` (structural) — param is NOT in `paramMeta`. MLP has no output
 *   for it. Held at `fixedValue` (or DSP default) for the life of the preset.
 *   Toggling requires an MLP rebuild (coordinates with meml-gmus).
 * - `muted` (runtime) — param IS in `paramMeta` and trains, but its MLP output
 *   is ignored at runtime and the param is pinned at `fixedValue`. Can be
 *   toggled freely without touching the MLP.
 *
 * `bypassed:true` takes precedence over `muted` (a bypassed param has no MLP
 * output to mute). See meml-7qnz and the schema doc's "Bypass vs. mute" section.
 *
 * @typedef {Object} PresetParamEntry
 * @property {boolean} bypassed
 *   If true, param is NOT in paramMeta; MLP has no output for it.
 *   Held at `fixedValue` (or engine DSP default).
 * @property {boolean} muted
 *   If true (and not bypassed), MLP output is ignored at runtime; param pinned
 *   at `fixedValue`. If `bypassed` is true, `muted` is ignored.
 * @property {number} [fixedValue]
 *   Value in [0, 1] to pin the param at when bypassed or muted. Omitted →
 *   engine default.
 * @property {number} [min]
 *   Lower bound of MLP-controlled range, in [0, 1]. Defaults to 0.
 * @property {number} [max]
 *   Upper bound of MLP-controlled range, in [0, 1]. Defaults to 1.
 * @property {number} [curve]
 *   Distribution bias in [0, 1]. 0.5 = linear. <0.5 biases low, >0.5 biases
 *   high. Soft bias — does NOT clamp the extremes. Defaults to 0.5.
 */

/**
 * A single matrix-cell entry (modular only).
 *
 * Cells are keyed in `Preset.matrix` as `'sNN_dNN'` (zero-padded source →
 * destination). Sources: s00–s15 = ADSR 1..16, s16–s47 = LFO 1..32.
 * Destinations depend on the sub-engine (d00 = pitch, d08 = amp, d09 = pan
 * across all sub-engines).
 *
 * Muted semantics for matrix cells differ from regular params: omitted cells
 * are treated as deactivated (muted:true, fixedValue:0). See meml-gqiv.
 *
 * @typedef {Object} PresetMatrixCell
 * @property {boolean} muted
 * @property {number}  [fixedValue]
 * @property {number}  [min]
 * @property {number}  [max]
 * @property {number}  [curve]
 */

/**
 * Engine-specific static metadata.
 *
 * @typedef {Object} PresetMeta
 * @property {'subtractive'|'additive'|'fm'} [subEngine]
 *   Modular only. Picks the Faust sub-engine patch.
 * @property {number} [adsrCount]
 *   Modular only. How many ADSR slots the MLP-facing paramMeta contains.
 * @property {number} [lfoCount]
 *   Modular only. How many LFO slots the MLP-facing paramMeta contains.
 */

/**
 * The canonical unified preset shape.
 *
 * @typedef {Object} Preset
 * @property {string} id
 *   Stable, URL-safe identifier.
 * @property {string} name
 *   Human-facing display name.
 * @property {string} [description]
 * @property {'c15'|'modular'} engine
 *   Dispatch key for the preset loader.
 * @property {1|2|3|4|5} [complexity]
 *   Progressive-disclosure hint. Replaces old C15 tiers 1..4. UI-only.
 * @property {PresetMeta} [meta]
 * @property {Object.<string, PresetParamEntry>} params
 *   Keyed by engine-specific label. C15 uses flat names (e.g. `Osc_A_Pitch`);
 *   modular uses Faust paths (e.g. `/MatrixMixer/MM_Osc1/freq`). Omitted
 *   labels default to `{ bypassed:false, muted:false, min:0, max:1, curve:0.5 }`.
 * @property {Object.<string, PresetMatrixCell>} [matrix]
 *   Modular only. Omitted cells default to muted (deactivated).
 * @property {Object.<string, number>} [groupCurves]
 *   Per-group curve bias on top of each param's `curve`.
 */

// Exported for `import type`-style consumers and to make this a valid ES
// module. No runtime effect.
export const __presetSchemaVersion = 1;
