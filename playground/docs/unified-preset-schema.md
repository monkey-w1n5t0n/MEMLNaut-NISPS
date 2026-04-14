# Unified Preset Schema

Canonical preset shape for the NISPS playground. A single schema covers **both** the C15 WASM synth and the Faust-based **modular** engine (and, by extension, the additive / FM engines that share modular's Faust infrastructure). This document is the contract — any preset loader, preset editor, or preset file must conform.

JSDoc typedefs that mirror this document live in `playground/js/synth/preset-types.js`.

> Status: draft contract for epic `meml-iid8`. Issues `meml-7qnz` (bypass-vs-mute), `meml-gqiv` (matrix muted-cell semantics) and `meml-4bin` (normalised `setParam` on modular) fill in runtime semantics.

---

## Top-level shape

```js
{
  id: 'beginner-1',                // string, stable, URL-safe
  name: '1.1 Mellow pad',          // string, human display
  description: 'Long reverb tail', // string, optional-ish (may be empty)
  engine: 'c15' | 'modular',       // dispatch key for the loader
  complexity: 1,                   // integer 1..5, replaces old C15 tiers 1..4
  meta: {                          // engine-specific static metadata (optional)
    subEngine: 'subtractive' | 'additive' | 'fm',   // modular only
    adsrCount: 4,                                   // modular only
    lfoCount:  8,                                   // modular only
  },
  params: {                        // flat table keyed by engine-specific label
    [label]: {
      bypassed:   false,            // required — structural; see "Bypass vs. mute" below
      muted:      false,            // required — runtime; see "Bypass vs. mute" below
      fixedValue: 0.5,              // optional — value to pin when bypassed or muted
      min:        0.0,              // required when live (else default 0)
      max:        1.0,              // required when live (else default 1)
      curve:      0.5,              // required when live
    },
  },
  matrix: {                        // modular only, optional
    [cellKey]: {                    // 's16_d05' = source 16 → destination 5
      muted: false,
      min:   0.0,
      max:   1.0,
      curve: 0.5,
    },
  },
  groupCurves: {                   // per-group curve bias (UI grouping)
    [groupName]: 0.5,
  },
}
```

All numeric param values in a preset are **normalised to `[0,1]`**. The per-engine param-metadata table (modular: built at engine init from Faust JSON, tracked in `meml-4bin` — the F2 issue) converts to raw engineering units (Hz, seconds, semitones, etc.).

---

## Key conventions

### C15 (`engine: 'c15'`)

Uses **flat names** matching `js/synth/param-map.js`:

- `Env_A_Att`, `Env_A_Dec_1`, `Env_A_Sus`, `Env_A_Rel`
- `Osc_A_Pitch`, `Osc_B_Fluct`
- `Shp_A_Drive`, `Shp_A_Fold`
- `SV_Flt_Cut`, `SV_Flt_Res`, `SV_Flt_LBH`
- `Out_Mix_A_Lvl`, `Out_Mix_Lvl`, `Reverb_Mix`
- `Osc_A_PM_Self`, `FB_Mix_Lvl`, …

Every label in `params` MUST exist in `param-map.js`. Labels missing from the preset default to **MLP-controlled with bounds `{ min: 0, max: 1, curve: 0.5 }`** (see "Defaults" below).

### Modular (`engine: 'modular'`)

Uses **Faust paths** as labels. Examples:

- ADSR slot fields: `MM_ADSR/00_adsr01_attack`, `MM_ADSR/00_adsr01_sustain` …
- LFO slot fields: `MM_LFO/00_lfo01_rate`, `MM_LFO/00_lfo01_morph` …
- Sub-engine params: `3_Filter/00_cutoff`, `1_Oscillators/02_osc1_level`
- Master base-amp: `4_Master/04_base_amp` (subtractive), `3_Master/05_base_amp` (additive), `4_Master/06_base_amp` (fm)

The ADSR/LFO slot counts are determined by `meta.adsrCount` / `meta.lfoCount`; the sub-engine (`meta.subEngine`) picks the right Faust patch.

### Matrix cell keys (modular)

Matrix cells are keyed as `'sNN_dNN'` (source NN → destination NN), zero-padded:

- **Sources**: `s00`..`s15` = ADSR slots 1..16; `s16`..`s47` = LFO slots 1..32
- **Destinations** (per sub-engine): `d00` = pitch, `d08` = amp, `d09` = pan; other slots vary — see `faust/MODULAR_DESTINATIONS.md`

Example: `s00_d08` = ADSR 1 → voice amp.

---

## Bypass vs. mute semantics (see `meml-7qnz`)

Two formally distinct concepts; both can appear on the same param entry.

### BYPASS — structural, preset-level, compile-time for the MLP

- The param is **NOT** in the engine's `paramMeta` for this preset.
- The MLP has **no output node** for it. It does not participate in training.
- The param is held at the preset-specified `fixedValue` (or the engine's DSP default if `fixedValue` is omitted) for the life of the preset.
- Toggling `bypassed` → the MLP must be rebuilt (output layer resizes; weights are invalidated — coordinates with `meml-gmus`).
- **Use for**: discrete/structural knobs (waveform selectors, mode switches), params outside the current research scope, whole sub-modules you want silent/disabled at the DSP level.

### MUTE — dynamic, runtime, per-output toggle

- The param **IS** in `paramMeta`; the MLP has an output node for it.
- The network trains with it, but at runtime the MLP's output for this node is **ignored** and the param is held at `fixedValue`.
- Can be toggled freely at runtime without rebuilding the MLP or touching weights.
- **Use for**: params you want to temporarily freeze during exploration without retraining — e.g. A/B against a pinned value, or silence a flapping output.

### Interaction rules

| `bypassed` | `muted` | Effect |
|-----------:|--------:|--------|
| `false`    | `false` | Fully live: MLP drives the param within `[min, max]`, biased by `curve`. |
| `false`    | `true`  | In paramMeta (trained), but runtime-frozen at `fixedValue`. |
| `true`     | (n/a)   | Not in paramMeta. Held at `fixedValue` (or DSP default). `muted` is ignored. |

### Default pattern in curated presets

Most params `bypassed:true`; a curated set included (`bypassed:false`); a few of those start `muted:true` as a "quick-unmute for exploration" affordance. This replaces the pre-split behaviour where `muted:true` served double duty.

### Schema change notice

**Earlier drafts of this schema used only `muted`.** That single flag has been split into two: `bypassed` (structural) and `muted` (runtime). Preset migrations MUST emit both flags — `meml-2l83` (C15 preset migration) and `meml-pu12` (modular preset migration) own this. Downstream: `meml-4bin` (normalised `setParam`) must consult both flags, and `meml-17mp` (`getSectionView`) must filter by `bypassed`.

### Omission rules (loader correctness)

1. **Param omitted from `params`** → default `{ bypassed:false, muted:false, min:0, max:1, curve:0.5 }`. Preserves the "unspecified = let the MLP drive it" invariant that current `presets.js` relies on.
2. **Matrix cell omitted from `matrix`** → treated as **deactivated** (`muted:true`, raw routing value = 0). Matrix cells are the exception: silence is the default. See `meml-gqiv` for full matrix-cell semantics.
3. **`fixedValue` omitted on a bypassed or muted param** → runtime uses the engine's baked-in default (C15 factory default, or Faust patch default after `resetToDefaults()`).

---

## Curve semantics

`curve ∈ [0, 1]`:

- `0.5` — linear / unbiased
- `< 0.5` — biased low (spends more time near `min`)
- `> 0.5` — biased high (spends more time near `max`)
- Values near 0 or 1 are **soft biases, not clamps**. The full `[min, max]` range remains reachable.

### Canonical formula (single source of truth)

This matches `applyCurve()` in `js/synth/param-map.js` — treat that function as the reference implementation; any new renderer MUST produce identical output:

```
exponent = 2 ^ (4 * (curve - 0.5))
curved   = clamp(x, 0, 1) ^ exponent
output   = min + curved * (max - min)
```

Exponent range across `curve ∈ [0,1]`:

| `curve` | exponent | shape |
|--------:|---------:|-------|
| 0.0 | 0.25 | strong low-bias (log-like) |
| 0.5 | 1.00 | linear |
| 1.0 | 4.00 | strong high-bias (exp-like) |

Note: an earlier draft of this doc suggested `exp = 2^((curve*2)-1)` (range 0.5..2). That formulation is **rejected** in favour of the `param-map.js` implementation above, which has a usefully wider dynamic range and is already shipped in the C15 adapter. All engines (C15, modular, additive, fm) and all preset renderers must use the `param-map.js` formula.

`groupCurves[group]` applies an additional curve bias on top of each param's `curve`, allowing the user to globally push a whole group (e.g. "Envelopes") more percussive or more sustained without editing every param. Group curve composes by multiplying exponents (i.e. applying `applyCurve` twice).

---

## Complexity (`1..5`)

Replaces the old C15 tier field (`1..4`). New scale:

| Complexity | Meaning |
|-----------:|---------|
| 1 | Beginner — very few active params (≤15 for C15) |
| 2 | Intermediate |
| 3 | Advanced |
| 4 | Expert — most of the engine surface exposed |
| 5 | Reserved for modular patches with unusual matrix coverage |

Complexity is a hint for the UI (filter / sort presets); the runtime does not behave differently across complexity levels.

---

## Loader dispatch

The unified loader reads `preset.engine` and:

1. Calls `engine.resetToDefaults()` (or equivalent C15 factory reset).
2. Applies `meta` (modular: `setSubEngine`, `setAdsrCount`, `setLfoCount`).
3. For each label in `params`: converts normalised `[min, max, fixedValue]` to raw via the engine's param-metadata, applies to the engine, and registers the bounds with the MLP output router.
4. For modular only: applies `matrix` (muted cells deactivated; active cells get their `min/max/curve` applied to the routing cell + the cell's amount param set from `fixedValue`).
5. Emits a `preset:applied` event with the fully-resolved preset.

The resolver is pure: feed it a preset + engine metadata and you get a fully-qualified runtime config. This lets us round-trip presets to JSON, URLs, localStorage identically.

---

## Matrix cell semantics (see `meml-gqiv`)

Matrix cells use `muted` (not `bypassed`) because the modular matrix is a fixed-shape routing grid — cells don't structurally appear/disappear from the DSP, they're just zeroed.

- **`muted: true`** ⟹ **raw routing value = 0** (hard zero, not "frozen at last value") AND the cell is **not exposed to the MLP**. The MLP has no output for this cell. This is the default for any cell omitted from `matrix`.
- **`muted: false`** ⟹ cell is live: MLP drives the routing amount within `[min, max]`, biased by `curve`.
- **`fixedValue` on a muted matrix cell is ignored.** A muted cell is always 0. (If you want a non-zero fixed routing, leave the cell un-muted with `min == max == fixedValue`.)

### Sub-engine-aware destination labels

Matrix destination labels (`d00`..`d09`) **differ per sub-engine**. Only three labels are stable across `subtractive` / `additive` / `fm`:

- `d00` = pitch
- `d08` = amp
- `d09` = pan

All other destination slots vary (filter cutoff in subtractive ≠ partial morph in additive ≠ modulator ratio in fm). Matrix-cell metadata keys are therefore **sub-engine-aware**: the same `s00_d05` key means different things across engines. Preset loaders MUST consult `meta.subEngine` when resolving destination semantics. See `faust/MODULAR_DESTINATIONS.md` (per `meml-kw1f`) for the full table.

---

## Mode scoping

Presets affect **only the `synth` output mode.** The other output modes route MLP outputs unchanged by any preset:

- **Visual** — first 20 outputs drive the flow-field visualizer.
- **MIDI CC** — outputs routed to user-configured CCs.
- **Audio Canvas** — 36 outputs drive the generative sampler.

Switching to a non-synth mode does not disable/ignore the active preset; it just means the preset's `params`/`matrix` bounds have no consumer. Switching back re-engages them immediately.

---

## Mobile layout

The group-drawer UI (column cards: **Sound** / **Modulation** / **Routing**, per `meml-1gx8`) uses a three-column layout on desktop. Below a **480px viewport width** breakpoint, the columns collapse to a single vertically-scrolling stack. Individual cards remain collapsible/expandable; nothing is hidden, just linearised.

---

## localStorage migration

The schema is versioned by `__presetSchemaVersion` (exported from `js/synth/preset-types.js`). On app boot the loader reads any persisted session and compares its stored version.

**On mismatch**:

1. Show a **modal dialog**: *"Saved session is from an older version and can't be loaded. Reset?"*
2. **Default action = Cancel** (non-destructive). Cancel leaves localStorage intact and boots with a blank session so the user can export/export-URL the old blob if they need it.
3. Only on **explicit Confirm** does the app wipe the stale session.

**Do not auto-wipe.** The user's training examples, weights, and preset customisations must never be silently destroyed on schema bumps. (Spec entry only — implementation lives downstream.)

---

## Open questions (tracked as follow-ups)

- `meml-7qnz` — **resolved in this doc**: bypass is now a first-class preset flag alongside mute.
- `meml-gqiv` — **resolved in this doc**: muted matrix cell ⟹ raw 0 and not in paramMeta; curve formula anchored to `param-map.js`; mobile, mode-scoping, and localStorage-migration semantics specified.
- `meml-4bin` — finalise the normalised `setParam` API on `ModularEngine` so the loader can speak in [0,1] regardless of engine. Must respect `bypassed` (don't route to param) vs `muted` (pin to `fixedValue`).
- `meml-17mp` — `getSectionView` filters by `bypassed` (hide structurally absent) but shows muted params (visually distinct, toggle-able).
